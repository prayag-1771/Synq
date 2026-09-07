import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Derives a stable 32-byte key for encrypting third-party integration tokens
 * (GitHub PATs / OAuth tokens) before they touch the database.
 */
const getEncryptionKey = (): Buffer => {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('FATAL: TOKEN_ENCRYPTION_KEY (or JWT_SECRET) is required to store integration tokens');
  }
  return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Encrypts a secret using AES-256-GCM. Output format: iv:authTag:ciphertext (all hex).
 */
export const encryptSecret = (plaintext: string): string => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

/**
 * Reverses encryptSecret. Throws if the payload was tampered with.
 */
export const decryptSecret = (payload: string): string => {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload');
  }
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
};

/**
 * Timing-safe comparison for webhook signature verification.
 */
export const safeCompare = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Verifies a GitHub webhook `X-Hub-Signature-256` header against the raw request body.
 */
export const verifyGithubSignature = (rawBody: Buffer, signature: string | undefined, secret: string): boolean => {
  if (!signature) return false;
  const digest = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeCompare(digest, signature);
};

export const generateWebhookSecret = (): string => crypto.randomBytes(24).toString('hex');
