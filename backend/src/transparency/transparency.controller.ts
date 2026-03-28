import { Controller, Get } from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';

import { TransparencyService } from './transparency.service';

@Public()
@Controller('transparency')
export class TransparencyController {
  constructor(private readonly transparencyService: TransparencyService) {}

  @Get('metrics')
  getPublicMetrics() {
    return this.transparencyService.getPublicMetrics();
  }
}
