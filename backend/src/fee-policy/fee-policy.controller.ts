import { Controller, Post, Body, Get, Put, Delete, Param, HttpCode, HttpStatus, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { FeePolicyService } from './fee-policy.service';
import { FeePolicyAnalyzerService } from './fee-policy-analyzer.service';
import { FeePolicyRolloutService } from './fee-policy-rollout.service';
import { CreateFeePolicyDto, UpdateFeePolicyDto, FeePreviewDto, FeeBreakdownDto } from './dto/fee-policy.dto';

@Controller('fee-policy')
export class FeePolicyController {
    constructor(
        private readonly feePolicyService: FeePolicyService,
        private readonly feePolicyAnalyzerService: FeePolicyAnalyzerService,
        private readonly feePolicyRolloutService: FeePolicyRolloutService,
    ) { }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @Post()
    create(@Body() createFeePolicyDto: CreateFeePolicyDto) {
        return this.feePolicyService.create(createFeePolicyDto);
    }

    @RequirePermissions(Permission.VIEW_FEE_POLICIES)
    @Get()
    findAll() {
        return this.feePolicyService.findAll();
    }

    @RequirePermissions(Permission.VIEW_FEE_POLICIES)
    @Get('preview')
    previewFees(@Body() previewDto: FeePreviewDto): Promise<FeeBreakdownDto> {
        return this.feePolicyService.previewFees(previewDto);
    }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @Get(':id')
    findOne(@Param('id', ParseUUIDPipe) id: string) {
        return this.feePolicyService.findOne(id);
    }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @Put(':id')
    update(@Param('id', ParseUUIDPipe) id: string, @Body() updateFeePolicyDto: UpdateFeePolicyDto) {
        return this.feePolicyService.update(id, updateFeePolicyDto);
    }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    remove(@Param('id', ParseUUIDPipe) id: string) {
        return this.feePolicyService.remove(id);
    }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @Get('analysis/conflicts')
    analyzeConflicts() {
        return this.feePolicyAnalyzerService.analyzeConflicts();
    }

    @RequirePermissions(Permission.VIEW_FEE_POLICIES)
    @Post('dry-run')
    dryRunCalculation(@Body() previewDto: FeePreviewDto) {
        return this.feePolicyAnalyzerService.dryRunCalculation(previewDto);
    }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @Post(':id/validate-activation')
    validatePolicyForActivation(@Param('id', ParseUUIDPipe) id: string) {
        return this.feePolicyService.findOne(id).then(policy =>
            this.feePolicyAnalyzerService.validatePolicyForActivation(policy)
        );
    }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @Post(':id/canary/start')
    startCanaryDeployment(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: { percentage: number; durationHours?: number },
    ) {
        return this.feePolicyRolloutService.startCanaryDeployment(
            id,
            body.percentage,
            body.durationHours,
        );
    }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @Post(':id/canary/promote')
    promoteCanary(@Param('id', ParseUUIDPipe) id: string) {
        return this.feePolicyRolloutService.promoteCanary(id);
    }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @Post(':id/canary/rollback')
    rollbackCanary(@Param('id', ParseUUIDPipe) id: string) {
        return this.feePolicyRolloutService.rollbackCanary(id);
    }

    @RequirePermissions(Permission.VIEW_FEE_POLICIES)
    @Get(':id/canary/metrics')
    getCanaryMetrics(@Param('id', ParseUUIDPipe) id: string) {
        return this.feePolicyRolloutService.getCanaryMetrics(id);
    }

    @RequirePermissions(Permission.VIEW_FEE_POLICIES)
    @Get('canary/active')
    getActiveCanaries() {
        return this.feePolicyRolloutService.getActiveCanaries();
    }
}
