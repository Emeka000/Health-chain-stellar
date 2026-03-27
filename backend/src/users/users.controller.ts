import { extname } from 'path';

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
  Request,
  UseInterceptors,
  UploadedFile,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { diskStorage } from 'multer';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @RequirePermissions(Permission.VIEW_USERS)
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @RequirePermissions(Permission.VIEW_USERS)
  @Get('profile')
  getProfile(@Request() req: any) {
    return this.usersService.getProfile(req.user?.id);
  }

  @RequirePermissions(Permission.VIEW_USERS)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @RequirePermissions(Permission.MANAGE_USERS)
  @Patch('profile')
  updateProfile(
    @Body() updateProfileDto: UpdateProfileDto,
    @Request() req: any,
  ) {
    return this.usersService.update(req.user?.id, updateProfileDto, {
      actorId: req.user?.id,
      ipAddress: req.headers?.['x-forwarded-for'] ?? req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @RequirePermissions(Permission.MANAGE_USERS)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateProfileDto: UpdateProfileDto,
    @Request() req: any,
  ) {
    return this.usersService.update(id, updateProfileDto, {
      actorId: req.user?.id,
      ipAddress: req.headers?.['x-forwarded-for'] ?? req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @RequirePermissions(Permission.MANAGE_USERS)
  @Post('profile/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/temp',
        filename: (req, file, cb) => {
          const randomName = Array(32)
            .fill(null)
            .map(() => Math.round(Math.random() * 16).toString(16))
            .join('');
          cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  uploadAvatar(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    return this.usersService.uploadAvatar(req.user?.id, file, {
      ipAddress: req.headers?.['x-forwarded-for'] ?? req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @RequirePermissions(Permission.MANAGE_USERS)
  @Delete('profile/avatar')
  @HttpCode(HttpStatus.OK)
  deleteAvatar(@Request() req: any) {
    return this.usersService.deleteAvatar(req.user?.id, {
      ipAddress: req.headers?.['x-forwarded-for'] ?? req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @RequirePermissions(Permission.VIEW_USERS)
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
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
