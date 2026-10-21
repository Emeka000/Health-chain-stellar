export function createCorsOptions(corsOrigin: string) {
  return {
    origin: corsOrigin.split(',').map((origin) => origin.trim()),
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      'Idempotency-Key',
      'X-Correlation-Id',
      'X-Request-Id',
      'X-Geo-Hint',
    ],
    exposedHeaders: [
      'X-Correlation-Id',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
      'X-API-Compatibility-Class',
      'X-API-Response-Shape',
      'Deprecation',
      'Sunset',
      'Link',
    ],
  };
}