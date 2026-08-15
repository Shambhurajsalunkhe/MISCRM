import { z } from 'zod'

/**
 * Server-side environment validation.
 *
 * Do NOT import this from middleware or any edge-runtime module — Next.js
 * statically replaces `process.env.X` at build time and cannot inline a
 * dynamic read of the whole `process.env` object. Edge code should read the
 * specific variable it needs directly (see `src/lib/auth/jwt.ts`).
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET must be at least 32 characters'),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')

  throw new Error(
    `Invalid environment configuration.\n${issues}\n\n` +
      'Copy .env.example to .env and fill in the values.',
  )
}

export const env = parsed.data
