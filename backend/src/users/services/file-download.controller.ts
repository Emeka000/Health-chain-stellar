import * as fs from 'fs';
import * as path from 'path';

import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  Res,
  UnauthorizedException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ArtifactAccessClass, resolveAccessClass, StorageService } from './storage.service';

/**
 * Authenticated download endpoint for INTERNAL and PROTECTED artifacts (#591).
 *
 * Two access paths:
 *  1. HMAC-signed token (?key=…&exp=…&sig=…) — no session required; token carries expiry.
 *  2. JWT Bearer auth — for INTERNAL/PROTECTED artifacts without a pre-signed token.
 *
 * For S3 backends the handler issues a 302 redirect to a short-lived pre-signed URL.
 * For local backends it streams the file directly after path-traversal sanitisation.
 */
@ApiTags('Users')
@ApiBearerAuth()
@Controller('files')
export class FileDownloadController {
  constructor(private readonly storageService: StorageService) {}

  @ApiOperation({ summary: 'Get download' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('download')
  async download(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!key) throw new NotFoundException('Missing key parameter');

    // Path 1: HMAC-signed token — validate without requiring a session.
    if (exp && sig) {
      const expNum = parseInt(exp, 10);
      if (isNaN(expNum) || !this.storageService.verifyLocalToken(key, expNum, sig)) {
        throw new UnauthorizedException('Invalid or expired download token');
      }
      return this.serve(key, res);
    }

    // Path 2: JWT-authenticated — delegate to the guarded handler.
    // We call it directly here; the guard is on the sub-method.
    const subfolder = key.split('/')[0];
    const accessClass = resolveAccessClass(subfolder);
    if (accessClass !== ArtifactAccessClass.PUBLIC) {
      return this.downloadWithJwt(key, req, res);
    }

    return this.serve(key, res);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get download auth' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('download/auth')
  async downloadWithJwt(
    @Query('key') key: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!key) throw new NotFoundException('Missing key parameter');

    const user = req.user as { id: string; role: string } | undefined;
    if (!user?.id) throw new UnauthorizedException('Authentication required');

    const subfolder = key.split('/')[0];
    const accessClass = resolveAccessClass(subfolder);

    if (accessClass === ArtifactAccessClass.PROTECTED) {
      this.assertProtectedAccess(key, subfolder, user);
    }

    return this.serve(key, res);
  }

  /**
   * ACL enforcement for PROTECTED artifacts (#1162).
   *
   * - profile/{ownerId}/...  → only the owning user may download.
   * - evidence/... or proof/... → caller must be an admin (holds DISPUTE_RESOLVE /
   *   EXPORT_DISPUTES permissions by role assignment).
   */
  private assertProtectedAccess(
    key: string,
    subfolder: string,
    user: { id: string; role: string },
  ): void {
    if (subfolder === 'profile') {
      const ownerId = key.split('/')[1];
      if (!ownerId || ownerId !== user.id) {
        throw new ForbiddenException('Access denied');
      }
      return;
    }

    // evidence / proof — restricted to admin role which holds dispute-related permissions
    if (user.role !== 'admin') {
      throw new ForbiddenException('Access denied');
    }
  }

  private async serve(key: string, res: Response): Promise<void> {
    // For S3: redirect to a short-lived pre-signed URL (300 s).
    const signedUrl = await this.storageService.getSignedUrl(key, 300);
    if (signedUrl.startsWith('http')) {
      res.redirect(302, signedUrl);
      return;
    }

    // Local: sanitise path to prevent directory traversal, then stream.
    const uploadDir: string = (this.storageService as any).uploadDir;
    const resolved = path.resolve(uploadDir, key);
    if (!resolved.startsWith(path.resolve(uploadDir))) {
      throw new UnauthorizedException('Invalid key');
    }
    if (!fs.existsSync(resolved)) throw new NotFoundException('File not found');

    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(key)}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache');
    fs.createReadStream(resolved).pipe(res);
  }
}
