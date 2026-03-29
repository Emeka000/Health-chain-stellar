import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { ValidateProofBundleDto } from './dto/validate-proof-bundle.dto';
import { ProofBundleService } from './proof-bundle.service';

@Controller('proof-bundles')
export class ProofBundleController {
  constructor(private readonly service: ProofBundleService) {}

  /** Validate artifacts and attach a proof bundle to a payment */
  @Post('validate')
  validate(@Body() dto: ValidateProofBundleDto) {
    return this.service.validateAndAttach(dto);
  }

  /** Release escrow once a validated bundle exists */
  @Post(':id/release')
  release(@Param('id') id: string, @Body('releasedBy') releasedBy: string) {
    return this.service.releaseEscrow(id, releasedBy);
  }

  /** Get all proof bundles for a payment */
  @Get('payment/:paymentId')
  byPayment(@Param('paymentId') paymentId: string) {
    return this.service.getByPayment(paymentId);
  }

  /** Get a single proof bundle */
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }
}
