import { Controller, Post, Body, Get, Param, Patch, Request, UseGuards, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { DonationService } from '../services/donation.service';
import { PledgeService } from '../services/pledge.service';
import { DonationEntity } from '../entities/donation.entity';
import { DonationAsset } from '../enums/donation.enum';

export class CreateDonationDto {
  amount: number;
  payerAddress: string;
  recipientId: string;
  asset?: DonationAsset;
}

export class ConfirmDonationDto {
  transactionHash: string;
}

@ApiTags('donations')
@Controller('donations')
@UseInterceptors(ClassSerializerInterceptor)
export class DonationController {
  constructor(
    private readonly donationService: DonationService,
    private readonly pledgeService: PledgeService,
  ) {}

  @Post('intent')
  @ApiOperation({ summary: 'Create a donation payment intent for the wallet to sign' })
  @ApiResponse({ status: 201, type: DonationEntity })
  async createIntent(@Body() dto: CreateDonationDto, @Request() req: any) {
    const userId = req.user?.id;
    return this.donationService.createIntent({ ...dto, donorUserId: userId });
  }

  @Patch(':id/confirm')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Submit transaction hash to confirm a payment donation' })
  @ApiResponse({ status: 200, type: DonationEntity })
  async confirmDonation(
    @Param('id') id: string,
    @Body() dto: ConfirmDonationDto,
    @Request() req: any,
  ) {
    return this.donationService.confirmDonation(id, dto.transactionHash, req.user?.id);
  }

  @Get('my-donations')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get the authenticated user's donation history" })
  async getMyDonations(@Request() req: { user?: { id?: string } }) {
    const userId = req.user?.id;
    if (!userId) {
      return { donations: [], pledges: [] };
    }
    const [donations, pledges] = await Promise.all([
      this.donationService.getDonationsByDonorUserId(userId),
      this.pledgeService.listByDonorUserId(userId),
    ]);
    return { donations, pledges };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve specific donation details' })
  async findOne(@Param('id') id: string) {
    return this.donationService.getDonationById(id);
  }
}
