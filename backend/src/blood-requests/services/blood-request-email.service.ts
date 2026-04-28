import { Injectable } from '@nestjs/common';
import { EmailProvider } from '../../notifications/providers/email.provider';
import { BloodRequestEntity } from '../entities/blood-request.entity';

@Injectable()
export class BloodRequestEmailService {
  constructor(private readonly emailProvider: EmailProvider) {}

  async sendCreationConfirmation(
    to: string,
    request: BloodRequestEntity,
  ): Promise<void> {
    const lines = request.items
      .map(
        (i) =>
          `<li>${i.bloodType} ${i.component} × ${i.quantityMl}ml (Priority: ${i.priority})</li>`,
      )
      .join('');
    const requiredByDate = new Date(request.requiredByTimestamp * 1000);
    const html = `
      <p>Blood request <strong>${request.requestNumber}</strong> was created.</p>
      <p>Required by: ${requiredByDate.toISOString()}</p>
      <ul>${lines}</ul>
      <p>On-chain tx: <code>${request.blockchainTxHash ?? 'n/a'}</code></p>
    `;
    await this.emailProvider.send(
      to,
      `Blood request ${request.requestNumber} confirmed`,
      html,
    );
  }
}
