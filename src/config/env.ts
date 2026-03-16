import { z } from 'zod'

// Empty string from docker-compose ${VAR:-} expansion treated as absent
const optionalUrl = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.string().url().optional(),
)
const optionalSecret = (min: number) =>
  z.preprocess((v) => (v === '' ? undefined : v), z.string().min(min).optional())

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // TRUST_PROXY: set true ONLY when this server runs behind a trusted reverse proxy.
  // Uses explicit string comparison — z.coerce.boolean() converts "false" → true (JS gotcha).
  TRUST_PROXY: z.preprocess(
    (v) => v === 'true' || v === '1' || v === true,
    z.boolean().default(false),
  ),

  // Database — required in staging/production, optional with default for local dev
  DATABASE_URL: z.string().min(1).default('sqlite:./data/feature-config.db'),

  // Manifest — required, but has a local dev default
  MANIFEST_PATH: z.string().min(1).default('./manifest/elph-nova-feature-manifest.json'),
  DEFAULT_PRODUCT_ID: z.string().min(1).default('elph_nova'),

  // Public base URL
  FEATURE_CONFIG_PUBLIC_BASE_URL: optionalUrl,
  FEATURE_CONFIG_ADMIN_BASE_URL: optionalUrl,

  // SSO / JWKS — optional for local dev, required when AUTH_MODE is enabled
  SSO_JWKS_URI: optionalUrl,
  SSO_ISSUER: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  SSO_AUDIENCE: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  SSO_JWKS_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(3000),

  // Admin session
  ADMIN_SESSION_SECRET: optionalSecret(32),
  ADMIN_ALLOWED_IPS: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  ADMIN_COOKIE_SECRET: optionalSecret(32),

  // Dev only — forbidden on production
  DEV_ADMIN_PASSWORD: z.string().optional(),

  // CORS
  CORS_ALLOWED_ORIGINS: z.string().optional(),

  // Rate limits
  RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().positive().optional().default(300),
  RATE_LIMIT_ADMIN_MAX: z.coerce.number().int().positive().optional().default(100),

  TRUSTED_PROXY_IPS: z.string().optional(), // comma-separated IPs/CIDRs, required with TRUST_PROXY=true in production
}).superRefine((data, ctx) => {
  if (['staging', 'production'].includes(data.NODE_ENV) && !data.ADMIN_COOKIE_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ADMIN_COOKIE_SECRET is required in staging/production',
      path: ['ADMIN_COOKIE_SECRET'],
    })
  }
  if (['staging', 'production'].includes(data.NODE_ENV ?? 'development') && !data.CORS_ALLOWED_ORIGINS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'CORS_ALLOWED_ORIGINS is required in staging/production. Set to a comma-separated list of allowed origins (e.g. "https://app.example.com") or explicitly set to "none" to deny all cross-origin requests.',
      path: ['CORS_ALLOWED_ORIGINS'],
    })
  }
  if (data.TRUST_PROXY === true && data.NODE_ENV === 'production' && !data.TRUSTED_PROXY_IPS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'TRUST_PROXY=true in production requires TRUSTED_PROXY_IPS to be set (comma-separated CIDR list or IP addresses of your proxy tier) to prevent X-Forwarded-For spoofing.',
      path: ['TRUST_PROXY'],
    })
  }
  if (data.SSO_JWKS_URI && data.NODE_ENV !== 'development' && data.NODE_ENV !== 'test') {
    if (!data.SSO_ISSUER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SSO_ISSUER is required when SSO_JWKS_URI is configured in non-development environments',
        path: ['SSO_ISSUER'],
      })
    }
    if (!data.SSO_AUDIENCE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SSO_AUDIENCE is required when SSO_JWKS_URI is configured in non-development environments',
        path: ['SSO_AUDIENCE'],
      })
    }
  }
})

export type Env = z.infer<typeof envSchema>

export function parseEnv(raw: Record<string, string | undefined> = process.env as Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw)
  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  ${e.path.join('.') || 'root'}: ${e.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${formatted}`)
  }
  if (result.data.NODE_ENV === 'production' && result.data.DEV_ADMIN_PASSWORD) {
    throw new Error('DEV_ADMIN_PASSWORD must not be set in production')
  }
  return result.data
}
