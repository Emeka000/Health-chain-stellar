import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

@Controller('dispatch')
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @RequirePermissions(Permission.VIEW_DISPATCH)
  @Get()
  findAll() {
    return this.dispatchService.findAll();
  }

  @RequirePermissions(Permission.VIEW_DISPATCH)
  @Get('stats')
  getStats() {
    return this.dispatchService.getDispatchStats();
  }

  @RequirePermissions(Permission.VIEW_DISPATCH)
  @Get('assignments')
  getAssignments(@Query('orderId') orderId?: string) {
    return this.dispatchService.getAssignmentLogs(orderId);
  }

  @RequirePermissions(Permission.VIEW_DISPATCH)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.dispatchService.findOne(id);
  }

  @RequirePermissions(Permission.CREATE_DISPATCH)
  @Post()
  create(@Body() createDispatchDto: any) {
    return this.dispatchService.create(createDispatchDto);
  }

  @RequirePermissions(Permission.MANAGE_DISPATCH)
  @Post('assign')
  assignOrder(
    @Body('orderId') orderId: string,
    @Body('riderId') riderId: string,
  ) {
    return this.dispatchService.assignOrder(orderId, riderId);
  }

  @RequirePermissions(Permission.MANAGE_DISPATCH)
  @Post('assignments/respond')
  respondToAssignment(
    @Body('orderId') orderId: string,
    @Body('riderId') riderId: string,
    @Body('accepted') accepted: boolean,
  ) {
    return this.dispatchService.respondToAssignment(orderId, riderId, accepted);
  }

  @RequirePermissions(Permission.UPDATE_DISPATCH)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDispatchDto: any) {
    return this.dispatchService.update(id, updateDispatchDto);
  }

  @RequirePermissions(Permission.UPDATE_DISPATCH)
  @Patch(':id/complete')
  completeDispatch(@Param('id') id: string) {
    return this.dispatchService.completeDispatch(id);
  }

  @RequirePermissions(Permission.UPDATE_DISPATCH)
  @Patch(':id/cancel')
  cancelDispatch(@Param('id') id: string, @Body('reason') reason: string) {
    return this.dispatchService.cancelDispatch(id, reason);
  }

  @RequirePermissions(Permission.DELETE_DISPATCH)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.dispatchService.remove(id);
  }
}
