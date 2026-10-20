import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';

import { CreateDeliveryProofDto } from './dto/create-delivery-proof.dto';
import { DeliveryProofQueryDto } from './dto/delivery-proof-query.dto';
import { DeliveryProofService } from './delivery-proof.service';
import {
  QueryDeliveryProofDto,
  UploadPhotoDto,
} from './dto/delivery-proof.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { Role } from '../auth/enums/role.enum';

interface AuthenticatedUser {
  id: string;
  role: Role;
  permissions?: Permission[];
}

@ApiTags('delivery-proofs')
@ApiBearerAuth()
@Controller('delivery-proofs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DeliveryProofController {
  constructor(private readonly deliveryProofService: DeliveryProofService) {}

  @Post()
  @ApiOperation({ summary: 'Create a delivery proof' })
  @ApiResponse({ status: 201, description: 'Delivery proof created' })
  @RequirePermissions(Permission.DELIVERY_PROOF_CREATE)
  create(@Body() dto: CreateDeliveryProofDto, @Req() req: Request) {
    return this.deliveryProofService.create(dto, req.user as AuthenticatedUser);
  }

  @Post(':orderId/upload')
  @ApiOperation({ summary: 'Upload a delivery proof photo' })
  @ApiResponse({ status: 201, description: 'Photo uploaded' })
  @UseInterceptors(FileInterceptor('image'))
  @RequirePermissions(Permission.DELIVERY_PROOF_CREATE)
  async uploadPhoto(
    @Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string,
    @UploadedFile() file: any, // Express.Multer.File
    @Body() dto: UploadPhotoDto,
    @Req() req: Request,
  ) {
    return this.deliveryProofService.uploadPhoto(
      orderId,
      file,
      req.user as AuthenticatedUser,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a delivery proof by id' })
  @ApiResponse({ status: 200, description: 'Delivery proof found' })
  @RequirePermissions(Permission.DELIVERY_PROOF_READ)
  getOne(@Param('id') id: string, @Req() req: Request) {
    return this.deliveryProofService.getOne(id, req.user as AuthenticatedUser);
  }

  @Get()
  @ApiOperation({ summary: 'Query delivery proofs' })
  @ApiResponse({ status: 200, description: 'Delivery proofs listed' })
  @RequirePermissions(Permission.DELIVERY_PROOF_READ)
  query(@Query() query: DeliveryProofQueryDto, @Req() req: Request) {
    return this.deliveryProofService.query(query, req.user as AuthenticatedUser);
  }

  @Get('rider/:riderId')
  @ApiOperation({ summary: 'List delivery proofs by rider' })
  @ApiResponse({ status: 200, description: 'Delivery proofs listed' })
  @RequirePermissions(Permission.DELIVERY_PROOF_READ)
  byRider(@Param('riderId') riderId: string, @Req() req: Request) {
    return this.deliveryProofService.byRider(
      riderId,
      req.user as AuthenticatedUser,
    );
  }

  @Get('request/:requestId')
  @ApiOperation({ summary: 'List delivery proofs by request' })
  @ApiResponse({ status: 200, description: 'Delivery proofs listed' })
  @RequirePermissions(Permission.DELIVERY_PROOF_READ)
  byRequest(@Param('requestId') requestId: string, @Req() req: Request) {
    return this.deliveryProofService.byRequest(
      requestId,
      req.user as AuthenticatedUser,
    );
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Get delivery proof statistics' })
  @ApiResponse({ status: 200, description: 'Statistics returned' })
  @RequirePermissions(Permission.DELIVERY_PROOF_READ)
  statistics(@Req() req: Request) {
    return this.deliveryProofService.statistics(req.user as AuthenticatedUser);
  }
}
