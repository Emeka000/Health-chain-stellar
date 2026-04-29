import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator';
import { ErrorDocumentationGenerator } from './error-documentation.generator';
import { ErrorDomain, ERROR_CODE_REGISTRY } from './error-taxonomy';

/**
 * Error Documentation Controller
 * 
 * Provides API endpoints for error code documentation
 */
@Controller('api/v1/errors')
export class ErrorDocumentationController {
    /**
     * Get all error codes
     */
    @Get('codes')
    @Public()
    getAllErrorCodes(@Query('domain') domain?: ErrorDomain) {
        if (domain) {
            return {
                domain,
                codes: ErrorDocumentationGenerator.getErrorCodesForDomain(domain),
            };
        }

        return {
            codes: ErrorDocumentationGenerator.getAllErrorCodes(),
        };
    }

    /**
     * Get error code details
     */
    @Get('codes/:code')
    @Public()
    getErrorCodeDetails(@Query('code') code: string) {
        const metadata = ERROR_CODE_REGISTRY[code as keyof typeof ERROR_CODE_REGISTRY];

        if (!metadata) {
            return {
                error: 'Error code not found',
                code,
            };
        }

        return metadata;
    }

    /**
     * Get error documentation in JSON format
     */
    @Get('documentation/json')
    @Public()
    getJSONDocumentation() {
        return ErrorDocumentationGenerator.generateJSONDocumentation();
    }

    /**
     * Get error documentation in Markdown format
     */
    @Get('documentation/markdown')
    @Public()
    getMarkdownDocumentation() {
        return {
            format: 'markdown',
            content: ErrorDocumentationGenerator.generateMarkdownDocumentation(),
        };
    }

    /**
     * Get all error domains
     */
    @Get('domains')
    @Public()
    getAllDomains() {
        return {
            domains: Object.values(ErrorDomain),
        };
    }
}
