import { badRequest, forbidden, ok, serverError, unauthorized } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"

const BUCKET = "bug-images"
const SIGNED_URL_TTL_SECONDS = 300

function parseId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

// Bilder einer Meldung — nur der Owner (signierte URLs, 5 Minuten gültig).
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const id = parseId(params.id)
  if (id === null) return badRequest()

  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.role !== "owner") return forbidden("Nur der Owner sieht Bug-Bilder")

  const sb = getServiceClient()
  const { data: rows, error } = await (sb as any)
    .from("bug_report_images")
    .select("id, storage_path, mime, size_bytes, created_at")
    .eq("report_id", id)
    .order("created_at", { ascending: true })

  if (error) return serverError()
  if (!rows || rows.length === 0) return ok({ images: [] })

  const paths = rows.map((row: any) => row.storage_path).filter(Boolean)
  const { data: signed, error: signError } = await (sb as any).storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)

  if (signError) {
    console.error(`[bug-images] signed url failed: ${signError.message ?? "unknown"}`)
    return serverError()
  }

  const urlByPath = new Map<string, string | null>()
  for (const entry of signed ?? []) {
    urlByPath.set(entry.path, entry.error ? null : entry.signedUrl)
  }

  return ok({
    images: rows.map((row: any) => ({
      id: row.id,
      url: urlByPath.get(row.storage_path) ?? null,
      mime: row.mime,
      size_bytes: row.size_bytes,
      created_at: row.created_at,
    })),
  })
}
