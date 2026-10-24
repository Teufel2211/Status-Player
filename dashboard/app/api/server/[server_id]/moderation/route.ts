import { ok, serverError, unauthorized, forbidden, badRequest, notFound } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { authorizeData, requireSession } from "@/lib/auth"
import { validatePathUuid } from "@/lib/validators"
import { writeAuditLog } from "@/lib/audit"
import { z } from "zod"

export const dynamic = "force-dynamic"

const ModerationSettingsSchema = z.object({
  warn_default_days: z.number().int().min(1).max(365),
  warn_auto_mute_suggestion: z.boolean(),
})

const DEFAULT_DAYS = 14

function readSettings(config: unknown) {
  const c = (config ?? {}) as Record<string, unknown>
  const rawDays = c.warn_default_days
  const days = typeof rawDays === "number" && Number.isFinite(rawDays) ? Math.trunc(rawDays) : DEFAULT_DAYS
  return {
    warn_default_days: Math.min(365, Math.max(1, days)),
    warn_auto_mute_suggestion: c.warn_auto_mute_suggestion === true,
  }
}

export async function GET(
  request: Request,
  { params }: { params: { server_id: string } }
) {
  if (!validatePathUuid(params.server_id)) return badRequest()

  const authed = await authorizeData(request, "check", params.server_id)
  if (!authed) return unauthorized()

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("servers")
    .select("config")
    .eq("id", params.server_id)
    .maybeSingle()

  if (error) return serverError()
  if (!data) return notFound()
  return ok(readSettings(data.config))
}

export async function PUT(
  request: Request,
  { params }: { params: { server_id: string } }
) {
  if (!validatePathUuid(params.server_id)) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.server_id !== params.server_id) return unauthorized()
  if (session.role !== "owner") return forbidden("Nur der Owner kann Moderationseinstellungen ändern")

  let body: unknown
  try { body = await request.json() } catch { return badRequest() }

  const parsed = ModerationSettingsSchema.safeParse(body)
  if (!parsed.success) return badRequest()

  const sb = getServiceClient()
  const { data: server, error: findError } = await (sb as any)
    .from("servers")
    .select("config")
    .eq("id", params.server_id)
    .maybeSingle()

  if (findError) return serverError()
  if (!server) return notFound()

  const config = {
    ...((server.config ?? {}) as Record<string, unknown>),
    warn_default_days: parsed.data.warn_default_days,
    warn_auto_mute_suggestion: parsed.data.warn_auto_mute_suggestion,
  }

  const { error } = await (sb as any)
    .from("servers")
    .update({ config })
    .eq("id", params.server_id)

  if (error) return serverError()

  await writeAuditLog({
    server_id: params.server_id,
    action: "moderation_settings",
    who_uuid: session.sub,
    details: parsed.data,
  })

  return ok(readSettings(config))
}
