import { badRequest, forbidden, notFound, ok, serverError, unauthorized } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"
import { BugReportUpdateSchema } from "@/lib/validators"

export const dynamic = "force-dynamic"

function parseId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

// Bearbeiten/Löschen einer Meldung — nur der Owner (Admin-Dashboard).
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const id = parseId(params.id)
  if (id === null) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.role !== "owner") return forbidden("Nur der Owner kann Meldungen bearbeiten")

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
    .select("id")

  if (error) return serverError()
  if (!data || data.length === 0) return notFound()
  return ok({ resolved: parsed.data.resolved })
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const id = parseId(params.id)
  if (id === null) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.role !== "owner") return forbidden("Nur der Owner kann Meldungen löschen")

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("bug_reports")
    .delete()
    .eq("id", id)
    .select("id")

  if (error) return serverError()
  if (!data || data.length === 0) return notFound()
  return ok({ deleted: true })
}
