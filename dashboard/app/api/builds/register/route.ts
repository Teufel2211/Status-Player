import crypto from "crypto"
import { badRequest, ok, serverError, tooMany, unauthorized } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { getEnv } from "@/lib/env"
import { verifyAttestStrings } from "@/lib/attest"
import { hashIp } from "@/lib/hash"
import { checkRateLimit, getRateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit"
import { z } from "zod"

export const dynamic = "force-dynamic"

// CI -> Registry: traegt ein fertig signiertes Release-JAR ein.
//
// Auth ist NICHT der Supabase-Service-Role-Key, sondern ein eigenes Token
// (GitHub-Secret STATUSMOD_BUILD_TOKEN == Vercel-Env BUILD_REGISTRY_TOKEN).
// Damit kann ein kompromittiertes CI-Secret nur Builds eintragen, nicht die
// Datenbank lesen.
//
// Die Signatur wird gegen `attest_keys` geprueft - dieselbe Pruefung wie beim
// Sync. Ein Fremd-JAR (ohne gueltiges Attest) landet so nie in der Registry.

const RegisterSchema = z.object({
  // base64url ohne Padding (Header-Format des Mods)
  attest: z.string().min(1).max(4096),
  // base64, 64 Byte
  sig: z.string().min(1).max(512),
})

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) return null
  const token = header.slice(7).trim()
  return token.length > 0 ? token : null
}

/**
 * Konstantzeit-Vergleich ueber SHA-256-Digests: timingSafeEqual wirft bei
 * unterschiedlicher Laenge, und die Laenge des Tokens soll nicht durchscheinen.
 */
function tokenMatches(given: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(given).digest()
  const b = crypto.createHash("sha256").update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  const ipHash = hashIp(request.headers.get("x-forwarded-for") ?? "unknown")
  const rate = checkRateLimit(`builds-register:${ipHash}`, RATE_LIMITS.BUILD_REGISTER)
  if (!rate.allowed) return tooMany("Zu viele Registrierungen")

  const expected = getEnv().BUILD_REGISTRY_TOKEN
  // Kein Token konfiguriert -> Route ist abgeschaltet (503, nicht 401: das ist
  // ein Deployment-Fehler, kein Client-Fehler).
  if (!expected) return serverError("Build-Registrierung ist nicht konfiguriert")

  const token = bearerToken(request)
  if (!token || !tokenMatches(token, expected)) return unauthorized()

  let body: unknown
  try { body = await request.json() } catch { return badRequest() }

  const parsed = RegisterSchema.safeParse(body)
  if (!parsed.success) return badRequest()

  const sb = getServiceClient()
  const attest = await verifyAttestStrings(sb, parsed.data.attest, parsed.data.sig)
  if (attest.status === "missing") {
    return badRequest("invalid_attest")
  }
  if (attest.status === "invalid") {
    return badRequest(`invalid_attest: ${attest.reason}`)
  }

  const f = attest.fields
  const { error } = await (sb as any)
    .from("builds")
    .upsert(
      {
        build_id: f.build_id,
        version: f.version,
        loader: f.loader,
        minecraft: f.minecraft,
        classes_sha256: f.classes_sha256,
        resources_sha256: f.resources_sha256,
        key_id: f.key_id,
        registered_at: new Date().toISOString(),
      },
      { onConflict: "build_id" }
    )

  if (error) {
    console.error(`[builds/register] upsert failed: ${error.code ?? "unknown"}`)
    return serverError()
  }

  return ok({ ok: true, build_id: f.build_id }, 200)
}
