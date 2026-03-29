import { Module } from '@nestjs/common';
import { ValidationErrorService } from './services/validation-error.service';
import { LocalizationService } from './services/localization.service';
import { ValidationExceptionFilter, GlobalExceptionFilter } from './filters/validation.exception-filter';

@Module({
  providers: [
    ValidationErrorService,
    LocalizationService,
    {
      provide: 'VALIDATION_EXCEPTION_FILTER',
      useClass: ValidationExceptionFilter,
    },
    {
      provide: 'GLOBAL_EXCEPTION_FILTER',
      useClass: GlobalExceptionFilter,
    },
  ],
  exports: [ValidationErrorService, LocalizationService],
})
export class CommonModule {}
