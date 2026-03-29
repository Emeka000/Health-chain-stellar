import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to extract and set language from request
 */
@Injectable()
export class LocalizationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Extract language from multiple possible sources
    let language: string;

    // 1. Check URL query parameter
    if (req.query.lang) {
      language = String(req.query.lang).toLowerCase().split('-')[0];
    }
    // 2. Check Accept-Language header
    else if (req.get('Accept-Language')) {
      language = req.get('Accept-Language')!.split(',')[0].split('-')[0].toLowerCase();
    }
    // 3. Check custom language header
    else if (req.get('X-Language')) {
      language = String(req.get('X-Language')).toLowerCase().split('-')[0];
    }
    // 4. Default to English
    else {
      language = 'en';
    }

    // Normalize to supported languages
    language = ['en', 'fr'].includes(language) ? language : 'en';

    // Attach to request for use in controllers
    (req as any).language = language;

    // Add to response headers for client awareness
    res.setHeader('Content-Language', language);

    next();
  }
}

/**
 * Custom type for Express Request with language
 */
declare global {
  namespace Express {
    interface Request {
      language?: string;
    }
  }
}
