import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { UserRole } from '../auth/enums/user-role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionsService } from '../auth/permissions.service';
import { ScopeResolutionService } from '../auth/scope-resolution.service';
import { ScopeEvaluationContext } from '../auth/scope-resolution.types';

@ApiTags('Permissions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('permissions')
export class PermissionsController {
  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly scopeResolutionService: ScopeResolutionService,
  ) {}

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

  /**
   * POST /permissions/evaluate
   * Evaluate a scope decision and return the full decision trace (Issue #619).
   * Useful for debugging and auditing authorization decisions.
   */
  @Post('evaluate')
  @RequirePermissions(Permission.MANAGE_ROLES)
  @ApiOperation({ summary: 'Evaluate a scope decision with full trace' })
  async evaluateScope(
    @Body() body: { scope: string; context: ScopeEvaluationContext },
  ) {
    return this.scopeResolutionService.evaluate(body.scope, body.context);
  }
}
