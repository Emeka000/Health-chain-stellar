import { Controller, Post, Body, Get, Put, Delete, Param, HttpCode, HttpStatus, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { FeePolicyService } from './fee-policy.service';
import { FeePolicyAnalyzerService } from './fee-policy-analyzer.service';
import { FeePolicyRolloutService } from './fee-policy-rollout.service';
import { CreateFeePolicyDto, UpdateFeePolicyDto, FeePreviewDto, FeeBreakdownDto } from './dto/fee-policy.dto';

@ApiTags('Fee Policy')
@ApiBearerAuth()
@Controller('fee-policy')
export class FeePolicyController {
    constructor(
        private readonly feePolicyService: FeePolicyService,
        private readonly feePolicyAnalyzerService: FeePolicyAnalyzerService,
        private readonly feePolicyRolloutService: FeePolicyRolloutService,
    ) { }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @ApiOperation({ summary: 'Post' })
    @ApiResponse({ status: 201, description: 'Resource created successfully' })
    @Post()
    create(@Body() createFeePolicyDto: CreateFeePolicyDto) {
        return this.feePolicyService.create(createFeePolicyDto);
    }

    @RequirePermissions(Permission.VIEW_FEE_POLICIES)
    @ApiOperation({ summary: 'Get' })
    @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
    @Get()
    findAll() {
        return this.feePolicyService.findAll();
    }

    @RequirePermissions(Permission.VIEW_FEE_POLICIES)
    @ApiOperation({ summary: 'Get preview' })
    @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
    @Get('preview')
    previewFees(@Body() previewDto: FeePreviewDto): Promise<FeeBreakdownDto> {
        return this.feePolicyService.previewFees(previewDto);
    }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @ApiOperation({ summary: 'Get :id' })
    @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
    @Get(':id')
    findOne(@Param('id', ParseUUIDPipe) id: string) {
        return this.feePolicyService.findOne(id);
    }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @ApiOperation({ summary: 'Put :id' })
    @ApiResponse({ status: 200, description: 'Resource updated successfully' })
    @Put(':id')
    update(@Param('id', ParseUUIDPipe) id: string, @Body() updateFeePolicyDto: UpdateFeePolicyDto) {
        return this.feePolicyService.update(id, updateFeePolicyDto);
    }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @ApiOperation({ summary: 'Delete :id' })
    @ApiResponse({ status: 200, description: 'Resource deleted successfully' })
    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    remove(@Param('id', ParseUUIDPipe) id: string) {
        return this.feePolicyService.remove(id);
    }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @ApiOperation({ summary: 'Get analysis conflicts' })
    @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
    @Get('analysis/conflicts')
    analyzeConflicts() {
        return this.feePolicyAnalyzerService.analyzeConflicts();
    }

    @RequirePermissions(Permission.VIEW_FEE_POLICIES)
    @ApiOperation({ summary: 'Post dry run' })
    @ApiResponse({ status: 201, description: 'Resource created successfully' })
    @Post('dry-run')
    dryRunCalculation(@Body() previewDto: FeePreviewDto) {
        return this.feePolicyAnalyzerService.dryRunCalculation(previewDto);
    }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @ApiOperation({ summary: 'Post :id validate activation' })
    @ApiResponse({ status: 201, description: 'Resource created successfully' })
    @Post(':id/validate-activation')
    validatePolicyForActivation(@Param('id', ParseUUIDPipe) id: string) {
        return this.feePolicyService.findOne(id).then(policy =>
            this.feePolicyAnalyzerService.validatePolicyForActivation(policy)
        );
    }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @ApiOperation({ summary: 'Post :id canary start' })
    @ApiResponse({ status: 201, description: 'Resource created successfully' })
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
    @ApiOperation({ summary: 'Post :id canary promote' })
    @ApiResponse({ status: 201, description: 'Resource created successfully' })
    @Post(':id/canary/promote')
    promoteCanary(@Param('id', ParseUUIDPipe) id: string) {
        return this.feePolicyRolloutService.promoteCanary(id);
    }

    @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
    @ApiOperation({ summary: 'Post :id canary rollback' })
    @ApiResponse({ status: 201, description: 'Resource created successfully' })
    @Post(':id/canary/rollback')
    rollbackCanary(@Param('id', ParseUUIDPipe) id: string) {
        return this.feePolicyRolloutService.rollbackCanary(id);
    }

    @RequirePermissions(Permission.VIEW_FEE_POLICIES)
    @ApiOperation({ summary: 'Get :id canary metrics' })
    @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
    @Get(':id/canary/metrics')
    getCanaryMetrics(@Param('id', ParseUUIDPipe) id: string) {
        return this.feePolicyRolloutService.getCanaryMetrics(id);
    }

    @RequirePermissions(Permission.VIEW_FEE_POLICIES)
    @ApiOperation({ summary: 'Get canary active' })
    @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
    @Get('canary/active')
    getActiveCanaries() {
        return this.feePolicyRolloutService.getActiveCanaries();
    }
}
