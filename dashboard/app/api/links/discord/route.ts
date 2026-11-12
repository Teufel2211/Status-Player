import { badRequest, ok, serverError, unauthorized } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"
import { z } from "zod"


export const dynamic = "force-dynamic"

// Discord-Snowflake: 17-20 Ziffern. Ohne Formatgrenze liessen sich beliebig
// viele (und beliebig lange) Zeilen pro Nutzer anlegen.
const LinkSchema = z.object({
  discord_id: z.string().regex(/^\d{17,20}$/),
})

export async function POST(request: Request) {
  const session = requireSession(request)
  if (!session) return unauthorized()

  let body: unknown
  try { body = await request.json() } catch { return badRequest() }

  const parsed = LinkSchema.safeParse(body)
  if (!parsed.success) return badRequest()
  const discordId = parsed.data.discord_id

  const sb = getServiceClient()

  const { data: existing } = await (sb as any)
    .from("discord_links")
    .select("id, uuid")
    .eq("discord_id", discordId)
    .eq("server_id", session.server_id)
    .maybeSingle()

  if (existing && existing.uuid !== session.sub) return badRequest()

  // Ein Link pro Dashboard-Konto und Server: eine neue ID ersetzt den alten
  // Link, statt eine zweite Zeile anzulegen (kein Unique-Constraint auf
  // (uuid, server_id) in der DB, daher explizit update/insert).
  const { data: own } = await (sb as any)
    .from("discord_links")
    .select("id")
    .eq("uuid", session.sub)
    .eq("server_id", session.server_id)
    .maybeSingle()

  if (own) {
    const { error } = await (sb as any)
      .from("discord_links")
      .update({ discord_id: discordId, role: session.role, linked_at: new Date().toISOString() })
      .eq("id", own.id)
    if (error) return serverError()
    return ok({ success: true })
  }

  const { error } = await (sb as any)
    .from("discord_links")
    .insert({
      discord_id: discordId,
      uuid: session.sub,
      server_id: session.server_id,
      role: session.role,
      linked_at: new Date().toISOString(),
    })

  if (error) return serverError()
  return ok({ success: true })
}
