import { describe, it, expect } from 'vitest';

function isValidRedirect(redirect: string | null): boolean {
  if (!redirect) return false;
  return redirect.startsWith('/') && !redirect.startsWith('//');
}

describe('Redirect URL validation', () => {
  it('should allow relative paths starting with /', () => {
    expect(isValidRedirect('/dashboard')).toBe(true);
    expect(isValidRedirect('/profile')).toBe(true);
    expect(isValidRedirect('/settings/integration')).toBe(true);
  });

  it('should reject absolute URLs', () => {
    expect(isValidRedirect('https://evil-phishing-site.com')).toBe(false);
    expect(isValidRedirect('http://malicious.com')).toBe(false);
    expect(isValidRedirect('ftp://files.com')).toBe(false);
  });

  it('should reject protocol-relative URLs (double slash)', () => {
    expect(isValidRedirect('//evil-phishing-site.com')).toBe(false);
    expect(isValidRedirect('//malicious.com')).toBe(false);
  });

  it('should allow null/empty to fall back to default', () => {
    expect(isValidRedirect(null)).toBe(false);
    expect(isValidRedirect('')).toBe(false);
  });
});