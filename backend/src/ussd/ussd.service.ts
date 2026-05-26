import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { UssdSession, UssdSessionState } from './entities/ussd-session.entity';
import { BloodRequestsService } from '../blood-requests/blood-requests.service';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class UssdService {
  private readonly logger = new Logger(UssdService.name);

  constructor(
    @InjectRepository(UssdSession)
    private sessionRepo: Repository<UssdSession>,
    private bloodRequestsService: BloodRequestsService,
  ) {}

  async handleUssdRequest(
    sessionId: string,
    phoneNumber: string,
    text: string,
  ): Promise<string> {
    let session = await this.findOrCreateSession(sessionId, phoneNumber);

    // Check for duplicate submission
    if (session.state === UssdSessionState.COMPLETED) {
      return 'END Request already submitted. Thank you.';
    }

    const input = text.split('*').pop() || '';

    switch (session.state) {
      case UssdSessionState.STARTED:
        return await this.handleHospitalIdentity(session, input);

      case UssdSessionState.HOSPITAL_IDENTITY:
        return await this.handleBloodType(session, input);

      case UssdSessionState.BLOOD_TYPE:
        return await this.handleQuantity(session, input);

      case UssdSessionState.QUANTITY:
        return await this.handleUrgency(session, input);

      case UssdSessionState.URGENCY:
        return await this.handleLocation(session, input);

      case UssdSessionState.LOCATION:
        return await this.handleConfirmation(session, input);

      case UssdSessionState.CONFIRMATION:
        return await this.finalizeRequest(session, input);

      default:
        return 'END Session error. Please try again.';
    }
  }

  private async findOrCreateSession(
    sessionId: string,
    phoneNumber: string,
  ): Promise<UssdSession> {
    let session = await this.sessionRepo.findOne({ where: { sessionId } });

    if (!session) {
      session = this.sessionRepo.create({
        sessionId,
        phoneNumber,
        state: UssdSessionState.STARTED,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
      });
      await this.sessionRepo.save(session);
    }

    return session;
  }

  private async handleHospitalIdentity(
    session: UssdSession,
    input: string,
  ): Promise<string> {
    if (!input) {
      return 'CON Welcome to Emergency Blood Request\nEnter your Hospital ID:';
    }

    // Validate hospital ID (simplified)
    session.hospitalId = input;
    session.state = UssdSessionState.HOSPITAL_IDENTITY;
    await this.sessionRepo.save(session);

    return 'CON Select Blood Type:\n1. A+\n2. A-\n3. B+\n4. B-\n5. O+\n6. O-\n7. AB+\n8. AB-';
  }

  private async handleBloodType(
    session: UssdSession,
    input: string,
  ): Promise<string> {
    const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
    const index = parseInt(input) - 1;

    if (index < 0 || index >= bloodTypes.length) {
      return 'CON Invalid selection.\nSelect Blood Type:\n1. A+\n2. A-\n3. B+\n4. B-\n5. O+\n6. O-\n7. AB+\n8. AB-';
    }

    session.bloodType = bloodTypes[index];
    session.state = UssdSessionState.BLOOD_TYPE;
    await this.sessionRepo.save(session);

    return 'CON Enter quantity (units):';
  }

  private async handleQuantity(
    session: UssdSession,
    input: string,
  ): Promise<string> {
    const quantity = parseInt(input);

    if (isNaN(quantity) || quantity < 1 || quantity > 50) {
      return 'CON Invalid quantity. Enter 1-50 units:';
    }

    session.quantity = quantity;
    session.state = UssdSessionState.QUANTITY;
    await this.sessionRepo.save(session);

    return 'CON Select Urgency:\n1. Critical (< 1 hour)\n2. Urgent (< 4 hours)\n3. Standard (< 24 hours)';
  }

  private async handleUrgency(
    session: UssdSession,
    input: string,
  ): Promise<string> {
    const urgencyMap = {
      '1': 'critical',
      '2': 'urgent',
      '3': 'standard',
    };

    if (!urgencyMap[input]) {
      return 'CON Invalid selection.\n1. Critical\n2. Urgent\n3. Standard';
    }

    session.urgency = urgencyMap[input];
    session.state = UssdSessionState.URGENCY;
    await this.sessionRepo.save(session);

    return 'CON Enter delivery location (brief):';
  }

  private async handleLocation(
    session: UssdSession,
    input: string,
  ): Promise<string> {
    if (!input || input.length < 3) {
      return 'CON Location too short. Enter delivery location:';
    }

    session.location = input;
    session.state = UssdSessionState.LOCATION;
    await this.sessionRepo.save(session);

    return `CON Confirm Request:\nHospital: ${session.hospitalId}\nType: ${session.bloodType}\nQty: ${session.quantity}\nUrgency: ${session.urgency}\n\n1. Confirm\n2. Cancel`;
  }

  private async handleConfirmation(
    session: UssdSession,
    input: string,
  ): Promise<string> {
    session.state = UssdSessionState.CONFIRMATION;
    await this.sessionRepo.save(session);

    if (input === '1') {
      return await this.finalizeRequest(session, input);
    } else {
      session.state = UssdSessionState.CANCELLED;
      await this.sessionRepo.save(session);
      return 'END Request cancelled.';
    }
  }

  private async finalizeRequest(
    session: UssdSession,
    input: string,
  ): Promise<string> {
    try {
      // Create blood request
      const result = await this.bloodRequestsService.create({
        hospitalId: session.hospitalId,
        bloodType: session.bloodType,
        quantity: session.quantity,
        urgency: session.urgency,
        deliveryLocation: session.location,
        source: 'ussd',
        phoneNumber: session.phoneNumber,
      } as any, { id: 'ussd-system', role: 'system', email: 'ussd@system' } as any);

      session.requestId = result.data.id;
      session.state = UssdSessionState.COMPLETED;
      await this.sessionRepo.save(session);

      return `END Request submitted successfully!\nRef: ${result.data.id.substring(0, 8)}\nYou will receive updates via SMS.`;
    } catch (error) {
      this.logger.error('Failed to create blood request from USSD', error);
      return 'END Error submitting request. Please try again or contact support.';
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanupExpiredSessions() {
    const deleted = await this.sessionRepo.delete({
      expiresAt: LessThan(new Date()),
      state: UssdSessionState.COMPLETED,
    });
    this.logger.log(`Cleaned up ${deleted.affected} expired USSD sessions`);
  }
}
