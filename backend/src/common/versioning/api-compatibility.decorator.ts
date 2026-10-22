import { SetMetadata } from '@nestjs/common';

export enum ApiCompatibilityClass {
  ADDITIVE = 'additive',
  STRICT = 'strict',
  DEPRECATED = 'deprecated',
}

export interface ApiDeprecationMetadata {
  deprecation: boolean;
  sunset: string;
  successorPath?: string;
}

export const API_COMPATIBILITY_CLASS_KEY = 'api:compatibility:class';
export const API_DEPRECATION_KEY = 'api:compatibility:deprecation';
export const API_LEGACY_ADAPTER_KEY = 'api:compatibility:legacy-adapter';

export type LegacyAdapterFn = (data: unknown) => unknown;

export const ApiCompatibility = (compatibilityClass: ApiCompatibilityClass) =>
  SetMetadata(API_COMPATIBILITY_CLASS_KEY, compatibilityClass);

export const ApiDeprecation = (metadata: ApiDeprecationMetadata) =>
  SetMetadata(API_DEPRECATION_KEY, metadata);

export const ApiLegacyAdapter = (adapter: LegacyAdapterFn) =>
  SetMetadata(API_LEGACY_ADAPTER_KEY, adapter);
