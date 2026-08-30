import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';

import { CreateDeliveryProofDto } from './dto/create-delivery-proof.dto';
import { DeliveryProofQueryDto } from './dto/delivery-proof-query.dto';
import { DeliveryProofService } from './delivery-proof.service';

@ApiTags('Delivery Proofs')
@ApiBearerAuth()
@Controller('delivery-proofs')
export class DeliveryProofController {
  constructor(private readonly service: DeliveryProofService) {}

  @ApiOperation({ summary: 'Post' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post()
  create(@Body() dto: CreateDeliveryProofDto) {
    return this.service.create(dto);
  }

  /**
   * Endpoint for tamper-evident photo upload.
   * Multipart/form-data, max 5MB.
   * Closes #464
   */
  @ApiOperation({ summary: 'Post :orderId upload' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post(':orderId/upload')
  @UseInterceptors(FileInterceptor('image'))
  async uploadPhoto(
    @Param('orderId') orderId: string,
    @UploadedFile() file: any, // Express.Multer.File
  ) {
    return this.service.uploadPhoto(orderId, file);
  }


  @ApiOperation({ summary: 'Get :id' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.service.getDeliveryProof(id);
  }

  @ApiOperation({ summary: 'Get' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get()
  query(@Query() query: DeliveryProofQueryDto) {
    return this.service.queryProofs(query);
  }

  @ApiOperation({ summary: 'Get rider :riderId' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('rider/:riderId')
  byRider(
    @Param('riderId') riderId: string,
    @Query() query: DeliveryProofQueryDto,
  ) {
    return this.service.getProofsByRider(riderId, query);
  }

  @ApiOperation({ summary: 'Get request :requestId' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('request/:requestId')
  byRequest(
    @Param('requestId') requestId: string,
    @Query() query: DeliveryProofQueryDto,
  ) {
    return this.service.getProofsByRequest(requestId, query);
  }

  @ApiOperation({ summary: 'Get rider :riderId statistics' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('rider/:riderId/statistics')
  statistics(
    @Param('riderId') riderId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.getDeliveryStatistics(riderId, startDate, endDate);
  }
}
