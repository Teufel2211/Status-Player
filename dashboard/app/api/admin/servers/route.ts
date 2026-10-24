import { ok, serverError, unauthorized, forbidden, badRequest } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"
import { ModKillSwitchSchema } from "@/lib/validators"
import { writeAuditLog } from "@/lib/audit"

export const dynamic = "force-dynamic"

// Globaler Kill-Switch: StatusMod auf allen Servern der Flotte deaktivieren.
// Der effektive Zustand ist global && server (siehe /api/servers/[id]/sync).
export async function PATCH(request: Request) {
  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.role !== "owner") return forbidden("Nur der Owner kann StatusMod deaktivieren")

  let body: unknown
  try { body = await request.json() } catch { return badRequest() }

  const parsed = ModKillSwitchSchema.safeParse(body)
  if (!parsed.success) return badRequest()

  const sb = getServiceClient()
  const { error } = await (sb as any)
    .from("fleet_config")
    .update({ mod_enabled: parsed.data.mod_enabled })
    .eq("id", 1)

  if (error) return serverError()

  if (session.server_id) {
    await writeAuditLog({
      server_id: session.server_id,
      action: parsed.data.mod_enabled ? "mod_global_enable" : "mod_global_disable",
      who_uuid: session.sub,
      details: { mod_enabled: parsed.data.mod_enabled },
    })
  }

  return ok({ global_mod_enabled: parsed.data.mod_enabled })
}
