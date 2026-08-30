import { Injectable, Logger, NotFoundException, ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { ConsentService } from '../../consent/consent.service';
import { DonationEntity } from '../entities/donation.entity';
import { DonationStatus, DonationAsset } from '../enums/donation.enum';
import { SorobanService } from '../../soroban/soroban.service';

@Injectable()
export class DonationService {
  private readonly logger = new Logger(DonationService.name);

  constructor(
    @InjectRepository(DonationEntity)
    private readonly donationRepository: Repository<DonationEntity>,
    private readonly sorobanService: SorobanService,
    private readonly consentService: ConsentService,
  ) {}

  /**
   * Create a donation intent. Generate a unique memo for Stellar payment tracking.
   * Requires the donor to have current (non-drifted) consent before enrolling.
   */
  async createIntent(params: {
    amount: number;
    payerAddress: string;
    recipientId: string;
    asset?: DonationAsset;
    donorUserId?: string;
  }): Promise<DonationEntity> {
    // Enforce consent currency before accepting the enrollment write
    if (params.donorUserId) {
      await this.consentService.assertCurrentConsent(params.donorUserId);
    }

    const memo = `DON-${uuidv4().substring(0, 8).toUpperCase()}`;

    const donation = this.donationRepository.create({
      amount: params.amount,
      payerAddress: params.payerAddress,
      recipientId: params.recipientId,
      asset: params.asset || DonationAsset.XLM,
      memo,
      status: DonationStatus.PENDING,
      donorUserId: params.donorUserId,
    });

    return this.donationRepository.save(donation);
  }

  /**
   * Confirm donation after payment transaction is submitted on-chain.
   * Enforces that:
   *  1. The caller is the donation owner (matched by donorUserId or payerAddress).
   *  2. The supplied transactionHash actually exists on-chain and is successful,
   *     and its memo matches the donation's unique memo field.
   */
  async confirmDonation(
    id: string,
    transactionHash: string,
    callerUserId: string,
  ): Promise<DonationEntity> {
    const donation = await this.donationRepository.findOne({ where: { id } });
    if (!donation) throw new NotFoundException('Donation record not found');

    // Ownership check: the caller must be the donor that created this intent
    if (!callerUserId || donation.donorUserId !== callerUserId) {
      throw new ForbiddenException('You are not authorised to confirm this donation');
    }

    if (donation.status !== DonationStatus.PENDING) {
      throw new ConflictException(`Donation is already ${donation.status}`);
    }

    // On-chain verification: confirm the transaction exists, is successful,
    // and references the unique memo that was issued with the intent.
    const verified = await this.sorobanService.verifyPaymentTransaction(
      transactionHash,
      donation.memo,
    );
    if (!verified) {
      throw new BadRequestException(
        'Transaction could not be verified on-chain. ' +
          'Ensure the transaction is confirmed and the memo matches the donation intent.',
      );
    }

    donation.transactionHash = transactionHash;
    donation.status = DonationStatus.COMPLETED;

    const saved = await this.donationRepository.save(donation);

    this.logger.log(`Donation confirmed: ${id} hash=${transactionHash}`);
    return saved;
  }

  async getDonationById(id: string): Promise<DonationEntity> {
    const d = await this.donationRepository.findOne({ where: { id } });
    if (!d) throw new NotFoundException('Donation not found');
    return d;
  }

  async getDonationsByDonor(payerAddress: string): Promise<DonationEntity[]> {
    return this.donationRepository.find({
      where: { payerAddress },
      order: { createdAt: 'DESC' },
    });
  }

  async getDonationsByDonorUserId(donorUserId: string): Promise<DonationEntity[]> {
    return this.donationRepository.find({
      where: { donorUserId },
      order: { createdAt: 'DESC' },
    });
  }
}
