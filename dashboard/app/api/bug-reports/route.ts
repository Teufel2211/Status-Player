import { ok, serverError, unauthorized, forbidden } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"

// Posteingang: nur der Owner sieht die Meldungen — über alle Server hinweg.
export async function GET(request: Request) {
  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.role !== "owner") return forbidden("Nur der Owner sieht den Posteingang")

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("bug_reports")
    .select("id, server_id, player, text, mod_version, mc_version, loader, resolved, created_at, resolved_at, bug_report_images(count)")
    .order("created_at", { ascending: false })
    .limit(500)

  if (error) return serverError()

  const reports = (data ?? []).map((row: any) => {
    const { bug_report_images, ...rest } = row
    const imageCount = Array.isArray(bug_report_images) ? Number(bug_report_images[0]?.count ?? 0) : 0
    return { ...rest, image_count: imageCount }
  })

  return ok({ reports })
}
