import { ok, serverError, unauthorized, forbidden } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"

export const dynamic = "force-dynamic"

// Alle aktiven API-Keys aller Server — nur für den Owner (Admin-Dashboard).
export async function GET(request: Request) {
  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.role !== "owner") return forbidden("Nur der Owner sieht alle Keys")

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("api_keys")
    .select("id, server_id, key_prefix, scopes, created_at, expires_at")
    .eq("revoked", false)
    .order("created_at", { ascending: false })
    .limit(500)

  if (error) return serverError()
  return ok({ keys: data ?? [] })
}
