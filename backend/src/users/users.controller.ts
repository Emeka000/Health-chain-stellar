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
  BadRequestException,
  Request,
  UseInterceptors,
  UploadedFile,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { memoryStorage } from 'multer';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { Auditable } from '../common/audit/auditable.decorator';
import { AuditLogInterceptor } from '../common/audit/audit-log.interceptor';
import { getClientIp } from '../common/utils/client-ip.util';

import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @RequirePermissions(Permission.VIEW_USERS)
  @ApiOperation({ summary: 'Get' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @RequirePermissions(Permission.VIEW_USERS)
  @ApiOperation({ summary: 'Get profile' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('profile')
  getProfile(@Request() req: any) {
    return this.usersService.getProfile(req.user?.id);
  }

  @RequirePermissions(Permission.VIEW_USERS)
  @ApiOperation({ summary: 'Get :id' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @RequirePermissions(Permission.MANAGE_USERS)
  @ApiOperation({ summary: 'Patch profile' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch('profile')
  updateProfile(
    @Body() updateProfileDto: UpdateProfileDto,
    @Request() req: any,
  ) {
    return this.usersService.update(req.user?.id, updateProfileDto, {
      actorId: req.user?.id,
      ipAddress: getClientIp(req),
      userAgent: req.headers?.['user-agent'],
    });
  }

  @RequirePermissions(Permission.MANAGE_USERS)
  @Auditable({ action: 'user.updated', resourceType: 'User' })
  @UseInterceptors(AuditLogInterceptor)
  @ApiOperation({ summary: 'Patch :id' })
  @ApiResponse({ status: 200, description: 'Resource updated successfully' })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateProfileDto: UpdateProfileDto,
    @Request() req: any,
  ) {
    return this.usersService.update(id, updateProfileDto, {
      actorId: req.user?.id,
      ipAddress: getClientIp(req),
      userAgent: req.headers?.['user-agent'],
    });
  }

  @RequirePermissions(Permission.MANAGE_USERS)
  @ApiOperation({ summary: 'Post profile avatar' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('profile/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp'];
        if (!allowedMimeTypes.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              'Only PNG, JPEG and WebP images are allowed',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  uploadAvatar(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    return this.usersService.uploadAvatar(req.user?.id, file, {
      ipAddress: getClientIp(req),
      userAgent: req.headers?.['user-agent'],
    });
  }

  @RequirePermissions(Permission.MANAGE_USERS)
  @ApiOperation({ summary: 'Delete profile avatar' })
  @ApiResponse({ status: 200, description: 'Resource deleted successfully' })
  @Delete('profile/avatar')
  @HttpCode(HttpStatus.OK)
  deleteAvatar(@Request() req: any) {
    return this.usersService.deleteAvatar(req.user?.id, {
      ipAddress: getClientIp(req),
      userAgent: req.headers?.['user-agent'],
    });
  }

  @RequirePermissions(Permission.VIEW_USERS)
  @ApiOperation({ summary: 'Get profile activities' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('profile/activities')
  getProfileActivities(
    @Request() req: any,
    @Query('limit') limit: number = 50,
    @Query('offset') offset: number = 0,
  ) {
    return this.usersService.getProfileActivities(
      req.user?.id,
      Number(limit),
      Number(offset),
    );
  }

  @RequirePermissions(Permission.DELETE_USER)
  @ApiOperation({ summary: 'Delete :id' })
  @ApiResponse({ status: 200, description: 'Resource deleted successfully' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
