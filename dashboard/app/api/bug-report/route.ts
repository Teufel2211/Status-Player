import { NextResponse } from "next/server"
import { badGateway, badRequest, tooMany, unauthorized } from "@/lib/response"
import { requireApiKey } from "@/lib/auth"
import { checkRateLimit, getRateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit"
import { BugReportSchema } from "@/lib/validators"
import { getServiceClient } from "@/lib/supabase"

export const dynamic = "force-dynamic"

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
  const { error } = await (sb as any)
    .from("bug_reports")
    .insert({
      server_id: report.server_id,
      player: report.player,
      text: report.text,
      mod_version: report.mod_version,
      mc_version: report.mc_version,
      loader: report.loader,
    })

  if (error) {
    // Kein Meldetext ins Log (PII) - nur der Fehlercode.
    console.error(`[bug-report] insert failed: ${error.code ?? "unknown"}`)
    return badGateway("Bug-Meldung konnte nicht gespeichert werden.")
  }

  return NextResponse.json({ ok: true }, { status: 201, headers: getRateLimitHeaders(rate) })
}
