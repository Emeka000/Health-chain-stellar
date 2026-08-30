import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  CreateChecklistDto,
  QueryReadinessDto,
  SignOffDto,
  UpdateReadinessItemDto,
} from './dto/readiness.dto';
import { ReadinessEntityType, ReadinessItemKey } from './enums/readiness.enum';
import { ReadinessService } from './readiness.service';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

@ApiTags('Readiness')
@ApiBearerAuth()
@Controller('api/v1/readiness')
export class ReadinessController {
  constructor(private readonly service: ReadinessService) {}

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post()
  create(@Body() dto: CreateChecklistDto) {
    return this.service.createChecklist(dto);
  }

  @ApiOperation({ summary: 'List readiness checklists' })
  @ApiResponse({ status: 200, description: 'List of checklists' })
  @Get()
  list(@Query() query: QueryReadinessDto) {
    return this.service.listChecklists(query);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post('dependencies')
  updateDependencies(
    @Body()
    dto: Array<{
      parentItemKey: ReadinessItemKey;
      dependsOnItemKey: ReadinessItemKey;
    }>,
  ) {
    return this.service.updateDependencies(dto);
  }

  @ApiOperation({ summary: 'List all blocked readiness items' })
  @ApiResponse({ status: 200, description: 'List of blocked items' })
  @Get('blocked')
  listBlocked() {
    return this.service.listBlocked();
  }

  @ApiOperation({ summary: 'Get a readiness checklist by ID' })
  @ApiResponse({ status: 200, description: 'Checklist record' })
  @Get(':id')
  getById(@Param('id') id: string) {
    return this.service.getChecklist(id);
  }

  @ApiOperation({ summary: 'Get readiness report for a checklist' })
  @ApiResponse({ status: 200, description: 'Readiness report' })
  @Get(':id/report')
  getReport(@Param('id') id: string) {
    return this.service.getReadinessReport(id);
  }

  @ApiOperation({ summary: 'Get readiness checklist by entity type and ID' })
  @ApiResponse({ status: 200, description: 'Checklist for entity' })
  @Get('entity/:type/:entityId')
  getByEntity(
    @Param('type') type: ReadinessEntityType,
    @Param('entityId') entityId: string,
  ) {
    return this.service.getChecklistByEntity(type, entityId);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Patch(':id/items/:itemKey')
  updateItem(
    @Param('id') id: string,
    @Param('itemKey') itemKey: ReadinessItemKey,
    @Body() dto: UpdateReadinessItemDto,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    return this.service.updateItem(id, itemKey, userId, dto);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Post(':id/sign-off')
  signOff(
    @Param('id') id: string,
    @Body() dto: SignOffDto,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    return this.service.signOff(id, userId, dto);
  }

  @ApiOperation({ summary: 'Check if an entity is ready' })
  @ApiResponse({ status: 200, description: 'Readiness gate result' })
  @Get('gate/:type/:entityId')
  isReady(
    @Param('type') type: ReadinessEntityType,
    @Param('entityId') entityId: string,
  ) {
    return this.service.isReady(type, entityId);
  }
}
