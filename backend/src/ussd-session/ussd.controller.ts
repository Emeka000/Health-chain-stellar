import {
  Controller,
  Post,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { UssdSessionDto } from './ussd.dto';
import { UssdService } from './ussd.service';
import { UssdRequest } from './ussd.types';

import type { Response } from 'express';

@ApiTags('USSD')
@Controller('ussd')
export class UssdController {
  private readonly logger = new Logger(UssdController.name);

  constructor(private readonly ussdService: UssdService) {}

  /**
   * Africa's Talking USSD gateway callback endpoint.
   * Africa's Talking sends a form-encoded POST and expects a plain-text response
   * prefixed with CON (continue session) or END (terminate session).
   */
  @Post('session')
  @HttpCode(HttpStatus.OK)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({ summary: "Handle Africa's Talking USSD session callback" })
  @ApiResponse({
    status: 200,
    description: 'USSD response text (CON/END prefixed)',
  })
  async handleSession(
    @Body() dto: UssdSessionDto,
    @Res() res: Response,
  ): Promise<void> {
    const request: UssdRequest = {
      sessionId: dto.sessionId,
      serviceCode: dto.serviceCode,
      phoneNumber: dto.phoneNumber,
      text: dto.text,
      networkCode: dto.networkCode,
      operator: dto.operator,
    };

    const { type, message } = await this.ussdService.handleSession(request);

    // Africa's Talking expects plain text: "CON <message>" or "END <message>"
    res.setHeader('Content-Type', 'text/plain');
    res.send(`${type} ${message}`);
  }
}
