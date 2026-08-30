/**
 * HTTP Client with automatic token refresh
 * Implements request queue pattern to prevent duplicate refresh calls
 */

import { useAuthStore } from '../stores/auth.store';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 10_000;

/** Full-jitter exponential backoff delay */
function retryDelay(attempt: number): number {
  const exponential = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const capped = Math.min(RETRY_MAX_DELAY_MS, exponential);
  return Math.floor(Math.random() * capped);
}

function isTransientError(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Only safe/idempotent methods may be auto-retried; retrying POST/PATCH risks duplicate mutations */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT']);

function isRetryableMethod(method?: string): boolean {
  return IDEMPOTENT_METHODS.has((method ?? 'GET').toUpperCase());
}

interface RequestConfig extends RequestInit {
  skipAuth?: boolean;
  _retry?: boolean;
}

interface RefreshResponse {
  access_token: string;
  refresh_token?: string;
}

// Queue to hold pending requests during token refresh
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

/**
 * Add request to queue and wait for new token
 */
function subscribeTokenRefresh(callback: (token: string) => void): void {
  refreshSubscribers.push(callback);
}

/**
 * Notify all queued requests with new token
 */
function onTokenRefreshed(token: string): void {
  refreshSubscribers.forEach((callback) => callback(token));
  refreshSubscribers = [];
}

/**
 * Refresh access token using refresh token
 */
async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken, clearAuth } = useAuthStore.getState();

  if (!refreshToken) {
    return null;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      throw new Error('Token refresh failed');
    }

    const data: RefreshResponse = await response.json();
    
    // Update tokens in store
    const { updateAccessToken, setTokens } = useAuthStore.getState();
    
    if (data.refresh_token) {
      setTokens(data.access_token, data.refresh_token);
    } else {
      updateAccessToken(data.access_token);
    }

    return data.access_token;
  } catch (error) {
    // Refresh failed - clear auth and redirect
    clearAuth();
    
    // Redirect to login with reason
    if (typeof window !== 'undefined') {
      window.location.href = '/auth/signin?reason=session_expired';
    }
    
    return null;
  }
}

/**
 * Main HTTP client with automatic token refresh and jitter-based retry
 */
export async function httpClient<T = unknown>(
  endpoint: string,
  config: RequestConfig = {},
  _attempt = 0,
): Promise<T> {
  const { skipAuth = false, _retry = false, ...fetchConfig } = config;
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;

  // FIX: Use Record<string, string> to allow dynamic header keys like 'Authorization'
  const headers: Record<string, string> = {
    ...(!(fetchConfig.body instanceof FormData) && { 'Content-Type': 'application/json' }),
    ...(fetchConfig.headers as Record<string, string>),
  };

  // Add auth token if not skipped
  if (!skipAuth) {
    const { accessToken } = useAuthStore.getState();
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
  }

  try {
    const response = await fetch(url, {
      ...fetchConfig,
      headers,
    });

    // Handle 401 Unauthorized — token refresh, not a transient retry
    if (response.status === 401 && !skipAuth && !_retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          subscribeTokenRefresh((newToken: string) => {
            httpClient<T>(endpoint, { ...config, _retry: true })
              .then(resolve)
              .catch(reject);
          });
        });
      }

      isRefreshing = true;

      try {
        const newToken = await refreshAccessToken();
        if (newToken) {
          onTokenRefreshed(newToken);
          return httpClient<T>(endpoint, { ...config, _retry: true });
        } else {
          throw new Error('Token refresh failed');
        }
      } finally {
        isRefreshing = false;
      }
    }

    // Retry transient errors (5xx, 429) with jitter-based backoff — idempotent methods only
    if (
      isTransientError(response.status) &&
      isRetryableMethod(fetchConfig.method) &&
      _attempt < RETRY_MAX_ATTEMPTS
    ) {
      const delay = retryDelay(_attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return httpClient<T>(endpoint, config, _attempt + 1);
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return response.json();
    }

    return response.text() as T;
  } catch (error) {
    // Retry network-level failures (fetch throws) with jitter-based backoff — idempotent methods only
    if (
      isRetryableMethod(fetchConfig.method) &&
      _attempt < RETRY_MAX_ATTEMPTS &&
      !(error instanceof Error && error.message.startsWith('HTTP'))
    ) {
      const delay = retryDelay(_attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return httpClient<T>(endpoint, config, _attempt + 1);
    }
    throw error;
  }
}

/**
 * Convenience methods
 */
export const api = {
  get: <T = unknown>(endpoint: string, config?: RequestConfig) =>
    httpClient<T>(endpoint, { ...config, method: 'GET' }),

  post: <T = unknown>(endpoint: string, data?: unknown, config?: RequestConfig) =>
    httpClient<T>(endpoint, {
      ...config,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T = unknown>(endpoint: string, data?: unknown, config?: RequestConfig) =>
    httpClient<T>(endpoint, {
      ...config,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),

  patch: <T = unknown>(endpoint: string, data?: unknown, config?: RequestConfig) =>
    httpClient<T>(endpoint, {
      ...config,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T = unknown>(endpoint: string, config?: RequestConfig) =>
    httpClient<T>(endpoint, { ...config, method: 'DELETE' }),
};