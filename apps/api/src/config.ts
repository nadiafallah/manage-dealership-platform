import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

// .env lives at the repository root; apps/api/.env may override for local work.
loadDotenv({ path: resolve(__dirname, '../../../.env'), quiet: true });
loadDotenv({ path: resolve(process.cwd(), '.env'), quiet: true });

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'preview', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  API_ALLOWED_ORIGINS: z.string().default(''),
  DB_DRIVER: z.enum(['pglite', 'postgres']).default('pglite'),
  PGLITE_DATA_DIR: z.string().default('.data/pglite'),
  DATABASE_URL: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  NODE_ID: z.string().min(1).default('dev-local'),
  SEED_DEMO_PASSWORD: z.string().optional(),
  // Browser tests only: owner of the synthetic dealership. The demo seed never runs in production.
  DEMO_OWNER_USERNAME: z.string().optional(),
  TOTP_AUTH_ENABLED: z.string().default('false').transform((v) => v === 'true'),
  PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
  AUTH_TOKEN_SECRET: z.preprocess((v)=>v===''?undefined:v,z.string().min(32).optional()),
  SMTP_HOST: z.string().trim().default(''),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_SECURE: z.string().default('true').transform((v) => v === 'true'),
  SMTP_USER: z.string().trim().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.string().trim().refine((v) => !/[\r\n]/.test(v), 'Invalid mail sender').default(''),
  // Login attempts per minute per client address (default 10).
  // Daily report files (the Emdad export is ~23.6 MB); only the upload route accepts raw bodies.
  DAILY_REPORT_MAX_BYTES: z.coerce.number().int().min(1_000_000).max(64 * 1024 * 1024).default(32 * 1024 * 1024),
  // Server-side 11:00 reminders; off in tests, which drive the scheduler directly.
  DAILY_SCHEDULER: z.string().default('true').transform((v) => v === 'true'),
  // Package 8: the demo seeds about twenty synthetic cars; 'false' keeps only the five base cases.
  DEMO_FLEET: z.string().default('true').transform((v) => v === 'true'),
  LOGIN_RATE_LIMIT: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().positive().optional()),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(overrides: Partial<Record<keyof AppConfig, string>> = {}): AppConfig {
  const cfg = envSchema.parse({ ...process.env, ...overrides });
  if (cfg.TOTP_AUTH_ENABLED && !cfg.AUTH_TOKEN_SECRET) {
    throw new Error('Personal sign-in requires AUTH_TOKEN_SECRET');
  }
  if (cfg.TOTP_AUTH_ENABLED && cfg.APP_ENV !== 'test' && !cfg.PUBLIC_APP_URL.startsWith('https://')) {
    throw new Error('Email sign-in requires an HTTPS PUBLIC_APP_URL');
  }
  if (cfg.DB_DRIVER === 'postgres' && !cfg.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when DB_DRIVER=postgres');
  }
  if (cfg.APP_ENV === 'production' && cfg.DB_DRIVER === 'pglite') {
    throw new Error('PGlite is for development and demo only; use DB_DRIVER=postgres in production');
  }
  return cfg;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
