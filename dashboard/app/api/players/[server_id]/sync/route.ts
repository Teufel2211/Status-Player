import { ok, serverError, unauthorized, badRequest } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireApiKey } from "@/lib/auth"
import { validatePathUuid } from "@/lib/validators"
import { z } from "zod"

const PlayerSyncSchema = z.object({
  uuid: z.string().min(1).max(64),
  username: z.string().max(32).optional().nullable(),
  status: z.string().max(64).optional().nullable(),
  color: z.string().max(32).optional().nullable(),
  settings: z.record(z.unknown()).optional().nullable(),
  avatar: z.string().max(160).optional().nullable(),
  online: z.boolean().optional(),
  status_expires_at: z.number().int().nonnegative().max(8640000000000000).optional(),
})

const MutedSyncSchema = z.object({
  uuid: z.string().min(1).max(64),
  // Max = gueltiger Date-Bereich, sonst wirft toISOString RangeError (500).
  muted_until: z.number().int().nonnegative().max(8640000000000000),
})

const BlockedSyncSchema = z.object({
  uuid: z.string().min(1).max(64),
  active: z.boolean().optional().default(true),
  // 0 = permanent, >0 = automatische Rueckkehr zu diesem Zeitpunkt (ms).
  expires_at: z.number().int().nonnegative().max(8640000000000000).optional(),
})

const SyncBodySchema = z.object({
  players: z.array(PlayerSyncSchema).min(0).max(200),
  muted: z.array(MutedSyncSchema).min(0).max(200).optional().default([]),
  blocked: z.array(BlockedSyncSchema).min(0).max(200).optional().default([]),
})


export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  { params }: { params: { server_id: string } }
) {
  if (!validatePathUuid(params.server_id)) return badRequest()

  const authed = await requireApiKey(request, "check", params.server_id)
  if (!authed) return unauthorized()

  const sb = getServiceClient()

  // Kill-Switch: Schreibvorgaenge still verwerfen, solange der Server (oder
  // die ganze Flotte) im Admin-Dashboard deaktiviert ist. 200 statt Fehler,
  // damit ein Mod, der das Flag noch nicht geholt hat, nicht Logs spammt.
  const { data: serverRow, error: flagError } = await (sb as any)
    .from("servers")
    .select("mod_enabled")
    .eq("id", params.server_id)
    .maybeSingle()
  if (flagError) return serverError()
  if (!serverRow) return badRequest()

  const { data: fleetRow } = await (sb as any)
    .from("fleet_config")
    .select("mod_enabled")
    .eq("id", 1)
    .maybeSingle()
  if (serverRow.mod_enabled === false || fleetRow?.mod_enabled === false) {
    const mod_disabled_scope = fleetRow?.mod_enabled === false ? "global" : "server"
    return ok({ synced: 0, mod_enabled: false, mod_disabled_scope })
  }

  let body: unknown
  try { body = await request.json() } catch { return badRequest() }

  const parsed = SyncBodySchema.safeParse(body)
  if (!parsed.success) return badRequest()

  const nowIso = new Date().toISOString()
  const rows = parsed.data.players.map((p) => {
    const row: Record<string, unknown> = {
      server_id: params.server_id,
      uuid: p.uuid,
      // updated_at bewusst NICHT gesetzt: Dashboard-Edits (PATCH/PUT)
      // stempeln selbst, und der Pull sieht so nur echte Änderungen
      // statt jeden Push-Zyklus alle Zeilen (DB-Default now() bei Insert).
      is_online: p.online ?? false,
    }
    if (p.online) row.last_seen = nowIso
    if (p.username != null && p.username !== "") row.username = p.username
    if (p.status != null) row.status = p.status
    if (p.color != null) row.color = p.color
    if (p.settings != null) row.settings = p.settings
    if (p.avatar !== undefined && p.avatar !== null) row.avatar = p.avatar === "" ? null : p.avatar
    if (p.status_expires_at !== undefined) {
      row.status_expires_at =
        p.status_expires_at > 0 ? new Date(p.status_expires_at).toISOString() : null
    }
    return row
  })

  if (rows.length > 0) {
    const { error } = await (sb as any)
      .from("players")
      .upsert(rows, { onConflict: "server_id,uuid" })
    if (error) return serverError()
  }

  const mutedRows = parsed.data.muted
    .filter((m) => m.muted_until > 0)
    .map((m) => ({
      uuid: m.uuid,
      server_id: params.server_id,
      muted_until: new Date(m.muted_until).toISOString(),
    }))
  const mutedDelete = parsed.data.muted.filter((m) => m.muted_until === 0)

  if (mutedRows.length > 0) {
    const { error } = await (sb as any)
      .from("muted_players")
      .upsert(mutedRows, { onConflict: "uuid,server_id" })
    if (error) return serverError()
  }
  if (mutedDelete.length > 0) {
    const uuids = mutedDelete.map((m) => m.uuid)
    const { error } = await (sb as any)
      .from("muted_players")
      .delete()
      .eq("server_id", params.server_id)
      .in("uuid", uuids)
    if (error) return serverError()
  }

  const blockedRows = parsed.data.blocked
    .filter((b) => b.active !== false)
    .map((b) => ({
      uuid: b.uuid,
      server_id: params.server_id,
      expires_at:
        b.expires_at && b.expires_at > 0 ? new Date(b.expires_at).toISOString() : null,
    }))
  const blockedDelete = parsed.data.blocked.filter((b) => b.active === false)

  if (blockedRows.length > 0) {
    const { error } = await (sb as any)
      .from("blocked_players")
      .upsert(blockedRows, { onConflict: "uuid,server_id" })
    if (error) return serverError()
  }
  if (blockedDelete.length > 0) {
    const uuids = blockedDelete.map((b) => b.uuid)
    const { error } = await (sb as any)
      .from("blocked_players")
      .delete()
      .eq("server_id", params.server_id)
      .in("uuid", uuids)
    if (error) return serverError()
  }

  return ok({ synced: rows.length + mutedRows.length + blockedRows.length })
}

export async function GET(
  request: Request,
  { params }: { params: { server_id: string } }
) {
  if (!validatePathUuid(params.server_id)) return badRequest()

  const authed = await requireApiKey(request, "check", params.server_id)
  if (!authed) return unauthorized()

  const { searchParams } = new URL(request.url)
  const sinceRaw = searchParams.get("since")
  const since = sinceRaw && !isNaN(Date.parse(sinceRaw)) ? sinceRaw : null

  const sb = getServiceClient()

  const { data: serverRow, error: flagError } = await (sb as any)
    .from("servers")
    .select("mod_enabled")
    .eq("id", params.server_id)
    .maybeSingle()
  if (flagError) return serverError()
  if (!serverRow) return badRequest()

  const { data: fleetRow } = await (sb as any)
    .from("fleet_config")
    .select("mod_enabled")
    .eq("id", 1)
    .maybeSingle()
  if (serverRow.mod_enabled === false || fleetRow?.mod_enabled === false) {
    // Nur das Flag liefern: der Mod ueberspringt die Datenverarbeitung und
    // laesst den Watermark stehen, damit Re-Enable den Rueckstand nachzieht.
    const mod_disabled_scope = fleetRow?.mod_enabled === false ? "global" : "server"
    return ok({ mod_enabled: false, mod_disabled_scope, server_time: new Date().toISOString() })
  }

  let playerQuery = (sb as any)
    .from("players")
    .select("uuid, username, status, color, settings, updated_at, status_expires_at, slowmode_seconds, is_online")
    .eq("server_id", params.server_id)
  if (since) playerQuery = playerQuery.gte("updated_at", since)
  const { data: players, error: playerError } = await playerQuery
  if (playerError) return serverError()

  let muteQuery = (sb as any)
    .from("muted_players")
    .select("uuid, muted_until")
    .eq("server_id", params.server_id)
  const { data: muted, error: muteError } = await muteQuery
  if (muteError) return serverError()

  let blockQuery = (sb as any)
    .from("blocked_players")
    .select("uuid, expires_at")
    .eq("server_id", params.server_id)
  const { data: blocked, error: blockError } = await blockQuery
  if (blockError) return serverError()

  // Aktive Warnungen (abgelaufen/zurueckgenommen zaehlen nicht).
  const nowIso = new Date().toISOString()
  const { data: warnings, error: warnError } = await (sb as any)
    .from("player_warnings")
    .select("player_uuid, created_at, expires_at")
    .eq("server_id", params.server_id)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)

  if (warnError) return serverError()

  const warnByPlayer = new Map<string, { count: number; updated_at: string }>()
  for (const w of warnings ?? []) {
    const uuid = w.player_uuid as string
    if (!uuid) continue
    const prev = warnByPlayer.get(uuid)
    const created = (w.created_at as string) ?? nowIso
    if (!prev) {
      warnByPlayer.set(uuid, { count: 1, updated_at: created })
    } else {
      prev.count += 1
      if (created > prev.updated_at) prev.updated_at = created
    }
  }
  const warningRows = Array.from(warnByPlayer.entries()).map(([uuid, v]) => ({
    uuid,
    count: v.count,
    level: Math.min(3, v.count),
    updated_at: v.updated_at,
  }))

  const { data: presets, error: presetError } = await (sb as any)
    .from("custom_presets")
    .select("name, status, color, updated_at")
    .eq("server_id", params.server_id)
    .order("name", { ascending: true })

  if (presetError) return serverError()

  let adminQuery = (sb as any)
    .from("audit_log")
    .select("id, action, who_uuid_hash, target_uuid_hash, detail, created_at")
    .eq("server_id", params.server_id)
    .limit(200)
  if (since) adminQuery = adminQuery.gte("created_at", since)
  const { data: adminActions, error: adminError } = await adminQuery
  if (adminError) return serverError()

  return ok({
    mod_enabled: true,
    players: players ?? [],
    muted: muted ?? [],
    blocked: blocked ?? [],
    warnings: warningRows,
    presets: presets ?? [],
    admin_actions: adminActions ?? [],
    server_time: new Date().toISOString(),
  })
}
