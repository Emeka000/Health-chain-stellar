import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
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

@ApiTags('Readiness')
@ApiBearerAuth()
@Controller('api/v1/readiness')
export class ReadinessController {
  constructor(private readonly service: ReadinessService) {}

  @ApiOperation({ summary: 'Create a readiness checklist' })
  @ApiResponse({ status: 201, description: 'Checklist created' })
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

  @ApiOperation({ summary: 'Update checklist item dependencies' })
  @ApiResponse({ status: 201, description: 'Dependencies updated' })
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

  @ApiOperation({ summary: 'Update a checklist item' })
  @ApiResponse({ status: 200, description: 'Item updated' })
  @Patch(':id/items/:itemKey')
  updateItem(
    @Param('id') id: string,
    @Param('itemKey') itemKey: ReadinessItemKey,
    @Body() dto: UpdateReadinessItemDto,
    @Query('userId') userId: string = 'system',
  ) {
    return this.service.updateItem(id, itemKey, userId, dto);
  }

  @ApiOperation({ summary: 'Sign off on a readiness checklist' })
  @ApiResponse({ status: 201, description: 'Sign-off recorded' })
  @Post(':id/sign-off')
  signOff(
    @Param('id') id: string,
    @Body() dto: SignOffDto,
    @Query('userId') userId: string = 'system',
  ) {
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
