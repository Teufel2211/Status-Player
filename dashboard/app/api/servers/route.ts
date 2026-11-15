import { ok, serverError, unauthorized, forbidden } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"
import { isFleetAdmin } from "@/lib/fleet-admin"

export const dynamic = "force-dynamic"

// Serverliste fuer das Admin-Dashboard.
//
// Normale Owner sehen nur ihre eigenen Server. Ein Fleet-Admin sieht alle
// Server (er schaltet unbekannte Mod-Builds frei, siehe
// app/api/server/[server_id]/build/route.ts).
export async function GET(request: Request) {
  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.role !== "owner") return forbidden("Nur der Owner sieht die Serverliste")

  const sb = getServiceClient()
  const fleetAdmin = await isFleetAdmin(sb, session.sub)

  let query = (sb as any)
    .from("servers")
    .select(
      "id, created_at, mod_enabled, owner_uuid, build_check_status, build_check_build_id, " +
        "build_check_at, build_override_id"
    )
    .order("created_at", { ascending: true })

  if (!fleetAdmin) query = query.eq("owner_uuid", session.sub)

  const { data: servers, error } = await query

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
      owned: s.owner_uuid === session.sub,
      build_check_status: s.build_check_status ?? null,
      build_check_build_id: s.build_check_build_id ?? null,
      build_check_at: s.build_check_at ?? null,
      build_override_id: s.build_override_id ?? null,
    })
  }

  return ok({
    servers: out,
    global_mod_enabled: fleet?.mod_enabled !== false,
    is_fleet_admin: fleetAdmin,
  })
}
