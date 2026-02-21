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
import { UsersService } from './users.service';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

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
  getProfile() {
    // TODO: Get user ID from JWT token
    return this.usersService.getProfile('user-id-placeholder');
  }

  @RequirePermissions(Permission.VIEW_USERS)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @RequirePermissions(Permission.MANAGE_USERS)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: any) {
    return this.usersService.update(id, updateUserDto);
  }

  @RequirePermissions(Permission.DELETE_USER)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
