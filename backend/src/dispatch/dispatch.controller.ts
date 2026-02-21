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

  @Get()
  @RequirePermissions(Permission.READ_DISPATCH)
  findAll() {
    return this.dispatchService.findAll();
  }

  @Get('stats')
  @RequirePermissions(Permission.VIEW_ANALYTICS)
  getStats() {
    return this.dispatchService.getDispatchStats();
  }

  @Get('assignments')
  getAssignments(@Query('orderId') orderId?: string) {
    return this.dispatchService.getAssignmentLogs(orderId);
  }

  @Get(':id')
  @RequirePermissions(Permission.READ_DISPATCH)
  findOne(@Param('id') id: string) {
    return this.dispatchService.findOne(id);
  }

  @Post()
  @RequirePermissions(Permission.CREATE_DISPATCH)
  create(@Body() createDispatchDto: any) {
    return this.dispatchService.create(createDispatchDto);
  }

  @Post('assign')
  @RequirePermissions(Permission.ASSIGN_DISPATCH)
  assignOrder(
    @Body('orderId') orderId: string,
    @Body('riderId') riderId: string,
  ) {
    return this.dispatchService.assignOrder(orderId, riderId);
  }

  @Post('assignments/respond')
  respondToAssignment(
    @Body('orderId') orderId: string,
    @Body('riderId') riderId: string,
    @Body('accepted') accepted: boolean,
  ) {
    return this.dispatchService.respondToAssignment(orderId, riderId, accepted);
  }

  @Patch(':id')
  @RequirePermissions(Permission.UPDATE_DISPATCH)
  update(@Param('id') id: string, @Body() updateDispatchDto: any) {
    return this.dispatchService.update(id, updateDispatchDto);
  }

  @Patch(':id/complete')
  completeDispatch(@Param('id') id: string) {
    return this.dispatchService.completeDispatch(id);
  }

  @Patch(':id/cancel')
  cancelDispatch(@Param('id') id: string, @Body('reason') reason: string) {
    return this.dispatchService.cancelDispatch(id, reason);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.dispatchService.remove(id);
  }
}
