import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { ErrorDocumentationGenerator } from './error-documentation.generator';
import { ErrorDomain, ERROR_CODE_REGISTRY } from './error-taxonomy';

/**
 * Error Documentation Controller
 * 
 * Provides API endpoints for error code documentation
 */
@ApiTags('Errors')
@ApiBearerAuth()
@Controller('api/v1/errors')
export class ErrorDocumentationController {
    /**
     * Get all error codes
     */
    @ApiOperation({ summary: 'Get codes' })
    @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
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
    @ApiOperation({ summary: 'Get codes :code' })
    @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
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
    @ApiOperation({ summary: 'Get documentation json' })
    @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
    @Get('documentation/json')
    @Public()
    getJSONDocumentation() {
        return ErrorDocumentationGenerator.generateJSONDocumentation();
    }

    /**
     * Get error documentation in Markdown format
     */
    @ApiOperation({ summary: 'Get documentation markdown' })
    @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
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
    @ApiOperation({ summary: 'Get domains' })
    @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
    @Get('domains')
    @Public()
    getAllDomains() {
        return {
            domains: Object.values(ErrorDomain),
        };
    }
}
