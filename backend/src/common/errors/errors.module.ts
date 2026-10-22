import { Module, Global } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { GlobalExceptionFilter } from './global-exception.filter';
import { ExceptionMapperService } from './exception-mapper.service';
import { ErrorDocumentationController } from './error-documentation.controller';

/**
 * Errors Module
 * 
 * Provides global error handling and standardized error responses
 */
@Global()
@Module({
    controllers: [ErrorDocumentationController],
    providers: [
        ExceptionMapperService,
        {
            provide: APP_FILTER,
            useClass: GlobalExceptionFilter,
        },
    ],
    exports: [ExceptionMapperService],
})
export class ErrorsModule { }
