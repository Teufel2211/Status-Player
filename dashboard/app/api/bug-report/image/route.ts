import crypto from "crypto"
import { NextResponse } from "next/server"
import { badGateway, badRequest, conflict, gone, notFound, ok, payloadTooLarge, serverError, tooMany, unsupportedMediaType } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { hashIp } from "@/lib/hash"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import {
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_REPORT,
  detectImageMime,
  hashUploadCode,
  isValidUploadCode,
} from "@/lib/bug-upload"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"

const BUCKET = "bug-images"

function parseCode(request: Request): string | null {
  const code = new URL(request.url).searchParams.get("c")?.trim() ?? ""
  return isValidUploadCode(code) ? code : null
}

type Lookup =
  | { state: "invalid" }
  | { state: "expired" }
  | { state: "ok"; reportId: number; expiresAt: string }

async function lookupReport(sb: any, code: string): Promise<Lookup> {
  const { data, error } = await sb
    .from("bug_reports")
    .select("id, upload_code_expires_at")
    .eq("upload_code_hash", hashUploadCode(code))
    .maybeSingle()

  if (error || !data) return { state: "invalid" }
  const expiresAt = data.upload_code_expires_at as string | null
  if (!expiresAt || new Date(expiresAt).getTime() < Date.now()) return { state: "expired" }
  return { state: "ok", reportId: Number(data.id), expiresAt }
}

// Status des Upload-Codes (Seite /upload + Mod-Client).
export async function GET(request: Request) {
  const code = parseCode(request)
  if (!code) return badRequest("Upload-Code fehlt oder ist ungültig.")

  const ip = request.headers.get("x-forwarded-for") ?? "unknown"
  const rate = checkRateLimit(`bugimg-status:${hashIp(ip)}`, RATE_LIMITS.BUG_IMAGE_STATUS)
  if (!rate.allowed) return tooMany("Zu viele Anfragen — bitte kurz warten.")

  const sb = getServiceClient()
  const hit = await lookupReport(sb, code)
  if (hit.state === "expired") return gone("Der Upload-Code ist abgelaufen. Bitte erstelle eine neue /bug-Meldung.")
  if (hit.state === "invalid") return notFound("Upload-Code ungültig.")

  const { count, error } = await (sb as any)
    .from("bug_report_images")
    .select("id", { count: "exact", head: true })
    .eq("report_id", hit.reportId)

  if (error) return serverError()
  const imageCount = count ?? 0
  return ok({
    valid: true,
    image_count: imageCount,
    remaining: Math.max(MAX_IMAGES_PER_REPORT - imageCount, 0),
    expires_at: hit.expiresAt,
  })
}

// Bild-Upload: Roh-Body (image/png, image/jpeg oder image/webp), max. 3 MB.
export async function POST(request: Request) {
  const code = parseCode(request)
  if (!code) return badRequest("Upload-Code fehlt oder ist ungültig.")

  const ip = request.headers.get("x-forwarded-for") ?? "unknown"
  const ipRate = checkRateLimit(`bugimg-ip:${hashIp(ip)}`, RATE_LIMITS.BUG_IMAGE_UPLOAD_IP)
  if (!ipRate.allowed) return tooMany("Zu viele Uploads — bitte in einigen Minuten erneut.")
  const codeRate = checkRateLimit(`bugimg-code:${hashUploadCode(code)}`, RATE_LIMITS.BUG_IMAGE_UPLOAD_CODE)
  if (!codeRate.allowed) return tooMany("Zu viele Uploads für diesen Code — bitte kurz warten.")

  // Früh ablehnen, bevor der Body gelesen wird (Vercel-Limit liegt bei 4,5 MB).
  const declaredLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    return payloadTooLarge(`Bild zu groß (max. ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB).`)
  }

  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
  if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(contentType)) {
    return unsupportedMediaType("Nur PNG, JPEG oder WebP erlaubt.")
  }

  const sb = getServiceClient()
  const hit = await lookupReport(sb, code)
  if (hit.state === "expired") return gone("Der Upload-Code ist abgelaufen. Bitte erstelle eine neue /bug-Meldung.")
  if (hit.state === "invalid") return notFound("Upload-Code ungültig.")

  let body: Buffer
  try {
    body = Buffer.from(await request.arrayBuffer())
  } catch {
    return badRequest("Bild konnte nicht gelesen werden.")
  }
  if (body.byteLength === 0) return badRequest("Die Datei ist leer.")
  if (body.byteLength > MAX_IMAGE_BYTES) {
    return payloadTooLarge(`Bild zu groß (max. ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB).`)
  }

  const mime = detectImageMime(body)
  if (!mime) return unsupportedMediaType("Datei ist kein gültiges PNG-, JPEG- oder WebP-Bild.")

  const { count, error: countError } = await (sb as any)
    .from("bug_report_images")
    .select("id", { count: "exact", head: true })
    .eq("report_id", hit.reportId)
  if (countError) return serverError()
  const existing = count ?? 0
  if (existing >= MAX_IMAGES_PER_REPORT) {
    return conflict(`Maximal ${MAX_IMAGES_PER_REPORT} Bilder pro Meldung.`)
  }

  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"
  const storagePath = `reports/${hit.reportId}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`

  const { error: uploadError } = await (sb as any).storage
    .from(BUCKET)
    .upload(storagePath, body, { contentType: mime, upsert: false })
  if (uploadError) {
    console.error(`[bug-image] storage upload failed: ${uploadError.message ?? "unknown"}`)
    return badGateway("Bild konnte nicht gespeichert werden.")
  }

  const { error: insertError } = await (sb as any)
    .from("bug_report_images")
    .insert({ report_id: hit.reportId, storage_path: storagePath, mime, size_bytes: body.byteLength })
  if (insertError) {
    await (sb as any).storage.from(BUCKET).remove([storagePath]).catch(() => {})
    console.error(`[bug-image] insert failed: ${insertError.code ?? "unknown"}`)
    return badGateway("Bild konnte nicht gespeichert werden.")
  }

  const total = existing + 1
  return NextResponse.json(
    { ok: true, count: total, remaining: Math.max(MAX_IMAGES_PER_REPORT - total, 0) },
    { status: 201 }
  )
}
