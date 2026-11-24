import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const headerValue = req.headers['x-correlation-id'];
    const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    const correlationId =
      typeof candidate === 'string' && CORRELATION_ID_PATTERN.test(candidate)
        ? candidate
        : uuidv4();

    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
  }
}
