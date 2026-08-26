import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z.string().default('*'),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().default(10),

  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  OTP_TTL_SEC: z.coerce.number().default(300),
  OTP_LENGTH: z.coerce.number().default(6),
  SOS_PIN_MIN_LENGTH: z.coerce.number().default(4),

  MONO_BASE_URL: z.string().url(),
  MONO_SECRET_KEY: z.string(),
  MONO_PUBLIC_KEY: z.string().optional(),
  MONO_TIMEOUT_MS: z.coerce.number().default(15000),

  VERIFYME_BASE_URL: z.string().url(),
  VERIFYME_USER_ID: z.string(),
  VERIFYME_API_KEY: z.string(),
  VERIFYME_TIMEOUT_MS: z.coerce.number().default(15000),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  TWILIO_TIMEOUT_MS: z.coerce.number().default(10000),

  LSG_WEBHOOK_URL: z.string().url().optional().or(z.literal('')),
  LSG_WEBHOOK_SECRET: z.string().optional(),

  FEATURE_STUB_IDENTITY_PROVIDERS: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  FEATURE_STUB_SMS: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return parsed.data;
}
