import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
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
   */
  async confirmDonation(id: string, transactionHash: string): Promise<DonationEntity> {
    const donation = await this.donationRepository.findOne({ where: { id } });
    if (!donation) throw new NotFoundException('Donation record not found');

    if (donation.status !== DonationStatus.PENDING) {
      throw new ConflictException(`Donation is already ${donation.status}`);
    }

    // Update status to COMPLETED (ideally verify transaction on-chain first)
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
