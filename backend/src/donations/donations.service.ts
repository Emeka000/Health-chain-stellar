import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Donation, DonationStatus } from './entities/donation.entity';
import { CreateDonationDto } from './dto/create-donation.dto';
import { SorobanService } from '../soroban/soroban.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DonationsService {
  private readonly logger = new Logger(DonationsService.name);

  constructor(
    @InjectRepository(Donation)
    private readonly donationRepository: Repository<Donation>,
    private readonly sorobanService: SorobanService,
    private readonly configService: ConfigService,
  ) {}

  async create(dto: CreateDonationDto): Promise<Donation> {
    const donation = this.donationRepository.create({
      ...dto,
      status: DonationStatus.PENDING,
    });
    return this.donationRepository.save(donation);
  }

  async findOne(id: string): Promise<Donation> {
    const donation = await this.donationRepository.findOne({ where: { id } });
    if (!donation) {
      throw new NotFoundException(`Donation ${id} not found`);
    }
    return donation;
  }

  async confirm(id: string, transactionHash: string): Promise<Donation> {
    const donation = await this.findOne(id);

    if (donation.status === DonationStatus.COMPLETED) {
      return donation;
    }

    const alreadyUsed = await this.donationRepository.findOne({
      where: { transactionHash },
    });
    if (alreadyUsed && alreadyUsed.id !== donation.id) {
      throw new BadRequestException(
        'Transaction hash has already been used for another donation',
      );
    }

    const recipientAddress = this.configService.get<string>(
      'STELLAR_RECIPIENT_ADDRESS',
    );
    if (!recipientAddress) {
      throw new BadRequestException(
        'Recipient Stellar address is not configured',
      );
    }

    const verified = await this.sorobanService.verifyDonationTransaction({
      transactionHash,
      expectedMemo: donation.memo,
      recipientAddress,
      payerAddress: donation.payerAddress,
      asset: donation.asset,
      amount: donation.amount,
    });

    if (!verified) {
      throw new BadRequestException(
        'Transaction could not be verified on-chain',
      );
    }

    donation.status = DonationStatus.COMPLETED;
    donation.transactionHash = transactionHash;
    donation.confirmedAt = new Date();
    return this.donationRepository.save(donation);
  }
}
