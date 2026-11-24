import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { RidersService } from './riders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

const MAX_LEADERBOARD_LIMIT = 100;

@ApiTags('riders')
@Controller('riders')
export class RidersController {
  constructor(private readonly ridersService: RidersService) {}

  @Get('leaderboard')
  @ApiOperation({ summary: 'Get rider leaderboard' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  async getLeaderboard(
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    const boundedLimit = Math.min(
      Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 10, 1),
      MAX_LEADERBOARD_LIMIT,
    );
    return this.ridersService.getLeaderboard(boundedLimit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get rider by id' })
  @UseGuards(JwtAuthGuard)
  async getRider(@Param('id', ParseIntPipe) id: number) {
    return this.ridersService.findById(id);
  }
}
