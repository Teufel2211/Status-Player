import { ok, serverError, unauthorized, forbidden, badRequest } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"
import { validatePathUuid } from "@/lib/validators"
import { writeAuditLog } from "@/lib/audit"
import { z } from "zod"

export const dynamic = "force-dynamic"

const IgnoreSchema = z
  .object({
    duration_minutes: z.number().int().min(1).max(525600).optional(),
    permanent: z.boolean().optional().default(false),
  })
  .refine((v) => v.permanent === true || v.duration_minutes != null, {
    message: "Dauer fehlt",
  })

export async function POST(
  request: Request,
  { params }: { params: { server_id: string; uuid: string } }
) {
  if (!validatePathUuid(params.server_id) || !validatePathUuid(params.uuid)) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.server_id !== params.server_id) return unauthorized()
  if (session.role !== "owner" && session.role !== "admin") {
    return forbidden("Nur Owner/Admin können Spieler ignorieren")
  }

  let body: unknown
  try { body = await request.json() } catch { return badRequest() }

  const parsed = IgnoreSchema.safeParse(body)
  if (!parsed.success) return badRequest()

  const permanent = parsed.data.permanent === true
  const expiresAt = permanent
    ? null
    : new Date(Date.now() + (parsed.data.duration_minutes ?? 60) * 60 * 1000).toISOString()

  const sb = getServiceClient()
  const { error } = await (sb as any)
    .from("blocked_players")
    .upsert(
      {
        uuid: params.uuid,
        server_id: params.server_id,
        expires_at: expiresAt,
      },
      { onConflict: "uuid,server_id" }
    )

  if (error) return serverError()

  await writeAuditLog({
    server_id: params.server_id,
    action: "ignore_add",
    who_uuid: session.sub,
    target_uuid: params.uuid,
    details: permanent
      ? { permanent: true }
      : { duration_minutes: parsed.data.duration_minutes, expires_at: expiresAt },
  })

  return ok({ expires_at: expiresAt, permanent })
}

export async function DELETE(
  request: Request,
  { params }: { params: { server_id: string; uuid: string } }
) {
  if (!validatePathUuid(params.server_id) || !validatePathUuid(params.uuid)) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.server_id !== params.server_id) return unauthorized()
  if (session.role !== "owner" && session.role !== "admin") {
    return forbidden("Nur Owner/Admin können Ignore aufheben")
  }

  const sb = getServiceClient()
  const { error } = await (sb as any)
    .from("blocked_players")
    .delete()
    .eq("server_id", params.server_id)
    .eq("uuid", params.uuid)

  if (error) return serverError()

  await writeAuditLog({
    server_id: params.server_id,
    action: "ignore_remove",
    who_uuid: session.sub,
    target_uuid: params.uuid,
  })

  return ok({ success: true })
}
