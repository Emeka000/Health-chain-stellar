import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { ReputationAwareAssignmentService } from '../services/reputation-aware-assignment.service';

export class AssignRiderDto {
  @IsString()
  orderId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  pickupLat: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  pickupLon: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxCandidates?: number;
}

export class UpdateAssignmentWeightsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  distanceWeight?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ratingWeight?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  workloadWeight?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  acceptanceWeight?: number;
}

@ApiTags('Riders')
@ApiBearerAuth()
@Controller('riders/assignment')
export class AssignmentController {
  constructor(private readonly service: ReputationAwareAssignmentService) {}

  @RequirePermissions(Permission.MANAGE_RIDERS)
  @ApiOperation({ summary: 'Post' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post()
  assign(@Body() body: AssignRiderDto) {
    return this.service.assignRider(body);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get decisions :orderId' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('decisions/:orderId')
  getDecision(@Param('orderId') orderId: string) {
    return this.service.getDecision(orderId);
  }

  @RequirePermissions(Permission.VIEW_RIDERS)
  @ApiOperation({ summary: 'Get weights' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('weights')
  getWeights() {
    return this.service.getActiveWeights();
  }

  @RequirePermissions(Permission.MANAGE_RIDERS)
  @ApiOperation({ summary: 'Patch weights' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch('weights')
  updateWeights(@Body() body: UpdateAssignmentWeightsDto) {
    return this.service.updateWeights(body);
  }
}
