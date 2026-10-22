import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ValidateProofBundleDto } from './dto/validate-proof-bundle.dto';
import { ProofBundleService } from './proof-bundle.service';

@ApiTags('Proof Bundles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('proof-bundles')
export class ProofBundleController {
  constructor(private readonly service: ProofBundleService) {}

  @ApiOperation({ summary: 'Validate artifacts and attach a proof bundle to a payment' })
  @ApiResponse({ status: 201, description: 'Proof bundle created and attached' })
  @Post('validate')
  @RequirePermissions(Permission.VERIFICATION_ADMIN)
  validate(@Body() dto: ValidateProofBundleDto) {
    return this.service.validateAndAttach(dto);
  }

  @ApiOperation({ summary: 'Release escrow once a validated bundle exists' })
  @ApiResponse({ status: 201, description: 'Escrow released' })
  @Post(':id/release')
  @RequirePermissions(Permission.SETTLEMENT_RELEASE)
  release(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as { id?: string; sub?: string };
    return this.service.releaseEscrow(id, user.id ?? user.sub ?? 'unknown');
  }

  @ApiOperation({ summary: 'Re-verify an existing bundle\'s manifest integrity (tamper detection)' })
  @ApiResponse({ status: 200, description: 'Bundle integrity result' })
  @Get(':id/verify')
  @RequirePermissions(Permission.VERIFICATION_ADMIN)
  verify(@Param('id') id: string) {
    return this.service.verifyBundle(id);
  }

  @ApiOperation({ summary: 'Get all proof bundles for a payment' })
  @ApiResponse({ status: 200, description: 'List of proof bundles' })
  @Get('payment/:paymentId')
  @RequirePermissions(Permission.SETTLEMENT_RELEASE)
  byPayment(@Param('paymentId') paymentId: string) {
    return this.service.getByPayment(paymentId);
  }

  @ApiOperation({ summary: 'Get a single proof bundle' })
  @ApiResponse({ status: 200, description: 'Proof bundle record' })
  @Get(':id')
  @RequirePermissions(Permission.SETTLEMENT_RELEASE)
  getOne(@Param('id') id: string) {
    return this.service.getOne(id);
  }
}
