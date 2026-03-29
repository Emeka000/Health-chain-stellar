import { createHmac, randomBytes } from 'crypto';

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP = 30; // seconds
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // ±1 step tolerance

/** Encode a Buffer as base32 (RFC 4648). */
export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31];
  }
  return output;
}

/** Decode a base32 string to a Uint8Array. */
export function base32Decode(encoded: string): Uint8Array {
  const str = encoded.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of str) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

/** Generate a cryptographically random 20-byte TOTP secret, base32-encoded. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Compute a single HOTP value for the given key and counter. */
function hotp(key: Uint8Array, counter: bigint): string {
  const counterBuf = new Uint8Array(8);
  const view = new DataView(counterBuf.buffer);
  view.setBigUint64(0, counter, false /* big-endian */);
  const hmac = createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** Verify a TOTP token against a base32-encoded secret with ±TOTP_WINDOW step tolerance. */
export function verifyTotp(secret: string, token: string): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const key = base32Decode(secret);
  const step = BigInt(Math.floor(Date.now() / 1000 / TOTP_STEP));
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
    if (hotp(key, step + BigInt(delta)) === token) return true;
  }
  return false;
}

/** Build an otpauth:// URI for QR code generation. */
export function buildOtpAuthUri(
  secret: string,
  email: string,
  issuer: string,
): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return (
    `otpauth://totp/${label}` +
    `?secret=${secret}` +
    `&issuer=${encodeURIComponent(issuer)}` +
    `&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP}`
  );
}
