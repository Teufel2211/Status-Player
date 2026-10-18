import { badRequest, forbidden, notFound, ok, serverError, unauthorized } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"
import { validatePathUuid, BugReportUpdateSchema } from "@/lib/validators"

export const dynamic = "force-dynamic"

function parseId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function PATCH(
  request: Request,
  { params }: { params: { server_id: string; id: string } }
) {
  if (!validatePathUuid(params.server_id)) return badRequest()
  const id = parseId(params.id)
  if (id === null) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.server_id !== params.server_id) return unauthorized()
  if (session.role !== "owner" && session.role !== "admin") return forbidden("Nur Owner/Admin können Meldungen bearbeiten")

  let body: unknown
  try { body = await request.json() } catch { return badRequest() }

  const parsed = BugReportUpdateSchema.safeParse(body)
  if (!parsed.success) return badRequest()

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("bug_reports")
    .update({
      resolved: parsed.data.resolved,
      resolved_at: parsed.data.resolved ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .eq("server_id", params.server_id)
    .select("id")

  if (error) return serverError()
  if (!data || data.length === 0) return notFound()
  return ok({ resolved: parsed.data.resolved })
}

export async function DELETE(
  request: Request,
  { params }: { params: { server_id: string; id: string } }
) {
  if (!validatePathUuid(params.server_id)) return badRequest()
  const id = parseId(params.id)
  if (id === null) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.server_id !== params.server_id) return unauthorized()
  if (session.role !== "owner" && session.role !== "admin") return forbidden("Nur Owner/Admin können Meldungen löschen")

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("bug_reports")
    .delete()
    .eq("id", id)
    .eq("server_id", params.server_id)
    .select("id")

  if (error) return serverError()
  if (!data || data.length === 0) return notFound()
  return ok({ deleted: true })
}
