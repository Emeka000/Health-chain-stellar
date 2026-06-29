import { Controller, Post, Body } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UssdService } from './ussd.service';

class UssdRequestDto {
  sessionId: string;
  serviceCode: string;
  phoneNumber: string;
  text: string;
}

@ApiTags('USSD')
@ApiBearerAuth()
@Controller('api/v1/ussd')
export class UssdController {
  constructor(private readonly ussdService: UssdService) {}

  @ApiOperation({ summary: 'Post callback' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('callback')
  async handleUssdCallback(@Body() dto: UssdRequestDto): Promise<string> {
    return this.ussdService.handleUssdRequest(
      dto.sessionId,
      dto.phoneNumber,
      dto.text,
    );
  }
}
