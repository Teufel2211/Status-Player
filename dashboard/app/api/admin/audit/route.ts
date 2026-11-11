import { ok, serverError, unauthorized, forbidden } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireFleetAdmin } from "@/lib/fleet-admin"

export const dynamic = "force-dynamic"

// Fleet-Protokoll: die neuesten Einträge aller Server — nur das Projekt-Konto.
export async function GET(request: Request) {
  const gate = await requireFleetAdmin(request)
  if (!gate.ok) return gate.status === 401 ? unauthorized() : forbidden("Nur der Projekt-Admin sieht das Protokoll")

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("audit_log")
    .select("id, server_id, action, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(200)

  if (error) return serverError()
  return ok({ entries: data ?? [] })
}
