import { badRequest, ok, serverError, unauthorized } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"
import { validatePathUuid } from "@/lib/validators"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: { server_id: string } }
) {
  if (!validatePathUuid(params.server_id)) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.server_id !== params.server_id) return unauthorized()

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("bug_reports")
    .select("id, player, text, mod_version, mc_version, loader, resolved, created_at, resolved_at")
    .eq("server_id", params.server_id)
    .order("created_at", { ascending: false })
    .limit(500)

  if (error) return serverError()
  return ok({ reports: data ?? [] })
}
