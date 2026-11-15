import { ok, unauthorized } from "@/lib/response"
import { requireSession } from "@/lib/auth"
import { getServiceClient } from "@/lib/supabase"


export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const session = requireSession(request)
  if (!session) return unauthorized()

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("dashboard_users")
    .select("uuid, username, role, server_id, totp_enabled, is_fleet_admin")
    .eq("uuid", session.sub)
    .maybeSingle()

  if (error || !data) return unauthorized()

  return ok({
    uuid: data.uuid,
    username: data.username,
    role: data.role,
    server_id: data.server_id,
    totp_enabled: data.totp_enabled,
    // Darf unbekannte Mod-Builds freischalten (Release-Gate).
    is_fleet_admin: data.is_fleet_admin === true,
  })
}
