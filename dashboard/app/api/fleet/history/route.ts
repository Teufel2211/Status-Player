import { ok, serverError, unauthorized, forbidden } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireFleetAdmin } from "@/lib/fleet-admin"

export const dynamic = "force-dynamic"

// Lists fleet config history (newest first) for rollbacks. Secrets are
// never returned — only whether one was set.
export async function GET(request: Request) {
  const gate = await requireFleetAdmin(request)
  if (!gate.ok) return gate.status === 401 ? unauthorized() : forbidden("Nur der Projekt-Admin sieht die Historie")

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("fleet_config_history")
    .select("id, dashboard_url, setup_secret, created_at")
    .order("id", { ascending: false })
    .limit(20)

  if (error) return serverError()

  const rows = (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
    id: r.id,
    dashboard_url: r.dashboard_url ?? "",
    has_secret: typeof r.setup_secret === "string" && r.setup_secret !== "",
    created_at: r.created_at ?? null,
  }))

  return ok(rows)
}
