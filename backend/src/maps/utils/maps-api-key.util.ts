// Known placeholder values left in .env.example / unconfigured deployments.
const PLACEHOLDER_MAPS_API_KEY_PATTERNS = [
  'your-google-maps-api-key',
  'your-maps-api-key',
  'changeme',
  'placeholder',
];

export function isPlaceholderMapsApiKey(apiKey: string | undefined): boolean {
  if (!apiKey) return false;
  const normalized = apiKey.trim().toLowerCase();
  return PLACEHOLDER_MAPS_API_KEY_PATTERNS.some((pattern) =>
    normalized.includes(pattern),
  );
}

export function isMapsApiKeyConfigured(apiKey: string | undefined): boolean {
  return !!apiKey && !isPlaceholderMapsApiKey(apiKey);
}
