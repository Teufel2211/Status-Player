import { NextResponse } from "next/server"
import { forbidden, ok, serverError, tooMany } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { ATTEST_HEADER, ATTEST_SIG_HEADER, verifyAttestStrings } from "@/lib/attest"
import { resolveApiKeyServer } from "@/lib/auth"
import { hashIp } from "@/lib/hash"
import { checkRateLimit, getRateLimitHeaders, RATE_LIMITS } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

// Start-Pruefung des Mods: ist diese Build-ID registriert?
//
// Antworten (siehe docs/superpowers/specs/2026-11-10-build-release-gate-design.md):
//   200 {status:"ok"}         Build steht in `builds`
//   200 {status:"override"}   Build wurde fuer diesen Server manuell freigegeben
//   403 {error:"build_unknown"}
//   403 {error:"attest_required"} / {error:"attest_invalid", reason}
//
// Die Route ist absichtlich ohne API-Key nutzbar: ein noch nicht gepaarter
// Server soll die Pruefung trotzdem durchlaufen koennen. Wird ein Server ueber
// `x-api-key` erkannt, schreibt die Route das Ergebnis auf seine Zeile - so
// erscheint die Meldung im Dashboard, ohne dass der Mod einen zweiten Aufruf
// braucht.

const NO_STORE = { "Cache-Control": "no-store" }

function forbiddenWithReason(error: string, reason?: string) {
  return NextResponse.json({ error, reason }, { status: 403, headers: NO_STORE })
}

async function rememberCheck(
  sb: any,
  serverId: string,
  status: "ok" | "unknown",
  buildId: string
): Promise<void> {
  // Best-effort: ein DB-Fehler darf die Antwort an den Mod nicht kippen.
  try {
    await (sb as any)
      .from("servers")
      .update({
        build_check_status: status,
        build_check_build_id: buildId,
        build_check_at: new Date().toISOString(),
      })
      .eq("id", serverId)
  } catch {
    // ignore
  }
}

export async function POST(request: Request) {
  const ipHash = hashIp(request.headers.get("x-forwarded-for") ?? "unknown")
  const rate = checkRateLimit(`builds-check:${ipHash}`, RATE_LIMITS.BUILD_CHECK)
  if (!rate.allowed) return tooMany("Zu viele Prüfungen")

  const sb = getServiceClient()
  const outcome = await verifyAttestStrings(
    sb,
    request.headers.get(ATTEST_HEADER),
    request.headers.get(ATTEST_SIG_HEADER)
  )

  if (outcome.status === "missing") return forbidden("attest_required")
  if (outcome.status === "invalid") return forbiddenWithReason("attest_invalid", outcome.reason)

  const buildId = outcome.fields.build_id
  const serverId = await resolveApiKeyServer(request, "check")

  const { data: registered, error: buildError } = await (sb as any)
    .from("builds")
    .select("build_id")
    .eq("build_id", buildId)
    .maybeSingle()

  if (buildError) {
    console.error(`[builds/check] lookup failed: ${buildError.code ?? "unknown"}`)
    // 5xx: der Mod startet (Fail-open), die Pruefung wird beim naechsten
    // Start wiederholt.
    return serverError()
  }

  if (registered) {
    if (serverId) await rememberCheck(sb, serverId, "ok", buildId)
    return ok({ status: "ok" }, 200)
  }

  if (serverId) {
    const { data: serverRow } = await (sb as any)
      .from("servers")
      .select("build_override_id")
      .eq("id", serverId)
      .maybeSingle()

    if (serverRow?.build_override_id && serverRow.build_override_id === buildId) {
      await rememberCheck(sb, serverId, "ok", buildId)
      return ok({ status: "override" }, 200)
    }

    await rememberCheck(sb, serverId, "unknown", buildId)
  }

  return NextResponse.json(
    { error: "build_unknown", build_id: buildId },
    { status: 403, headers: { ...NO_STORE, ...getRateLimitHeaders(rate) } }
  )
}
