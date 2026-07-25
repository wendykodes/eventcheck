import crypto from 'crypto';
import { readFileSync, writeFileSync, existsSync, accessSync, constants } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let SECRET_FILE;
try {
  accessSync('/data', constants.W_OK);
  SECRET_FILE = '/data/.jwt_secret';
} catch (e) {
  SECRET_FILE = join(__dirname, '..', '.jwt_secret');
}

let SECRET;
if (process.env.JWT_SECRET) {
  SECRET = process.env.JWT_SECRET;
} else if (existsSync(SECRET_FILE)) {
  SECRET = readFileSync(SECRET_FILE, 'utf8').trim();
} else {
  // Generate a deterministic fallback so tokens survive ephemeral container restarts.
  // For production security, set the JWT_SECRET environment variable on Railway.
  SECRET = crypto.createHash('sha256').update('eventcheck-default-secret-change-me').digest('hex');
  console.warn('Warning: Using default JWT secret. Set JWT_SECRET env variable for production security.');
  try {
    writeFileSync(SECRET_FILE, SECRET);
  } catch (err) {
    console.warn('Could not persist JWT secret to file:', err.message);
  }
}

const TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24h

export default {
  sign(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_EXPIRY })).toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
  },
  verify(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [header, body, sig] = parts;
      const expected = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
      if (payload.exp < Date.now()) return null;
      return payload;
    } catch {
      return null;
    }
  }
};
