import {
    ERROR_CODE_REGISTRY,
    ErrorCodeMetadata,
    StandardErrorCode,
    ErrorDomain,
    StandardErrorResponse,
} from './error-taxonomy';

/**
 * Error Documentation Generator
 * 
 * Generates OpenAPI documentation for error responses
 */
export class ErrorDocumentationGenerator {
    /**
     * Get all error codes for a domain
     */
    static getErrorCodesForDomain(domain: ErrorDomain): ErrorCodeMetadata[] {
        return Object.values(ERROR_CODE_REGISTRY).filter(
            (meta) => meta.domain === domain,
        );
    }

    /**
     * Get all error codes
     */
    static getAllErrorCodes(): ErrorCodeMetadata[] {
        return Object.values(ERROR_CODE_REGISTRY);
    }

    /**
     * Generate OpenAPI error response schema
     */
    static generateOpenAPIErrorSchema(
        errorCodes: StandardErrorCode[],
    ): Record<string, any> {
        const examples: Record<string, any> = {};

        for (const code of errorCodes) {
            const metadata = ERROR_CODE_REGISTRY[code];
            if (!metadata) continue;

            const exampleResponse: StandardErrorResponse = {
                statusCode: metadata.httpStatus,
                errorCode: code,
                domain: metadata.domain,
                message: metadata.message,
                details: metadata.description,
                correlationId: '550e8400-e29b-41d4-a716-446655440000',
                requestId: '550e8400-e29b-41d4-a716-446655440001',
                timestamp: '2024-01-01T00:00:00.000Z',
                path: '/api/v1/example',
                method: 'GET',
                severity: metadata.severity,
                retryable: metadata.retryable,
                remediation: metadata.remediationActions.map((action) => ({
                    action,
                    description: `Remediation for ${action}`,
                })),
            };

            examples[code] = {
                summary: metadata.message,
                description: metadata.description,
                value: exampleResponse,
            };
        }

        return {
            type: 'object',
            required: [
                'statusCode',
                'errorCode',
                'domain',
                'message',
                'correlationId',
                'timestamp',
                'path',
                'method',
                'severity',
                'retryable',
                'remediation',
            ],
            properties: {
                statusCode: {
                    type: 'integer',
                    description: 'HTTP status code',
                    example: 400,
                },
                errorCode: {
                    type: 'string',
                    enum: errorCodes,
                    description: 'Standardized error code',
                },
                domain: {
                    type: 'string',
                    enum: Object.values(ErrorDomain),
                    description: 'Error domain',
                },
                message: {
                    type: 'string',
                    description: 'Human-readable error message',
                },
                details: {
                    type: 'string',
                    description: 'Detailed error description',
                },
                correlationId: {
                    type: 'string',
                    format: 'uuid',
                    description: 'Correlation ID for tracing',
                },
                requestId: {
                    type: 'string',
                    format: 'uuid',
                    description: 'Request ID',
                },
                timestamp: {
                    type: 'string',
                    format: 'date-time',
                    description: 'Error timestamp',
                },
                path: {
                    type: 'string',
                    description: 'Request path',
                },
                method: {
                    type: 'string',
                    description: 'HTTP method',
                },
                severity: {
                    type: 'string',
                    enum: ['INFO', 'WARNING', 'ERROR', 'CRITICAL'],
                    description: 'Error severity',
                },
                retryable: {
                    type: 'boolean',
                    description: 'Whether the request can be retried',
                },
                remediation: {
                    type: 'array',
                    description: 'Remediation hints',
                    items: {
                        type: 'object',
                        properties: {
                            action: {
                                type: 'string',
                                description: 'Remediation action',
                            },
                            description: {
                                type: 'string',
                                description: 'Action description',
                            },
                            params: {
                                type: 'object',
                                description: 'Action parameters',
                            },
                        },
                    },
                },
                metadata: {
                    type: 'object',
                    description: 'Additional error metadata',
                },
                validationErrors: {
                    type: 'array',
                    description: 'Validation errors (for validation failures)',
                    items: {
                        type: 'object',
                        properties: {
                            field: { type: 'string' },
                            message: { type: 'string' },
                            constraint: { type: 'string' },
                            value: {},
                        },
                    },
                },
            },
            examples,
        };
    }

    /**
     * Generate markdown documentation
     */
    static generateMarkdownDocumentation(): string {
        const domains = Object.values(ErrorDomain);
        let markdown = '# API Error Taxonomy\n\n';
        markdown += '## Overview\n\n';
        markdown +=
            'This document describes all standardized error codes used across the API.\n\n';
        markdown += '## Error Response Format\n\n';
        markdown += '```json\n';
        markdown += JSON.stringify(
            {
                statusCode: 400,
                errorCode: 'VALIDATION_FAILED',
                domain: 'VALIDATION',
                message: 'Validation failed',
                details: 'One or more fields failed validation',
                correlationId: '550e8400-e29b-41d4-a716-446655440000',
                timestamp: '2024-01-01T00:00:00.000Z',
                path: '/api/v1/orders',
                method: 'POST',
                severity: 'ERROR',
                retryable: false,
                remediation: [
                    {
                        action: 'VALIDATE_INPUT',
                        description: 'Validate your input parameters',
                    },
                ],
            },
            null,
            2,
        );
        markdown += '\n```\n\n';

        markdown += '## Error Codes by Domain\n\n';

        for (const domain of domains) {
            const codes = this.getErrorCodesForDomain(domain);
            if (codes.length === 0) continue;

            markdown += `### ${domain}\n\n`;
            markdown += '| Code | HTTP Status | Message | Retryable |\n';
            markdown += '|------|-------------|---------|----------|\n';

            for (const code of codes) {
                markdown += `| \`${code.code}\` | ${code.httpStatus} | ${code.message} | ${code.retryable ? '✓' : '✗'} |\n`;
            }

            markdown += '\n';
        }

        return markdown;
    }

    /**
     * Generate JSON documentation
     */
    static generateJSONDocumentation(): Record<string, any> {
        const domains: Record<string, ErrorCodeMetadata[]> = {};

        for (const domain of Object.values(ErrorDomain)) {
            const codes = this.getErrorCodesForDomain(domain);
            if (codes.length > 0) {
                domains[domain] = codes;
            }
        }

        return {
            version: '1.0.0',
            generatedAt: new Date().toISOString(),
            domains,
        };
    }
}
