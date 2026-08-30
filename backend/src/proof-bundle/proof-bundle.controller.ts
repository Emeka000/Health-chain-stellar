import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ValidateProofBundleDto } from './dto/validate-proof-bundle.dto';
import { ProofBundleService } from './proof-bundle.service';

@ApiTags('Proof Bundles')
@ApiBearerAuth()
@Controller('proof-bundles')
export class ProofBundleController {
  constructor(private readonly service: ProofBundleService) {}

  @ApiOperation({ summary: 'Validate artifacts and attach a proof bundle to a payment' })
  @ApiResponse({ status: 201, description: 'Proof bundle created and attached' })
  @Post('validate')
  validate(@Body() dto: ValidateProofBundleDto) {
    return this.service.validateAndAttach(dto);
  }

  @ApiOperation({ summary: 'Release escrow once a validated bundle exists' })
  @ApiResponse({ status: 201, description: 'Escrow released' })
  @Post(':id/release')
  release(@Param('id') id: string, @Body('releasedBy') releasedBy: string) {
    return this.service.releaseEscrow(id, releasedBy);
  }

  @ApiOperation({ summary: 'Re-verify an existing bundle\'s manifest integrity (tamper detection)' })
  @ApiResponse({ status: 200, description: 'Bundle integrity result' })
  @Get(':id/verify')
  verify(@Param('id') id: string) {
    return this.service.verifyBundle(id);
  }

  @ApiOperation({ summary: 'Get all proof bundles for a payment' })
  @ApiResponse({ status: 200, description: 'List of proof bundles' })
  @Get('payment/:paymentId')
  byPayment(@Param('paymentId') paymentId: string) {
    return this.service.getByPayment(paymentId);
  }

  @ApiOperation({ summary: 'Get a single proof bundle' })
  @ApiResponse({ status: 200, description: 'Proof bundle record' })
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }
}
