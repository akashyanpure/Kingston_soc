/**
 * Environment configuration (zod-validated). The package scripts load the repo-root .env with
 * `tsx --env-file=../../.env`. Relative directories resolve against the repo root so the API,
 * DB scripts and docs all agree on ./data/storage and ./data/mail.
 */
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ADDRESS_PROVIDERS } from '@soc/shared';
import type { AddressProvider } from '@soc/shared';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  API_HOST: z.string().default('0.0.0.0'), // 0.0.0.0 so a phone on the LAN can reach it
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  /** Pluggable auth. 'local' = email + password (argon2id). 'oidc' (Google Workspace) is planned. */
  AUTH_MODE: z.enum(['local']).default('local'),
  STORAGE_DIR: z.string().default('./data/storage'),
  MAIL_DIR: z.string().default('./data/mail'),
  MAIL_FROM: z.string().default('Kingston SOC <no-reply@kingston.gov.uk>'),
  /** Optional team inbox copied on every issued report. */
  MAIL_TEAM_INBOX: z.string().optional(),
  /** Set COOKIE_SECURE=true when served over HTTPS. Local LAN testing is plain HTTP. */
  COOKIE_SECURE: bool.optional(),
  /** Run the in-process PDF worker (disable to run it elsewhere). */
  PDF_WORKER: bool.default(true),
  PDF_POLL_MS: z.coerce.number().int().min(100).default(2000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Number of reverse-proxy hops to trust for X-Forwarded-For (cloud: CloudFront + Caddy = 2). 0 = off. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** Postcode/address lookup provider (packages/shared/src/address.ts). */
  ADDRESS_PROVIDER: z.enum(ADDRESS_PROVIDERS).default('postcodes_io'),
  OS_PLACES_API_KEY: z.string().optional(),
  /** Origin of the web app, used in emailed signing links: ${PUBLIC_URL}/sign/<token>. */
  PUBLIC_URL: z.url().default('http://localhost:5173'),
  /** Login attempts per IP+email per 15 minutes. */
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  /** Public /api/sign/* requests per IP per minute. */
  SIGN_RATE_LIMIT: z.coerce.number().int().min(1).default(30),
}).refine((e) => e.ADDRESS_PROVIDER !== 'os_places' || !!e.OS_PLACES_API_KEY, { message: 'OS_PLACES_API_KEY is required when ADDRESS_PROVIDER=os_places', path: ['OS_PLACES_API_KEY'] });

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  host: string;
  port: number;
  sessionSecret: string;
  authMode: 'local';
  storageDir: string;
  mailDir: string;
  mailFrom: string;
  mailTeamInbox: string | null;
  cookieSecure: boolean;
  pdfWorker: boolean;
  pdfPollMs: number;
  logLevel: string;
  trustProxyHops: number;
  addressProvider: AddressProvider;
  osPlacesApiKey: string | null;
  publicUrl: string;
  loginRateLimit: number;
  signRateLimit: number;
}

const fromRoot = (p: string) => (isAbsolute(p) ? p : resolve(REPO_ROOT, p));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment (see .env.example):\n${lines}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    host: e.API_HOST,
    port: e.API_PORT,
    sessionSecret: e.SESSION_SECRET,
    authMode: e.AUTH_MODE,
    storageDir: fromRoot(e.STORAGE_DIR),
    mailDir: fromRoot(e.MAIL_DIR),
    mailFrom: e.MAIL_FROM,
    mailTeamInbox: e.MAIL_TEAM_INBOX ?? null,
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    pdfWorker: e.PDF_WORKER,
    pdfPollMs: e.PDF_POLL_MS,
    logLevel: e.LOG_LEVEL,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    addressProvider: e.ADDRESS_PROVIDER,
    osPlacesApiKey: e.OS_PLACES_API_KEY || null,
    publicUrl: e.PUBLIC_URL.replace(/\/+$/, ''),
    loginRateLimit: e.LOGIN_RATE_LIMIT,
    signRateLimit: e.SIGN_RATE_LIMIT,
  };
}

/** Config for tests: no env needed. */
export function testConfig(over: Partial<Config> = {}): Config {
  return {
    nodeEnv: 'test',
    databaseUrl: 'pglite://memory',
    host: '127.0.0.1',
    port: 0,
    sessionSecret: 'test-secret-test-secret-test-secret',
    authMode: 'local',
    storageDir: resolve(REPO_ROOT, 'data/test-storage'),
    mailDir: resolve(REPO_ROOT, 'data/test-mail'),
    mailFrom: 'Kingston SOC <no-reply@kingston.gov.uk>',
    mailTeamInbox: null,
    cookieSecure: false,
    pdfWorker: false,
    pdfPollMs: 2000,
    logLevel: 'silent',
    trustProxyHops: 0,
    addressProvider: 'none',
    osPlacesApiKey: null,
    publicUrl: 'http://localhost:5173',
    loginRateLimit: 1000,
    signRateLimit: 1000,
    ...over,
  };
}
