import {
  buildOpenApiResponseSnapshot,
  diffOpenApiSnapshots,
} from '../contract-tests/utils/openapi-diff';
import { assertNoUnapprovedBreaks } from '../contract-tests/utils/schema-diff';

describe('[CONTRACT] OpenAPI Diff Checks', () => {
  it('flags breaking OpenAPI response changes', () => {
    const previousDoc = {
      paths: {
        '/blood-matching/compatible-donors': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        donors: {
                          type: 'array',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const currentDoc = {
      paths: {
        '/blood-matching/compatible-donors': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const previous = buildOpenApiResponseSnapshot(
      'OpenApiResponses',
      '1.0.0',
      previousDoc,
    );
    const current = buildOpenApiResponseSnapshot(
      'OpenApiResponses',
      '1.1.0',
      currentDoc,
    );
    const diff = diffOpenApiSnapshots(previous, current);
    expect(diff.hasBreakingChanges).toBe(true);
    expect(() => assertNoUnapprovedBreaks(diff, 'OpenApiResponses')).toThrow();
  });

  it('allows additive OpenAPI response evolution', () => {
    const previousDoc = {
      paths: {
        '/blood-matching/compatible-donors': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        donors: {
                          type: 'array',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const currentDoc = {
      paths: {
        '/blood-matching/compatible-donors': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        donors: { type: 'array' },
                        recipientType: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const previous = buildOpenApiResponseSnapshot(
      'OpenApiResponses',
      '1.0.0',
      previousDoc,
    );
    const current = buildOpenApiResponseSnapshot(
      'OpenApiResponses',
      '1.1.0',
      currentDoc,
    );
    const diff = diffOpenApiSnapshots(previous, current);
    expect(diff.hasBreakingChanges).toBe(false);
  });
});
