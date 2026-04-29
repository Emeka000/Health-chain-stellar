import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import {
  CreateChecklistDto,
  QueryReadinessDto,
  SignOffDto,
  UpdateReadinessItemDto,
} from './dto/readiness.dto';
import { ReadinessEntityType, ReadinessItemKey } from './enums/readiness.enum';
import { ReadinessService } from './readiness.service';

@Controller('api/v1/readiness')
export class ReadinessController {
  constructor(private readonly service: ReadinessService) {}

  @Post()
  create(@Body() dto: CreateChecklistDto) {
    return this.service.createChecklist(dto);
  }

  @Get()
  list(@Query() query: QueryReadinessDto) {
    return this.service.listChecklists(query);
  }

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

  @Get('blocked')
  listBlocked() {
    return this.service.listBlocked();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.service.getChecklist(id);
  }

  @Get(':id/report')
  getReport(@Param('id') id: string) {
    return this.service.getReadinessReport(id);
  }

  @Get('entity/:type/:entityId')
  getByEntity(
    @Param('type') type: ReadinessEntityType,
    @Param('entityId') entityId: string,
  ) {
    return this.service.getChecklistByEntity(type, entityId);
  }

  @Patch(':id/items/:itemKey')
  updateItem(
    @Param('id') id: string,
    @Param('itemKey') itemKey: ReadinessItemKey,
    @Body() dto: UpdateReadinessItemDto,
    // In production this comes from JWT; using header for simplicity
    @Query('userId') userId: string = 'system',
  ) {
    return this.service.updateItem(id, itemKey, userId, dto);
  }

  @Post(':id/sign-off')
  signOff(
    @Param('id') id: string,
    @Body() dto: SignOffDto,
    @Query('userId') userId: string = 'system',
  ) {
    return this.service.signOff(id, userId, dto);
  }

  @Get('gate/:type/:entityId')
  isReady(
    @Param('type') type: ReadinessEntityType,
    @Param('entityId') entityId: string,
  ) {
    return this.service.isReady(type, entityId);
  }
}
