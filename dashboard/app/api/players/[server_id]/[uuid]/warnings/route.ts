import { ok, created, serverError, unauthorized, forbidden, badRequest, conflict } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"
import { validatePathUuid } from "@/lib/validators"
import { writeAuditLog } from "@/lib/audit"
import { z } from "zod"

export const dynamic = "force-dynamic"

const MAX_ACTIVE_WARNINGS = 3
const DEFAULT_DAYS = 14

const WarnCreateSchema = z.object({
  reason: z.string().trim().max(200).optional().default(""),
  days: z.number().int().min(1).max(365).optional(),
})

function requireModerator(request: Request, serverId: string, playerUuid: string) {
  if (!validatePathUuid(serverId) || !validatePathUuid(playerUuid)) {
    return { error: badRequest() }
  }
  const session = requireSession(request)
  if (!session) return { error: unauthorized() }
  if (session.server_id !== serverId) return { error: unauthorized() }
  if (session.role !== "owner" && session.role !== "admin") {
    return { error: forbidden("Nur Owner/Admin können Warnungen verwalten") }
  }
  return { session }
}

export async function GET(
  request: Request,
  { params }: { params: { server_id: string; uuid: string } }
) {
  const auth = requireModerator(request, params.server_id, params.uuid)
  if ("error" in auth) return auth.error

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("player_warnings")
    .select("id, reason, created_at, expires_at, revoked_at")
    .eq("server_id", params.server_id)
    .eq("player_uuid", params.uuid)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) return serverError()

  const nowMs = Date.now()
  const warnings = (data ?? []).map((w: any) => ({
    ...w,
    active: w.revoked_at == null && new Date(w.expires_at).getTime() > nowMs,
  }))
  return ok({
    warnings,
    active_count: warnings.filter((w: any) => w.active).length,
  })
}

export async function POST(
  request: Request,
  { params }: { params: { server_id: string; uuid: string } }
) {
  const auth = requireModerator(request, params.server_id, params.uuid)
  if ("error" in auth) return auth.error
  const session = auth.session

  let body: unknown
  try { body = await request.json() } catch { return badRequest() }

  const parsed = WarnCreateSchema.safeParse(body)
  if (!parsed.success) return badRequest()

  const sb = getServiceClient()
  const nowIso = new Date().toISOString()

  const { count, error: countError } = await (sb as any)
    .from("player_warnings")
    .select("id", { count: "exact", head: true })
    .eq("server_id", params.server_id)
    .eq("player_uuid", params.uuid)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)

  if (countError) return serverError()
  if ((count ?? 0) >= MAX_ACTIVE_WARNINGS) {
    return conflict("Maximal 3 aktive Warnungen pro Spieler")
  }

  let days = parsed.data.days
  if (days == null) {
    const { data: server } = await (sb as any)
      .from("servers")
      .select("config")
      .eq("id", params.server_id)
      .maybeSingle()
    const config = (server?.config ?? {}) as Record<string, unknown>
    const configured = config.warn_default_days
    days = typeof configured === "number" && Number.isFinite(configured)
      ? Math.min(365, Math.max(1, Math.trunc(configured)))
      : DEFAULT_DAYS
  }

  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await (sb as any)
    .from("player_warnings")
    .insert({
      server_id: params.server_id,
      player_uuid: params.uuid,
      reason: parsed.data.reason ?? "",
      created_by: session.sub,
      expires_at: expiresAt,
    })
    .select("id, reason, created_at, expires_at, revoked_at")
    .single()

  if (error) return serverError()

  await writeAuditLog({
    server_id: params.server_id,
    action: "warn_add",
    who_uuid: session.sub,
    target_uuid: params.uuid,
    details: { warning_id: data.id, days, reason: parsed.data.reason ?? "" },
  })

  return created({ warning: { ...data, active: true }, active_count: (count ?? 0) + 1 })
}

export async function DELETE(
  request: Request,
  { params }: { params: { server_id: string; uuid: string } }
) {
  const auth = requireModerator(request, params.server_id, params.uuid)
  if ("error" in auth) return auth.error
  const session = auth.session

  const { searchParams } = new URL(request.url)
  const idRaw = searchParams.get("id")
  let warningId: number | null = null
  if (idRaw != null) {
    warningId = Number(idRaw)
    if (!Number.isInteger(warningId) || warningId <= 0) return badRequest()
  }

  const sb = getServiceClient()
  const nowIso = new Date().toISOString()

  let query = (sb as any)
    .from("player_warnings")
    .update({ revoked_at: nowIso, revoked_by: session.sub })
    .eq("server_id", params.server_id)
    .eq("player_uuid", params.uuid)
    .is("revoked_at", null)
  if (warningId != null) query = query.eq("id", warningId)

  const { error } = await query
  if (error) return serverError()

  await writeAuditLog({
    server_id: params.server_id,
    action: warningId != null ? "warn_revoke" : "warn_clear",
    who_uuid: session.sub,
    target_uuid: params.uuid,
    details: warningId != null ? { warning_id: warningId } : {},
  })

  return ok({ success: true })
}
