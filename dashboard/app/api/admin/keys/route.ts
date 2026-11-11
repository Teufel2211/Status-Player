import { ok, serverError, unauthorized, forbidden } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireFleetAdmin } from "@/lib/fleet-admin"

export const dynamic = "force-dynamic"

// Alle aktiven API-Keys aller Server — nur das Projekt-Konto (Admin-Dashboard).
export async function GET(request: Request) {
  const gate = await requireFleetAdmin(request)
  if (!gate.ok) return gate.status === 401 ? unauthorized() : forbidden("Nur der Projekt-Admin sieht alle Keys")

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
