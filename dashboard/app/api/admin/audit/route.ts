import { ok, serverError, unauthorized, forbidden } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"

export const dynamic = "force-dynamic"

// Fleet-Protokoll: die neuesten Einträge aller Server — nur für den Owner.
export async function GET(request: Request) {
  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.role !== "owner") return forbidden("Nur der Owner sieht das Protokoll")

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("audit_log")
    .select("id, server_id, action, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(200)

  if (error) return serverError()
  return ok({ entries: data ?? [] })
}
