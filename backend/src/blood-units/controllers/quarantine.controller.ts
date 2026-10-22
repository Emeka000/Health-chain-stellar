import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  CreateQuarantineCaseDto,
  FinalizeQuarantineDto,
  QueryQuarantineCasesDto,
  UpdateQuarantineReviewDto,
} from '../dto/quarantine.dto';
import { QuarantineService } from '../services/quarantine.service';

@ApiTags('blood-units/quarantine')
@ApiBearerAuth()
@Controller('blood-units/quarantine')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuarantineController {
  constructor(private readonly quarantineService: QuarantineService) {}

  @Post()
  @Roles('admin', 'quality_manager')
  @ApiOperation({ summary: 'Create a quarantine case for a blood unit' })
  @ApiResponse({ status: 201, description: 'Quarantine case created' })
  async createCase(
    @Body() dto: CreateQuarantineCaseDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.quarantineService.createCase(dto, user);
  }

  @Get()
  @Roles('admin', 'quality_manager', 'auditor')
  @ApiOperation({ summary: 'List quarantine cases' })
  @ApiResponse({ status: 200, description: 'Quarantine cases returned' })
  async listCases(@Query() query: QueryQuarantineCasesDto) {
    return this.quarantineService.listCases(query);
  }

  @Patch(':id/review')
  @Roles('admin', 'quality_manager')
  @ApiOperation({ summary: 'Update quarantine case review state' })
  @ApiResponse({ status: 200, description: 'Quarantine case updated' })
  async updateReview(
    @Param('id') id: string,
    @Body() dto: UpdateQuarantineReviewDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.quarantineService.updateReview(id, dto, user);
  }

  @Patch(':id/finalize')
  @Roles('admin', 'quality_manager')
  @ApiOperation({ summary: 'Finalize a quarantine case disposition' })
  @ApiResponse({ status: 200, description: 'Quarantine case finalized' })
  async finalizeCase(
    @Param('id') id: string,
    @Body() dto: FinalizeQuarantineDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.quarantineService.finalizeCase(id, dto, user);
  }
}
