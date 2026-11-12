import { ok, serverError, unauthorized, badRequest, forbidden } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"
import { hashAuditUuid } from "@/lib/hash"
import { validatePathUuid } from "@/lib/validators"


export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: { uuid: string } }
) {
  if (!validatePathUuid(params.uuid)) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.role !== "owner" && session.role !== "admin") return forbidden("Nur Owner/Admin können exportieren")

  const sb = getServiceClient()
  const serverId = session.server_id
  // audit_log speichert gepepperte Hashes (lib/audit.ts -> hashAuditUuid),
  // nicht die rohe UUID. Ohne diese Ableitung blieb der Audit-Teil des
  // DSGVO-Exports immer leer. Treffer als Handelnder ODER als Ziel.
  const uuidHash = hashAuditUuid(params.uuid)

  const [players, audit] = await Promise.all([
    (sb as any).from("players").select("*").eq("uuid", params.uuid).eq("server_id", serverId),
    (sb as any)
      .from("audit_log")
      .select("*")
      .or(`who_uuid_hash.eq.${uuidHash},target_uuid_hash.eq.${uuidHash}`)
      .eq("server_id", serverId),
  ])

  return ok({
    player_data: players.data ?? [],
    audit_log: audit.data ?? [],
    exported_at: new Date().toISOString(),
  })
}
