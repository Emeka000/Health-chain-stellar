import { Injectable, Scope, Inject } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';

import { Request } from 'express';

@Injectable({ scope: Scope.REQUEST })
export class CorrelationIdService {
  constructor(@Inject(REQUEST) private request: Request) {}

  getCorrelationId(): string {
    return this.request.correlationId || 'unknown';
  }
}
