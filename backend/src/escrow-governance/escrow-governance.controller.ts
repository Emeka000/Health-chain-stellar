import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Ip,
    Param,
    Patch,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import {
    AddSignerDto,
    CancelProposalDto,
    CastVoteDto,
    CreateEscrowProposalDto,
    CreateThresholdPolicyDto,
    EmergencySuspendDto,
    RevokeSignerDto,
    SuspendSignerDto,
} from './dto/escrow-governance.dto';
import { EscrowGovernanceService } from './escrow-governance.service';
import { EscrowProposalStatus } from './enums/escrow-governance.enum';

@ApiTags('Escrow Governance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('escrow-governance')
export class EscrowGovernanceController {
    constructor(private readonly service: EscrowGovernanceService) { }

    // ── Threshold Policies ───────────────────────────────────────────────────

    @Post('policies')
    @RequirePermissions(Permission.SETTLEMENT_RELEASE)
    @ApiOperation({ summary: 'Create a threshold policy for escrow release governance' })
    createPolicy(
        @Body() dto: CreateThresholdPolicyDto,
        @Req() req: Request,
    ) {
        const user = (req as any).user;
        return this.service.createThresholdPolicy(dto, user.id, user.role);
    }

    @Get('policies')
    @RequirePermissions(Permission.SETTLEMENT_RELEASE)
    @ApiOperation({ summary: 'List all threshold policies' })
    listPolicies() {
        return this.service.listThresholdPolicies();
    }

    @Delete('policies/:id')
    @RequirePermissions(Permission.ADMIN_ACCESS)
    @ApiOperation({ summary: 'Deactivate a threshold policy' })
    deactivatePolicy(@Param('id') id: string, @Req() req: Request) {
        const user = (req as any).user;
        return this.service.deactivateThresholdPolicy(id, user.id, user.role);
    }

    // ── Signer Management ────────────────────────────────────────────────────

    @Post('signers')
    @RequirePermissions(Permission.ADMIN_ACCESS)
    @ApiOperation({ summary: 'Register a new escrow signer' })
    addSigner(@Body() dto: AddSignerDto, @Req() req: Request) {
        const user = (req as any).user;
        return this.service.addSigner(dto, user.id, user.role);
    }

    @Get('signers')
    @RequirePermissions(Permission.SETTLEMENT_RELEASE)
    @ApiOperation({ summary: 'List all escrow signers' })
    listSigners() {
        return this.service.listSigners();
    }

    @Patch('signers/:id/revoke')
    @RequirePermissions(Permission.ADMIN_ACCESS)
    @ApiOperation({ summary: 'Permanently revoke a signer' })
    revokeSigner(
        @Param('id') id: string,
        @Body() dto: RevokeSignerDto,
        @Req() req: Request,
    ) {
        const user = (req as any).user;
        return this.service.revokeSigner(id, dto, user.id, user.role);
    }

    @Patch('signers/:id/suspend')
    @RequirePermissions(Permission.ADMIN_ACCESS)
    @ApiOperation({ summary: 'Temporarily suspend a signer' })
    suspendSigner(
        @Param('id') id: string,
        @Body() dto: SuspendSignerDto,
        @Req() req: Request,
    ) {
        const user = (req as any).user;
        return this.service.suspendSigner(id, dto, user.id, user.role);
    }

    @Patch('signers/:id/reactivate')
    @RequirePermissions(Permission.ADMIN_ACCESS)
    @ApiOperation({ summary: 'Reactivate a suspended signer' })
    reactivateSigner(@Param('id') id: string, @Req() req: Request) {
        const user = (req as any).user;
        return this.service.reactivateSigner(id, user.id, user.role);
    }

    // ── Proposals ────────────────────────────────────────────────────────────

    @Post('proposals')
    @RequirePermissions(Permission.SETTLEMENT_RELEASE)
    @ApiOperation({ summary: 'Create an escrow release proposal' })
    createProposal(@Body() dto: CreateEscrowProposalDto, @Req() req: Request) {
        const user = (req as any).user;
        return this.service.createProposal(dto, user.id, user.role);
    }

    @Get('proposals')
    @RequirePermissions(Permission.SETTLEMENT_RELEASE)
    @ApiOperation({ summary: 'List escrow proposals' })
    @ApiQuery({ name: 'status', enum: EscrowProposalStatus, required: false })
    @ApiQuery({ name: 'paymentId', required: false })
    listProposals(
        @Query('status') status?: EscrowProposalStatus,
        @Query('paymentId') paymentId?: string,
    ) {
        return this.service.listProposals({ status, paymentId });
    }

    @Get('proposals/:id')
    @RequirePermissions(Permission.SETTLEMENT_RELEASE)
    @ApiOperation({ summary: 'Get a single escrow proposal with votes' })
    getProposal(@Param('id') id: string) {
        return this.service.getProposal(id);
    }

    @Get('proposals/payment/:paymentId/history')
    @RequirePermissions(Permission.SETTLEMENT_RELEASE)
    @ApiOperation({ summary: 'Get full proposal history for a payment' })
    getHistory(@Param('paymentId') paymentId: string) {
        return this.service.getProposalHistory(paymentId);
    }

    @Post('proposals/:id/vote')
    @RequirePermissions(Permission.SETTLEMENT_RELEASE)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Cast a vote (APPROVE or REJECT) on a proposal' })
    castVote(
        @Param('id') id: string,
        @Body() dto: CastVoteDto,
        @Req() req: Request,
        @Ip() ipAddress: string,
    ) {
        const user = (req as any).user;
        return this.service.castVote(id, user.id, dto, user.role, {
            ipAddress,
            userAgent: req.headers['user-agent'],
        });
    }

    @Post('proposals/:id/cancel')
    @RequirePermissions(Permission.SETTLEMENT_RELEASE)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Cancel a pending or approved proposal' })
    cancelProposal(
        @Param('id') id: string,
        @Body() dto: CancelProposalDto,
        @Req() req: Request,
    ) {
        const user = (req as any).user;
        return this.service.cancelProposal(id, dto, user.id, user.role);
    }

    @Post('proposals/:id/emergency-suspend')
    @RequirePermissions(Permission.ADMIN_ACCESS)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Emergency suspend a proposal (admin only)' })
    emergencySuspend(
        @Param('id') id: string,
        @Body() dto: EmergencySuspendDto,
        @Req() req: Request,
    ) {
        const user = (req as any).user;
        return this.service.emergencySuspendProposal(id, dto.reason, user.id, user.role);
    }

    @Post('proposals/:id/execute')
    @RequirePermissions(Permission.SETTLEMENT_RELEASE)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Mark an approved proposal as executed with its on-chain tx hash' })
    markExecuted(
        @Param('id') id: string,
        @Body('txHash') txHash: string,
        @Req() req: Request,
    ) {
        const user = (req as any).user;
        return this.service.markExecuted(id, txHash, user.id, user.role);
    }
}
