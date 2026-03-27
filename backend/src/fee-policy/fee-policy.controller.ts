import { Controller, Post, Body, Get, Put, Delete, Param, HttpCode, HttpStatus, ParseUUIDPipe } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { FeePolicyService } from './fee-policy.service';
import { CreateFeePolicyDto, UpdateFeePolicyDto, FeePreviewDto, FeeBreakdownDto } from './dto/fee-policy.dto';

@Controller('fee-policy')
export class FeePolicyController {
    constructor(private readonly feePolicyService: FeePolicyService) { }

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
}
