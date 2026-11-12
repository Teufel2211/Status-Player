import crypto from "crypto"
import { badRequest, ok, serverError, unauthorized } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { getEnv } from "@/lib/env"


export const dynamic = "force-dynamic"

/** Konstantzeit-Vergleich ueber SHA-256-Digests (wie builds/register). */
function tokenMatches(given: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(given).digest()
  const b = crypto.createHash("sha256").update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return unauthorized()

  const token = authHeader.slice(7).trim()
  const secret = getEnv().DISCORD_WEBHOOK_SECRET
  // Fail closed: without a configured secret, no webhook call is trusted.
  if (!secret || !token || !tokenMatches(token, secret)) return unauthorized()

  let body: unknown
  try { body = await request.json() } catch { return badRequest() }

  const { type, server_id, discord_id, payload } = body as Record<string, unknown>

  if (!type || typeof type !== "string") return badRequest()
  if (!server_id || typeof server_id !== "string") return badRequest()

  const sb = getServiceClient()

  const { data: link, error: linkError } = await (sb as any)
    .from("discord_links")
    .select("*")
    .eq("discord_id", discord_id)
    .eq("server_id", server_id)
    .maybeSingle()

  if (linkError || !link) return badRequest()

  const linkRecord = link as { id: number; role: string }

  switch (type) {
    case "sync": {
      const nextRole = (payload as Record<string, unknown>)?.role
      const roleUpdate =
        typeof nextRole === "string" && nextRole.length >= 1 && nextRole.length <= 32
          ? { role: nextRole }
          : {}
      const { error } = await (sb as any)
        .from("discord_links")
        .update(roleUpdate)
        .eq("id", linkRecord.id)
      if (error) return serverError()
      break
    }
    case "unlink": {
      const { error } = await (sb as any)
        .from("discord_links")
        .delete()
        .eq("id", linkRecord.id)
      if (error) return serverError()
      break
    }
    default:
      return badRequest()
  }

  return ok({ received: true })
}
