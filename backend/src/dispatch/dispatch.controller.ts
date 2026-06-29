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

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { DispatchService } from './dispatch.service';
import { CreateDispatchDto, UpdateDispatchDto, CancelDispatchDto } from './dto/dispatch.dto';

@ApiTags('Dispatch')
@ApiBearerAuth()
@Controller('dispatch')
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @RequirePermissions(Permission.VIEW_DISPATCH)
  @ApiOperation({ summary: 'Get' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get()
  findAll() {
    return this.dispatchService.findAll();
  }

  @RequirePermissions(Permission.VIEW_DISPATCH)
  @ApiOperation({ summary: 'Get stats' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('stats')
  getStats() {
    return this.dispatchService.getDispatchStats();
  }

  @RequirePermissions(Permission.VIEW_DISPATCH)
  @ApiOperation({ summary: 'Get assignments' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('assignments')
  getAssignments(@Query('orderId') orderId?: string) {
    return this.dispatchService.getAssignmentLogs(orderId);
  }

  @RequirePermissions(Permission.VIEW_DISPATCH)
  @ApiOperation({ summary: 'Get :id' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.dispatchService.findOne(id);
  }

  @RequirePermissions(Permission.CREATE_DISPATCH)
  @ApiOperation({ summary: 'Post' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post()
  create(@Body() dto: CreateDispatchDto) {
    return this.dispatchService.create(dto);
  }

  @RequirePermissions(Permission.DISPATCH_OVERRIDE)
  @ApiOperation({ summary: 'Post assign' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('assign')
  assignOrder(
    @Body('orderId') orderId: string,
    @Body('riderId') riderId: string,
  ) {
    return this.dispatchService.assignOrder(orderId, riderId);
  }

  @RequirePermissions(Permission.MANAGE_DISPATCH)
  @ApiOperation({ summary: 'Post assignments respond' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('assignments/respond')
  respondToAssignment(
    @Body('orderId') orderId: string,
    @Body('riderId') riderId: string,
    @Body('accepted') accepted: boolean,
  ) {
    return this.dispatchService.respondToAssignment(orderId, riderId, accepted);
  }

  @RequirePermissions(Permission.UPDATE_DISPATCH)
  @ApiOperation({ summary: 'Patch :id' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDispatchDto) {
    return this.dispatchService.update(id, dto);
  }

  @RequirePermissions(Permission.UPDATE_DISPATCH)
  @ApiOperation({ summary: 'Patch :id complete' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/complete')
  completeDispatch(@Param('id') id: string) {
    return this.dispatchService.completeDispatch(id);
  }

  @RequirePermissions(Permission.UPDATE_DISPATCH)
  @ApiOperation({ summary: 'Patch :id cancel' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id/cancel')
  cancelDispatch(@Param('id') id: string, @Body() dto: CancelDispatchDto) {
    return this.dispatchService.cancelDispatch(id, dto.reason);
  }

  @RequirePermissions(Permission.DELETE_DISPATCH)
  @ApiOperation({ summary: 'Delete :id' })
  @ApiResponse({ status: 200, description: 'Resource deleted successfully' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.dispatchService.remove(id);
  }
}
