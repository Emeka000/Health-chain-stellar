import { SchemaSnapshot, createSnapshot } from './schema-snapshot.matcher';
import { SchemaDiffResult, diffSnapshots } from './schema-diff';

interface OpenApiDoc {
  paths?: Record<
    string,
    Record<string, { responses?: Record<string, { content?: unknown }> }>
  >;
}

/**
 * Build a stable, diffable response-shape map from OpenAPI paths.
 */
export function buildOpenApiResponseSnapshot(
  name: string,
  version: string,
  doc: OpenApiDoc,
): SchemaSnapshot {
  const map: Record<string, unknown> = {};
  const paths = doc.paths ?? {};
  for (const path of Object.keys(paths).sort()) {
    const methods = paths[path] ?? {};
    for (const method of Object.keys(methods).sort()) {
      const op = methods[method];
      const responses = op.responses ?? {};
      const key = `${method.toUpperCase()} ${path}`;
      map[key] = responses;
    }
  }
  return createSnapshot(name, version, map);
}

export function diffOpenApiSnapshots(
  previous: SchemaSnapshot,
  current: SchemaSnapshot,
): SchemaDiffResult {
  return diffSnapshots(previous, current);
}
