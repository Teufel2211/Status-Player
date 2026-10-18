import { ok, serverError, unauthorized, badRequest, forbidden } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"
import { validatePathUuid, PlayerStatusFieldSchema } from "@/lib/validators"
import { writeAuditLog } from "@/lib/audit"


export const dynamic = "force-dynamic"

export async function PATCH(
  request: Request,
  { params }: { params: { server_id: string; uuid: string } }
) {
  if (!validatePathUuid(params.server_id) || !validatePathUuid(params.uuid)) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()

  if (session.role !== "owner" && session.role !== "admin") return forbidden("Nur Owner/Admin können Status ändern")
  // Der Owner darf serverübergreifend ändern (Admin-Dashboard); alle anderen nur ihren eigenen Server.
  if (session.server_id !== params.server_id && session.role !== "owner") return unauthorized()

  let body: unknown
  try { body = await request.json() } catch { return badRequest() }

  const parsed = PlayerStatusFieldSchema.safeParse(body)
  if (!parsed.success) return badRequest()

  const sb = getServiceClient()
  const updateData: Record<string, unknown> = {}
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status
  if (parsed.data.color !== undefined) updateData.color = parsed.data.color

  const { data: existing, error: findError } = await (sb as any)
    .from("players")
    .select("id")
    .eq("server_id", params.server_id)
    .eq("uuid", params.uuid)
    .maybeSingle()

  if (findError) return serverError()

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
      .insert({ server_id: params.server_id, uuid: params.uuid, updated_at: new Date().toISOString(), ...updateData })
    if (error) return serverError()
  }

  await writeAuditLog({
    server_id: params.server_id,
    action: "status_update",
    who_uuid: session.sub,
    target_uuid: params.uuid,
    details: updateData,
  })

  return ok({ success: true })
}
