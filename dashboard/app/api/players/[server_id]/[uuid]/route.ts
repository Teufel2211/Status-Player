import { ok, serverError, unauthorized, badRequest, forbidden } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { authorizeData, requireSession } from "@/lib/auth"
import { validatePathUuid, PlayerStatusFieldSchema } from "@/lib/validators"
import { hmacUuid } from "@/lib/hash"


export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: { server_id: string; uuid: string } }
) {
  if (!validatePathUuid(params.server_id) || !validatePathUuid(params.uuid)) return badRequest()

  const auth = await authorizeData(request, "check", params.server_id)
  if (!auth) return unauthorized()

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("players")
    .select("*")
    .eq("server_id", params.server_id)
    .eq("uuid", params.uuid)
    .maybeSingle()

  if (error) return serverError()

  if (!data) return ok(null)

  const sb2 = getServiceClient()
  const [warnRes, ignoreRes] = await Promise.all([
    (sb2 as any)
      .from("player_warnings")
      .select("id, reason, created_at, expires_at")
      .eq("server_id", params.server_id)
      .eq("player_uuid", params.uuid)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
    (sb2 as any)
      .from("blocked_players")
      .select("uuid, blocked_at, expires_at")
      .eq("server_id", params.server_id)
      .eq("uuid", params.uuid)
      .maybeSingle(),
  ])

  const ignore = ignoreRes.data ?? null
  const ignoreActive = ignore
    ? (ignore.expires_at == null || new Date(ignore.expires_at).getTime() > Date.now())
    : false

  return ok({
    ...data,
    warnings: warnRes.data ?? [],
    ignore: ignoreActive ? ignore : null,
  })
}

export async function PUT(
  request: Request,
  { params }: { params: { server_id: string; uuid: string } }
) {
  if (!validatePathUuid(params.server_id) || !validatePathUuid(params.uuid)) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()

  if (session.server_id !== params.server_id) return unauthorized()
  if (session.role !== "owner" && session.role !== "admin") return forbidden("Nur Owner/Admin können Status ändern")

  let body: unknown
  try { body = await request.json() } catch { return badRequest() }

  const parsed = PlayerStatusFieldSchema.safeParse(body)
  if (!parsed.success) return badRequest()

  const sb = getServiceClient()

  const { data: existing, error: findError } = await (sb as any)
    .from("players")
    .select("id")
    .eq("server_id", params.server_id)
    .eq("uuid", params.uuid)
    .maybeSingle()

  if (findError) return serverError()

  const updateData: Record<string, unknown> = {}
  if (parsed.data.status !== undefined) {
    updateData.status = parsed.data.status
    updateData.status_expires_at = null
  }
  if (parsed.data.color !== undefined) updateData.color = parsed.data.color
  // updated_at pflegen, sonst verpasst der Mod-Pull (updated_at >= since) PUT-Edits.
  updateData.updated_at = new Date().toISOString()

  if (existing) {
    const { error } = await (sb as any)
      .from("players")
      .update(updateData)
      .eq("id", existing.id)
    if (error) return serverError()
  } else {
    const { error } = await (sb as any)
      .from("players")
      .insert({ server_id: params.server_id, uuid: params.uuid, ...updateData })
    if (error) return serverError()
  }

  return ok({ success: true })
}

export async function DELETE(
  request: Request,
  { params }: { params: { server_id: string; uuid: string } }
) {
  if (!validatePathUuid(params.server_id) || !validatePathUuid(params.uuid)) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()

  if (session.server_id !== params.server_id) return unauthorized()
  if (session.role !== "owner" && session.role !== "admin") return forbidden("Nur Owner/Admin können Daten löschen")

  const sb = getServiceClient()

  const { data: server } = await (sb as any)
    .from("servers")
    .select("server_secret")
    .eq("id", params.server_id)
    .maybeSingle()

  if (!server?.server_secret) return serverError()

  const serverSecret = server.server_secret as string
  const anonymizedUuid = hmacUuid(params.uuid, serverSecret)

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
      uuid: anonymizedUuid,
    })
    .eq("server_id", params.server_id)
    .eq("uuid", params.uuid)

  if (playerError) return serverError()

  await Promise.all([
    (sb as any).from("blocked_players").delete().eq("server_id", params.server_id).eq("uuid", params.uuid),
    (sb as any).from("muted_players").delete().eq("server_id", params.server_id).eq("uuid", params.uuid),
    (sb as any).from("player_warnings").delete().eq("server_id", params.server_id).eq("player_uuid", params.uuid),
  ])

  return ok({ success: true, message: "Data anonymized. Full deletion in 24h." })
}
