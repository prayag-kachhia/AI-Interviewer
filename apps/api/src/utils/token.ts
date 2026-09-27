import crypto from 'crypto';

const SECRET = process.env.JWT_SECRET || 'ai-interviewer-secret-key-slice-b';

export interface LocalTokenPayload {
  userId: string;
  email: string;
  exp: number;
}

export function hashPassword(password: string): string {
  const salt = 'slice-b-salt';
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export function generateLocalToken(userId: string, email: string): string {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days expiration
  const payload: LocalTokenPayload = { userId, email, exp };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SECRET).update(encodedPayload).digest('base64url');
  return `local_${encodedPayload}.${signature}`;
}

export function verifyLocalToken(token: string): LocalTokenPayload | null {
  if (!token.startsWith('local_')) return null;
  const parts = token.slice(6).split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', SECRET).update(encodedPayload).digest('base64url');
  if (signature !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as LocalTokenPayload;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
