import { ok, serverError, unauthorized, forbidden, badRequest } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"
import { validatePathUuid } from "@/lib/validators"
import { writeAuditLog } from "@/lib/audit"
import { z } from "zod"

export const dynamic = "force-dynamic"

const SlowmodeSchema = z.object({
  seconds: z.number().int().min(0).max(3600),
})

export async function PUT(
  request: Request,
  { params }: { params: { server_id: string; uuid: string } }
) {
  if (!validatePathUuid(params.server_id) || !validatePathUuid(params.uuid)) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.server_id !== params.server_id) return unauthorized()
  if (session.role !== "owner" && session.role !== "admin") {
    return forbidden("Nur Owner/Admin können den Slowmode ändern")
  }

  let body: unknown
  try { body = await request.json() } catch { return badRequest() }

  const parsed = SlowmodeSchema.safeParse(body)
  if (!parsed.success) return badRequest()

  const sb = getServiceClient()
  const nowIso = new Date().toISOString()

  const { data: updated, error } = await (sb as any)
    .from("players")
    .update({ slowmode_seconds: parsed.data.seconds, updated_at: nowIso })
    .eq("server_id", params.server_id)
    .eq("uuid", params.uuid)
    .select("id")

  if (error) return serverError()

  if (!updated || updated.length === 0) {
    const { error: insertError } = await (sb as any)
      .from("players")
      .insert({
        server_id: params.server_id,
        uuid: params.uuid,
        slowmode_seconds: parsed.data.seconds,
        updated_at: nowIso,
      })
    if (insertError) return serverError()
  }

  await writeAuditLog({
    server_id: params.server_id,
    action: "slowmode",
    who_uuid: session.sub,
    target_uuid: params.uuid,
    details: { seconds: parsed.data.seconds },
  })

  return ok({ seconds: parsed.data.seconds })
}
