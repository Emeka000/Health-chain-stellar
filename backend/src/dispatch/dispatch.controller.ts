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
} from '@nestjs/common';
import { DispatchService } from './dispatch.service';

@Controller('dispatch')
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Get()
  findAll() {
    return this.dispatchService.findAll();
  }

  @Get('stats')
  getStats() {
    return this.dispatchService.getDispatchStats();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.dispatchService.findOne(id);
  }

  @Post()
  create(@Body() createDispatchDto: any) {
    return this.dispatchService.create(createDispatchDto);
  }

  @Post('assign')
  assignOrder(
    @Body('orderId') orderId: string,
    @Body('riderId') riderId: string,
  ) {
    return this.dispatchService.assignOrder(orderId, riderId);
  }

  @Patch(':id')
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
