import { ok, serverError, unauthorized, forbidden, badRequest, notFound } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"
import { validatePathUuid } from "@/lib/validators"
import { writeAuditLog } from "@/lib/audit"
import { generateSyncCode } from "@/lib/sync-code"
import { hashArgon2id } from "@/lib/hash"

export const dynamic = "force-dynamic"

type SyncCodeRow = {
  sync_code_hash: string | null
  sync_code_pending_hash: string | null
  sync_code_created_at: string | null
  sync_confirmed_at: string | null
  sync_reset_at: string | null
}

export async function GET(
  request: Request,
  { params }: { params: { server_id: string } }
) {
  if (!validatePathUuid(params.server_id)) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.server_id !== params.server_id) return unauthorized()

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("servers")
    .select("sync_code_hash, sync_code_pending_hash, sync_code_created_at, sync_confirmed_at, sync_reset_at")
    .eq("id", params.server_id)
    .maybeSingle()

  if (error) return serverError()
  if (!data) return notFound()

  const row = data as SyncCodeRow
  return ok({
    // configured = es gibt einen aktiven Code; confirmed = mindestens einer
    // wurde schon einmal bestaetigt.
    configured: !!row.sync_code_hash,
    pending: !!row.sync_code_pending_hash,
    confirmed: !!row.sync_code_hash && !!row.sync_confirmed_at,
    created_at: row.sync_code_created_at,
    confirmed_at: row.sync_confirmed_at,
    reset_at: row.sync_reset_at,
  })
}

export async function POST(
  request: Request,
  { params }: { params: { server_id: string } }
) {
  if (!validatePathUuid(params.server_id)) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.server_id !== params.server_id) return unauthorized()
  if (session.role !== "owner") return forbidden("Nur der Owner kann einen Sync-Code erzeugen")

  const code = generateSyncCode()
  const hash = await hashArgon2id(code)
  const nowIso = new Date().toISOString()

  const sb = getServiceClient()
  // Alter aktiver Code bleibt gueltig, bis der neue bestaetigt wird – sonst
  // waere jede Code-Erzeugung ein Ausfall fuer den laufenden Sync.
  const { error } = await (sb as any)
    .from("servers")
    .update({
      sync_code_pending_hash: hash,
      sync_code_pending_secret: null,
      sync_code_created_at: nowIso,
    })
    .eq("id", params.server_id)

  if (error) return serverError()

  await writeAuditLog({
    server_id: params.server_id,
    action: "sync_code_generated",
    who_uuid: session.sub,
    details: { pending: true },
  })

  // Klartext wird genau einmal zurueckgegeben und nie geloggt.
  return ok({ code, created_at: nowIso })
}

export async function DELETE(
  request: Request,
  { params }: { params: { server_id: string } }
) {
  if (!validatePathUuid(params.server_id)) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.server_id !== params.server_id) return unauthorized()
  if (session.role !== "owner") return forbidden("Nur der Owner kann den Sync-Code zurücksetzen")

  const sb = getServiceClient()
  const nowIso = new Date().toISOString()
  const { error } = await (sb as any)
    .from("servers")
    .update({
      sync_code_hash: null,
      sync_code_pending_hash: null,
      sync_code_pending_secret: null,
      sync_code_created_at: null,
      sync_confirmed_at: null,
      // Marker: dieser Server wurde bewusst zurueckgesetzt und bekommt keinen
      // automatischen Migrationscode mehr.
      sync_reset_at: nowIso,
    })
    .eq("id", params.server_id)

  if (error) return serverError()

  await writeAuditLog({
    server_id: params.server_id,
    action: "sync_code_reset",
    who_uuid: session.sub,
    details: {},
  })

  return ok({ reset: true })
}
