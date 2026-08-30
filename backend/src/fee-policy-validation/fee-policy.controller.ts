import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import {
  CreateFeePolicyDto,
  FeeBreakdownDto,
  FeePolicyResponseDto,
  QuotePaymentDto,
  UpdateFeePolicyDto,
} from './fee-policy.dto';
import { FeePolicyService } from './fee-policy.service';

@ApiTags('Fee Policies')
@Controller('fee-policies')
export class FeePolicyController {
  constructor(private readonly service: FeePolicyService) {}

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  @Post()
  @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
  @ApiOperation({ summary: 'Create a new fee policy' })
  @ApiResponse({ status: 201, type: FeePolicyResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid fee bounds' })
  create(@Body() dto: CreateFeePolicyDto): Promise<FeePolicyResponseDto> {
    return this.service.create(dto);
  }

  @Get()
  @RequirePermissions(Permission.VIEW_FEE_POLICIES)
  @ApiOperation({ summary: 'List all fee policies' })
  @ApiResponse({ status: 200, type: [FeePolicyResponseDto] })
  findAll(): Promise<FeePolicyResponseDto[]> {
    return this.service.findAll();
  }

  @Get(':id')
  @RequirePermissions(Permission.VIEW_FEE_POLICIES)
  @ApiOperation({ summary: 'Get a specific fee policy' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: FeePolicyResponseDto })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FeePolicyResponseDto> {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
  @ApiOperation({ summary: 'Update a fee policy' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({ type: UpdateFeePolicyDto })
  @ApiResponse({ status: 200, type: FeePolicyResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid fee bounds' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeePolicyDto,
  ): Promise<FeePolicyResponseDto> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a fee policy' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.service.remove(id);
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  @Put(':id/activate')
  @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
  @ApiOperation({ summary: 'Activate a fee policy' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: FeePolicyResponseDto })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FeePolicyResponseDto> {
    return this.service.activate(id);
  }

  @Put(':id/deactivate')
  @RequirePermissions(Permission.MANAGE_FEE_POLICIES)
  @ApiOperation({ summary: 'Deactivate a fee policy' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: FeePolicyResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FeePolicyResponseDto> {
    return this.service.deactivate(id);
  }

  // ─── Simulation ────────────────────────────────────────────────────────────

  @Post('quote')
  @RequirePermissions(Permission.VIEW_FEE_POLICIES)
  @ApiOperation({
    summary: 'Simulate a payment against an active policy',
    description:
      'Returns a full fee breakdown. Rejects amounts or policy configs that violate bounds.',
  })
  @ApiBody({ type: QuotePaymentDto })
  @ApiResponse({ status: 201, type: FeeBreakdownDto })
  @ApiResponse({
    status: 422,
    description: 'Payment validation failed (bound violation)',
  })
  @ApiResponse({
    status: 400,
    description: 'Policy not active',
  })
  quotePayment(@Body() dto: QuotePaymentDto): Promise<FeeBreakdownDto> {
    return this.service.quotePayment(dto);
  }
}
