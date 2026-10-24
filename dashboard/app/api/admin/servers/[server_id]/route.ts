import { ok, serverError, unauthorized, forbidden, badRequest, notFound } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"
import { ModKillSwitchSchema, validatePathUuid } from "@/lib/validators"
import { writeAuditLog } from "@/lib/audit"

export const dynamic = "force-dynamic"

// Server-Kill-Switch: StatusMod nur fuer diesen Server deaktivieren.
export async function PATCH(
  request: Request,
  { params }: { params: { server_id: string } }
) {
  if (!validatePathUuid(params.server_id)) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.role !== "owner") return forbidden("Nur der Owner kann StatusMod deaktivieren")

  let body: unknown
  try { body = await request.json() } catch { return badRequest() }

  const parsed = ModKillSwitchSchema.safeParse(body)
  if (!parsed.success) return badRequest()

  const sb = getServiceClient()
  const { data: server, error } = await (sb as any)
    .from("servers")
    .select("id, owner_uuid")
    .eq("id", params.server_id)
    .maybeSingle()

  if (error) return serverError()
  if (!server || server.owner_uuid !== session.sub) return notFound("Server nicht gefunden")

  const { error: updateError } = await (sb as any)
    .from("servers")
    .update({ mod_enabled: parsed.data.mod_enabled })
    .eq("id", params.server_id)

  if (updateError) return serverError()

  await writeAuditLog({
    server_id: params.server_id,
    action: parsed.data.mod_enabled ? "mod_enable" : "mod_disable",
    who_uuid: session.sub,
    details: { mod_enabled: parsed.data.mod_enabled },
  })

  return ok({ server_id: params.server_id, mod_enabled: parsed.data.mod_enabled })
}
