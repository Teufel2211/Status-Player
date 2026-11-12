import { badRequest, ok, serverError, unauthorized } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"


export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const session = requireSession(request)
  if (!session) return unauthorized()

  const sb = getServiceClient()
  const now = new Date().toISOString()

  const { error: playerError } = await (sb as any)
    .from("players")
    .update({
      anonymized: true,
      username: null,
      status: null,
      color: null,
      settings: null,
      avatar: null,
      is_online: false,
      last_seen: null,
      status_expires_at: null,
      slowmode_seconds: 0,
    })
    .eq("uuid", session.sub)
    .eq("server_id", session.server_id)

  if (playerError) return serverError()

  const { error: blockedError } = await (sb as any)
    .from("blocked_players")
    .delete()
    .eq("uuid", session.sub)
    .eq("server_id", session.server_id)

  if (blockedError) return serverError()

  const { error: mutedError } = await (sb as any)
    .from("muted_players")
    .update({ muted_until: now })
    .eq("uuid", session.sub)
    .eq("server_id", session.server_id)

  if (mutedError) return serverError()

  return ok({ success: true, message: "Data anonymized. Full deletion in 24h." })
}
