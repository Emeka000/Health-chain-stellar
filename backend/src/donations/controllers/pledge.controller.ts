import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseInterceptors,
  UseGuards,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Public } from '../../auth/decorators/public.decorator';
import { PledgeEntity } from '../entities/pledge.entity';
import { PledgeService } from '../services/pledge.service';
import { CreatePledgeDto, UpdatePledgeStatusDto } from '../dto';

@ApiTags('donations')
@Controller('donations/pledges')
@UseInterceptors(ClassSerializerInterceptor)
export class PledgeController {
  constructor(private readonly pledgeService: PledgeService) {}

  @Post()
  @ApiOperation({ summary: 'Create a recurring pledge with optional earmarks' })
  @ApiResponse({ status: 201, type: PledgeEntity })
  async create(@Body() dto: CreatePledgeDto, @Request() req: { user?: { id?: string } }) {
    return this.pledgeService.createPledge({
      ...dto,
      donorUserId: req.user?.id,
    });
  }

  @Get('by-payer/:payerAddress')
  @Public()
  @ApiOperation({ summary: 'List pledges for a Stellar payer address' })
  async listByPayer(@Param('payerAddress') payerAddress: string) {
    return this.pledgeService.listByPayer(payerAddress);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get pledge by id' })
  async getOne(@Param('id') id: string, @Request() req: any) {
    return this.pledgeService.getById(id, req.user?.id);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Pause, resume (active), or complete a pledge' })
  async setStatus(@Param('id') id: string, @Body() dto: UpdatePledgeStatusDto, @Request() req: any) {
    return this.pledgeService.setStatus(id, dto.status, req.user?.id);
  }
}
