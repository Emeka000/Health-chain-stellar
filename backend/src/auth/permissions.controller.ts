import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { UserRole } from '../auth/enums/user-role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionsService } from '../auth/permissions.service';

@ApiTags('Permissions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  /** Return effective permissions for a given role (admin UI). */
  @Get('role/:role')
  @RequirePermissions(Permission.MANAGE_ROLES)
  @ApiOperation({ summary: 'Get effective permissions for a role' })
  async getByRole(@Param('role') role: UserRole) {
    const permissions = await this.permissionsService.getPermissionsForRole(role);
    return { role, permissions };
  }

  /** Return effective permissions for every role (admin UI overview). */
  @Get()
  @RequirePermissions(Permission.MANAGE_ROLES)
  @ApiOperation({ summary: 'Get effective permissions for all roles' })
  async getAll() {
    const roles = Object.values(UserRole);
    const results = await Promise.all(
      roles.map(async (role) => ({
        role,
        permissions: await this.permissionsService.getPermissionsForRole(role),
      })),
    );
    return results;
  }
}
