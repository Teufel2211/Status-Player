import { z } from "zod"

const envSchema = z.object({
  SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_SECRET_PREVIOUS: z.string().optional().default(""),
  CORS_ORIGIN: z.string().refine((v) => v.startsWith("https://") || process.env.ALLOW_HTTP === "true", {
    message: "CORS_ORIGIN must start with https:// unless ALLOW_HTTP=true",
  }),
  DISCORD_WEBHOOK_SECRET: z.string().optional().default(""),
  MOD_SETUP_SECRET: z.string().optional().default(""),
  // Token fuer die CI, die fertige Builds in der Registry eintraegt
  // (POST /api/builds/register). Optional, damit ein Deployment ohne den
  // Schritt nicht bricht - die Route antwortet dann mit 503.
  BUILD_REGISTRY_TOKEN: z.string().optional().default(""),
  ALLOW_HTTP: z.string().optional().default("false"),
})

type Env = z.infer<typeof envSchema>

let _env: Env | null = null

export function getEnv(): Env {
  if (_env) return _env
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten())
    throw new Error("Invalid environment variables")
  }
  _env = parsed.data
  return _env
}
