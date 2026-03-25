import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { CreateRecordFromTemplateDto } from './dto/create-record-from-template.dto';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

interface AuthRequest extends Request {
  user: { id: string; email: string; role: string };
}

@Controller()
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @RequirePermissions(Permission.CREATE_TEMPLATE)
  @Post('templates')
  createTemplate(@Req() req: AuthRequest, @Body() dto: CreateTemplateDto) {
    return this.templatesService.createTemplate(req.user.id, dto);
  }

  @RequirePermissions(Permission.VIEW_TEMPLATES)
  @Get('templates')
  listTemplates(@Req() req: AuthRequest) {
    return this.templatesService.listTemplates(req.user.id);
  }

  @RequirePermissions(Permission.CREATE_RECORD_FROM_TEMPLATE)
  @Post('records/from-template/:templateId')
  createRecordFromTemplate(
    @Req() req: AuthRequest,
    @Param('templateId') templateId: string,
    @Body() dto: CreateRecordFromTemplateDto,
  ) {
    return this.templatesService.createRecordFromTemplate(req.user.id, templateId, dto);
  }
}
