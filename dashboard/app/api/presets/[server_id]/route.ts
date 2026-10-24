import { ok, serverError, unauthorized, forbidden, badRequest } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { authorizeData, requireSession } from "@/lib/auth"
import { validatePathUuid } from "@/lib/validators"
import { writeAuditLog } from "@/lib/audit"
import { z } from "zod"


export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: { server_id: string } }
) {
  if (!validatePathUuid(params.server_id)) return badRequest()

  const authed = await authorizeData(request, "check", params.server_id)
  if (!authed) return unauthorized()

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("custom_presets")
    .select("*")
    .eq("server_id", params.server_id)
    .order("name", { ascending: true })

  if (error) return serverError()
  return ok(data ?? [])
}

const MC_COLOR =
  /^(reset|black|dark_blue|dark_green|dark_aqua|dark_red|dark_purple|gold|gray|dark_gray|blue|green|aqua|red|light_purple|yellow|white|rainbow|animated|#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))$/i

const PresetCreateSchema = z.object({
  name: z.string().trim().min(1).max(32).regex(/^\S+$/, "Name darf keine Leerzeichen enthalten"),
  status: z.string().trim().min(1).max(64),
  color: z.string().trim().min(1).max(32).regex(MC_COLOR, "Ungültige Farbe"),
})

export async function POST(
  request: Request,
  { params }: { params: { server_id: string } }
) {
  if (!validatePathUuid(params.server_id)) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.server_id !== params.server_id) return unauthorized()
  if (session.role !== "owner") return forbidden("Nur der Owner kann Presets ändern")

  let body: unknown
  try { body = await request.json() } catch { return badRequest() }

  const parsed = PresetCreateSchema.safeParse(body)
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Ungültige Anfrage")
  }

  const sb = getServiceClient()
  const { error } = await (sb as any).from("custom_presets").upsert(
    {
      name: parsed.data.name.toLowerCase(),
      server_id: params.server_id,
      status: parsed.data.status,
      color: parsed.data.color,
      creator_uuid: session.sub,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "name,server_id" }
  )

  if (error) return serverError()

  await writeAuditLog({
    server_id: params.server_id,
    action: "preset_upsert",
    who_uuid: session.sub,
    details: { name: parsed.data.name.toLowerCase() },
  })

  return ok({ success: true })
}
