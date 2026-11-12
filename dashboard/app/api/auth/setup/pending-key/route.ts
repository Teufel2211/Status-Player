import crypto from "crypto"
import { badRequest, unauthorized, serverError, ok } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { getEnv } from "@/lib/env"
import { decryptSecret } from "@/lib/hash"
import { checkRateLimit, RATE_LIMITS, getRateLimitHeaders } from "@/lib/rate-limit"
import { validatePathUuid } from "@/lib/validators"
import { NextResponse } from "next/server"


export const dynamic = "force-dynamic"

/** Konstantzeit-Vergleich ueber SHA-256-Digests (wie builds/register). */
function tokenMatches(given: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(given).digest()
  const b = crypto.createHash("sha256").update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

export async function GET(request: Request) {
  const env = getEnv()
  const expectedSecret = env.MOD_SETUP_SECRET
  if (!expectedSecret) return unauthorized()

  const auth = request.headers.get("authorization") ?? ""
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : ""
  if (!token || !tokenMatches(token, expectedSecret)) return unauthorized()

  const ip = request.headers.get("x-forwarded-for") ?? "unknown"
  const rl = checkRateLimit(`setup_pending:${ip}`, RATE_LIMITS.CODE_GENERATION)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 429, headers: getRateLimitHeaders(rl) })
  }

  const url = new URL(request.url)
  const serverId = url.searchParams.get("server_id") ?? ""
  if (!validatePathUuid(serverId)) return badRequest()

  const sb = getServiceClient()

  // Atomar per Delete-Returning: zwei parallele Polls liefern den Key nur
  // einmal aus (statt read→decrypt→delete mit Doppel-Lieferung).
  const { data: deleted, error: deleteError } = await (sb as any)
    .from("setup_pending_keys")
    .delete()
    .eq("server_id", serverId)
    .select("key_encrypted")

  if (deleteError) return serverError()

  if (!deleted || deleted.length === 0) {
    return ok({ pending: false })
  }

  const apiKey = decryptSecret(deleted[0].key_encrypted)
  if (!apiKey) return serverError()

  return ok({ pending: true, api_key: apiKey })
}
