import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  CORS_ORIGINS: z.string().default("*"),

  // ── Database (Neon) ──
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().default(10),

  // ── Redis (Upstash) ──
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // ── Authentication ──
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  OTP_TTL_SEC: z.coerce.number().default(300),
  OTP_LENGTH: z.coerce.number().default(6),
  SOS_PIN_MIN_LENGTH: z.coerce.number().default(4),

  // ── Dojah (Identity — NIN/BVN, Driver's License) ──
  DOJAH_BASE_URL: z.string().url().default("https://api.dojah.io"),
  DOJAH_APP_ID: z.string(),
  DOJAH_PRIVATE_KEY: z.string(),
  DOJAH_TIMEOUT_MS: z.coerce.number().default(15000),

  // ── Termii (SMS) ──
  TERMII_BASE_URL: z.string().url().default("https://api.ng.termii.com"),
  TERMII_API_KEY: z.string(),
  TERMII_SENDER_ID: z.string().default("BeSafe"),
  TERMII_TIMEOUT_MS: z.coerce.number().default(10000),

  // ── Resend (Email) ──
  RESEND_API_KEY: z.string(),
  RESEND_FROM_EMAIL: z.string().email(),

  // ── Webhooks ──
  LSG_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  LSG_WEBHOOK_SECRET: z.string().optional(),

  // ── Feature Flags ──
  FEATURE_STUB_IDENTITY_PROVIDERS: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  FEATURE_STUB_SMS: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return parsed.data;
}
