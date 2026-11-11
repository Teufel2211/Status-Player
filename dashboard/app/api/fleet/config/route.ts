import { ok, serverError, unauthorized, forbidden, badRequest } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { resolveApiKeyServer } from "@/lib/auth"
import { requireFleetAdmin } from "@/lib/fleet-admin"
import { FleetConfigSchema } from "@/lib/validators"
import { writeAuditLog } from "@/lib/audit"
import { encryptSecret, decryptSecret } from "@/lib/hash"

// Fleet config: global dashboard_url + setup_secret pulled by the Fleet mod
// on every server (secret rotation without file access). Reading requires any
// valid server API key (same trust as the player sync); the dashboard UI and
// writes require the project-admin session (is_fleet_admin — NICHT role
// "owner", das hat jeder Server-Owner und darf das Setup-Secret nicht sehen).
//
// setup_secret liegt verschlüsselt ("enc:"-Präfix); GET entschlüsselt für
// Mods, Alt-Zeilen ohne Präfix bleiben lesbar (Rollback-Kompatibilität).

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  // Mods authenticate with a server API key; the dashboard UI uses the
  // project-admin session.
  const keyServerId = await resolveApiKeyServer(request, "check")
  if (!keyServerId) {
    const gate = await requireFleetAdmin(request)
    if (!gate.ok) return gate.status === 401 ? unauthorized() : forbidden("Nur der Projekt-Admin sieht die Verteilung")
  }

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("fleet_config")
    .select("dashboard_url, setup_secret, updated_at")
    .eq("id", 1)
    .maybeSingle()

  if (error) return serverError()
  const stored = data?.setup_secret ?? ""
  // "enc:" = verschlüsselt ablegen (s. PUT); Alt-Zeilen ohne Präfix roh lesen.
  let setupSecret = stored
  if (stored.startsWith("enc:")) {
    const dec = decryptSecret(stored.slice(4))
    if (dec === null) {
      console.error("[fleet-config] setup_secret nicht entschlüsselbar (SERVICE_ROLE_KEY rotiert? Config neu speichern!)")
      setupSecret = ""
    } else {
      setupSecret = dec
    }
  }
  return ok({
    dashboard_url: data?.dashboard_url ?? "",
    setup_secret: setupSecret,
    updated_at: data?.updated_at ?? null,
  })
}

export async function PUT(request: Request) {
  const gate = await requireFleetAdmin(request)
  if (!gate.ok) return gate.status === 401 ? unauthorized() : forbidden("Nur der Projekt-Admin kann die Config ändern")
  const session = gate.session

  let body: unknown
  try { body = await request.json() } catch { return badRequest() }

  const parsed = FleetConfigSchema.safeParse(body)
  if (!parsed.success) return badRequest()

  let dashboardUrl = parsed.data.dashboard_url
  let setupSecret = parsed.data.setup_secret
  let restoredFrom: number | null = null
  let secretIsEncrypted = false

  // Rollback: Werte aus einem Historien-Eintrag übernehmen (dort bereits
  // verschlüsselt abgelegt -> nicht doppelt verschlüsseln). Leere Werte
  // bedeuten "behalten" (nie still löschen).
  if (parsed.data.restore_id !== undefined) {
    const sb = getServiceClient()
    const { data: hist, error: histError } = await (sb as any)
      .from("fleet_config_history")
      .select("dashboard_url, setup_secret")
      .eq("id", parsed.data.restore_id)
      .maybeSingle()
    if (histError || !hist) return badRequest()
    if (typeof hist.dashboard_url === "string" && hist.dashboard_url !== "") {
      dashboardUrl = hist.dashboard_url
    }
    if (typeof hist.setup_secret === "string" && hist.setup_secret !== "") {
      setupSecret = hist.setup_secret
      secretIsEncrypted = true
    }
    restoredFrom = parsed.data.restore_id
  }

  const sb = getServiceClient()
  if (dashboardUrl === undefined && setupSecret === undefined) return badRequest()
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (dashboardUrl !== undefined) patch.dashboard_url = dashboardUrl
  if (setupSecret !== undefined) {
    patch.setup_secret = secretIsEncrypted ? setupSecret : "enc:" + encryptSecret(setupSecret)
  }

  const { error } = await (sb as any)
    .from("fleet_config")
    .upsert({ ...patch, id: 1 }, { onConflict: "id" })

  if (error) return serverError()

  // Historie für Rollbacks (nur die tatsächlich gesetzten Werte).
  await (sb as any).from("fleet_config_history").insert({
    dashboard_url: typeof patch.dashboard_url === "string" ? patch.dashboard_url : "",
    setup_secret: typeof patch.setup_secret === "string" ? patch.setup_secret : "",
    by_uuid: session.sub,
  })

  await writeAuditLog({
    server_id: session.server_id,
    action: restoredFrom !== null ? "fleet_config_rollback" : "fleet_config_update",
    who_uuid: session.sub,
    details: restoredFrom !== null
      ? { restored_from: restoredFrom }
      : { keys: Object.keys(patch).filter((k) => k !== "updated_at") },
  })

  return ok({ success: true })
}
