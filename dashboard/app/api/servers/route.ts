import { ok, serverError, unauthorized, forbidden } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"

export const dynamic = "force-dynamic"

// Lists servers owned by the session owner (fleet overview).
export async function GET(request: Request) {
  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.role !== "owner") return forbidden("Nur der Owner sieht die Serverliste")

  const sb = getServiceClient()
  const { data: servers, error } = await (sb as any)
    .from("servers")
    .select("id, created_at, mod_enabled")
    .eq("owner_uuid", session.sub)
    .order("created_at", { ascending: true })

  if (error) return serverError()
  const list = Array.isArray(servers) ? servers : []

  const { data: fleet, error: fleetError } = await (sb as any)
    .from("fleet_config")
    .select("mod_enabled")
    .eq("id", 1)
    .maybeSingle()

  if (fleetError) return serverError()

  const out = []
  for (const s of list) {
    let known: number | null = null
    let online: number | null = null
    try {
      const { count: knownCount } = await (sb as any)
        .from("players")
        .select("uuid", { count: "exact", head: true })
        .eq("server_id", s.id)
      const { count: onlineCount } = await (sb as any)
        .from("players")
        .select("uuid", { count: "exact", head: true })
        .eq("server_id", s.id)
        .eq("is_online", true)
      known = knownCount ?? 0
      online = onlineCount ?? 0
    } catch {
      // counts stay null
    }
    out.push({
      id: s.id,
      created_at: s.created_at ?? null,
      known,
      online,
      mod_enabled: s.mod_enabled !== false,
    })
  }

  return ok({
    servers: out,
    global_mod_enabled: fleet?.mod_enabled !== false,
  })
}
