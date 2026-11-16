import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';

const dataDir = resolve(process.env.SCYDE_DATA_DIR ?? join(process.cwd(), 'data'));
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

function loadSecretKey(): string {
  const fromEnv = process.env.SCYDE_SECRET_KEY;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SCYDE_SECRET_KEY must be set (min 16 chars) in production. Generate one with: openssl rand -hex 32');
  }
  // Dev fallback only: key stored next to the DB (NOT safe for production).
  const file = join(dataDir, 'dev-secret.key');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  console.warn('[config] SCYDE_SECRET_KEY not set — using dev key from', file);
  return readFileSync(file, 'utf8').trim();
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir,
  dbPath: join(dataDir, 'scydehub.db'),
  secretKey: loadSecretKey(),
  /** Force every integration into mock mode (UI development without a homelab). */
  mockAll: process.env.SCYDE_MOCK === '1' || process.env.SCYDE_MOCK === 'true',
  /** Optional pre-seeded admin (otherwise first-run setup with a code from the logs). */
  adminUser: process.env.SCYDE_ADMIN_USER ?? 'admin',
  adminPassword: process.env.SCYDE_ADMIN_PASSWORD,
  /** Set to true when served over HTTPS (behind nginx+certbot) so cookies get the Secure flag. */
  secureCookies: process.env.SCYDE_SECURE_COOKIES === '1' || process.env.SCYDE_SECURE_COOKIES === 'true',
  trustProxy: process.env.SCYDE_TRUST_PROXY ?? 'loopback,uniquelocal',
  webDir: process.env.SCYDE_WEB_DIR ?? resolve(process.cwd(), '../web/dist'),
  version: process.env.SCYDE_VERSION ?? '0.1.0',
  buildId: process.env.SCYDE_BUILD_ID ?? String(Date.now()),
  iconCdn: process.env.SCYDE_ICON_CDN ?? 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons',
};
