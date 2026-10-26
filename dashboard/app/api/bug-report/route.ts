import { NextResponse } from "next/server"
import { badGateway, badRequest, forbidden, tooMany, unauthorized } from "@/lib/response"
import { requireApiKey } from "@/lib/auth"
import { checkRateLimit, getRateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit"
import { BugReportSchema } from "@/lib/validators"
import { getServiceClient } from "@/lib/supabase"
import {
  UPLOAD_CODE_TTL_MS,
  generateUploadCode,
  getBaseUrl,
  hashUploadCode,
} from "@/lib/bug-upload"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"

/**
 * Ingame-Bugmeldungen (/bug im Mod): speichert die Meldung im Dashboard-Posteingang
 * (Tabelle bug_reports). Auth = Mod-API-Key (Scope "check"), an die server_id gebunden.
 * Die Spieler-UUID dient nur als Rate-Limit-Schlüssel und wird nicht gespeichert.
 */
export async function POST(request: Request) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return badRequest()
  }

  const parsed = BugReportSchema.safeParse(payload)
  if (!parsed.success) return badRequest()

  const report = parsed.data
  if (!(await requireApiKey(request, "check", report.server_id))) return unauthorized()

  const rate = checkRateLimit(`bugreport:${report.server_id}:${report.uuid}`, RATE_LIMITS.BUG_REPORT)
  if (!rate.allowed) return tooMany("Zu viele Bug-Meldungen. Bitte warte einige Minuten.")

  const sb = getServiceClient()

  // Kill-Switch: keine Bug-Meldungen von deaktivierten Servern annehmen.
  const [{ data: serverRow }, { data: fleetRow }] = await Promise.all([
    (sb as any).from("servers").select("mod_enabled").eq("id", report.server_id).maybeSingle(),
    (sb as any).from("fleet_config").select("mod_enabled").eq("id", 1).maybeSingle(),
  ])
  if (serverRow?.mod_enabled === false || fleetRow?.mod_enabled === false) {
    return forbidden("Status Player ist für diesen Server deaktiviert.")
  }

  // Upload-Code pro Meldung (30 Min gültig). In der DB liegt nur der Hash;
  // bei der seltenen Kollision des Unique-Index wird neu gewürfelt.
  let uploadCode = ""
  let uploadCodeExpiresAt = ""
  let insertError: { code?: string } | null = null

  for (let attempt = 0; attempt < 3; attempt += 1) {
    uploadCode = generateUploadCode()
    uploadCodeExpiresAt = new Date(Date.now() + UPLOAD_CODE_TTL_MS).toISOString()

    const { error } = await (sb as any)
      .from("bug_reports")
      .insert({
        server_id: report.server_id,
        player: report.player,
        text: report.text,
        mod_version: report.mod_version,
        mc_version: report.mc_version,
        loader: report.loader,
        upload_code_hash: hashUploadCode(uploadCode),
        upload_code_expires_at: uploadCodeExpiresAt,
      })

    insertError = error
    if (!error) break
    if (error.code !== "23505") break
  }

  if (insertError) {
    // Kein Meldetext ins Log (PII) - nur der Fehlercode.
    console.error(`[bug-report] insert failed: ${insertError.code ?? "unknown"}`)
    return badGateway("Bug-Meldung konnte nicht gespeichert werden.")
  }

  const baseUrl = getBaseUrl(request)
  const uploadQuery = `c=${encodeURIComponent(uploadCode)}`

  return NextResponse.json({
    ok: true,
    upload: {
      code: uploadCode,
      page_url: `${baseUrl}/upload?${uploadQuery}`,
      api_url: `${baseUrl}/api/bug-report/image?${uploadQuery}`,
      expires_at: uploadCodeExpiresAt,
    },
  }, { status: 201, headers: getRateLimitHeaders(rate) })
}
