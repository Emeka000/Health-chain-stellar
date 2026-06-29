import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrderSplittingService } from '../services/order-splitting.service';
import { CreateSplitOrderDto } from '../dto/split-order.dto';
import { BloodRequestEntity } from '../entities/blood-request.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FulfillmentLegStatus } from '../entities/fulfillment-leg.entity';

@ApiTags('Blood Requests')
@ApiBearerAuth()
@Controller('api/v1/orders/split')
@UseGuards(JwtAuthGuard)
export class OrderSplittingController {
  constructor(
    private readonly orderSplittingService: OrderSplittingService,
    @InjectRepository(BloodRequestEntity)
    private readonly bloodRequestRepository: Repository<BloodRequestEntity>,
  ) {}

  @ApiOperation({ summary: 'Post' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post()
  async createSplitOrder(@Body() dto: CreateSplitOrderDto) {
    const parentRequest = await this.bloodRequestRepository.findOne({
      where: { id: dto.parentRequestId },
    });

    if (!parentRequest) {
      throw new Error('Parent request not found');
    }

    return this.orderSplittingService.createSplitOrder(
      parentRequest,
      dto.allocationSources,
    );
  }

  @ApiOperation({ summary: 'Get :parentRequestId progress' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':parentRequestId/progress')
  async getOrderProgress(@Param('parentRequestId') parentRequestId: string) {
    return this.orderSplittingService.getParentOrderProgress(parentRequestId);
  }

  @ApiOperation({ summary: 'Get :parentRequestId legs' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':parentRequestId/legs')
  async getFulfillmentLegs(@Param('parentRequestId') parentRequestId: string) {
    return this.orderSplittingService.getFulfillmentLegs(parentRequestId);
  }

  @ApiOperation({ summary: 'Patch legs :legId status' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch('legs/:legId/status')
  async updateLegStatus(
    @Param('legId') legId: string,
    @Body()
    body: {
      status: FulfillmentLegStatus;
      failureReason?: string;
      deliveryTime?: number;
    },
  ) {
    return this.orderSplittingService.updateLegStatus(legId, body.status, {
      failureReason: body.failureReason,
      deliveryTime: body.deliveryTime,
    });
  }

  @ApiOperation({ summary: 'Post legs :legId fail' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('legs/:legId/fail')
  async markLegAsFailed(
    @Param('legId') legId: string,
    @Body() body: { reason: string },
  ) {
    await this.orderSplittingService.handleLegFailure(legId, body.reason);
    return { success: true, message: 'Leg marked as failed' };
  }
}
