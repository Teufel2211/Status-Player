"use client"

import { useCallback, useEffect, useState } from "react"
import { apiFetch, getServerId } from "@/lib/client/auth"
import { cssColor } from "@/lib/color"

type HealthData = {
  status: string
  database: string
  timestamp: string
  previous_secret_active?: boolean
}

type FleetServer = {
  id: string
  created_at: string | null
  known: number | null
  online: number | null
  mod_enabled: boolean
}

type ApiKeyRow = {
  id: number
  server_id: string
  key_prefix: string
  scopes: string[]
  created_at: string
  expires_at: string | null
}

type PresetRow = {
  name: string
  server_id: string
  status: string
  color: string
}

type HistoryRow = {
  id: number
  dashboard_url: string
  has_secret: boolean
  created_at: string | null
}

function SectionHead({ kicker, title, sub }: { kicker: string; title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <div className="kicker mb-1">{kicker}</div>
      <h2 className="font-display font-semibold text-xl" style={{ color: "var(--text-primary)" }}>{title}</h2>
      {sub && <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{sub}</p>}
    </div>
  )
}

export default function AdminOverviewPage() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [servers, setServers] = useState<FleetServer[]>([])
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [presets, setPresets] = useState<PresetRow[]>([])
  const [presetName, setPresetName] = useState("")
  const [presetStatus, setPresetStatus] = useState("")
  const [presetColor, setPresetColor] = useState("")
  const [presetMsg, setPresetMsg] = useState("")
  const [presetBusy, setPresetBusy] = useState(false)
  const [fleetUrl, setFleetUrl] = useState("")
  const [fleetSecret, setFleetSecret] = useState("")
  const [fleetUpdatedAt, setFleetUpdatedAt] = useState<string | null>(null)
  const [fleetMsg, setFleetMsg] = useState("")
  const [fleetBusy, setFleetBusy] = useState(false)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [restoreId, setRestoreId] = useState<number | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [globalModEnabled, setGlobalModEnabled] = useState(true)
  const [bulkModBusy, setBulkModBusy] = useState(false)
  const [modBusyId, setModBusyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const sid = getServerId()
    const tasks: Promise<void>[] = []

    tasks.push(
      fetch("/api/health")
        .then((r) => r.json())
        .then((d) => setHealth(d))
        .catch(() => {})
    )
    tasks.push(
      apiFetch("/api/servers")
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => {
          if (Array.isArray(d)) {
            // Alte API-Form (vor dem Kill-Switch): alles aktiv.
            setServers(d)
            setGlobalModEnabled(true)
          } else {
            setServers(Array.isArray(d?.servers) ? d.servers : [])
            setGlobalModEnabled(d?.global_mod_enabled !== false)
          }
        })
        .catch(() => {})
    )
    tasks.push(
      apiFetch("/api/admin/keys")
        .then((r) => (r.ok ? r.json() : { keys: [] }))
        .then((d) => setKeys(Array.isArray(d.keys) ? d.keys : []))
        .catch(() => {})
    )
    tasks.push(
      apiFetch("/api/fleet/config")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) {
            setFleetUrl(d.dashboard_url ?? "")
            setFleetSecret(d.setup_secret ?? "")
            setFleetUpdatedAt(d.updated_at ?? null)
          }
        })
        .catch(() => {})
    )
    tasks.push(
      apiFetch("/api/fleet/history")
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setHistory(Array.isArray(d) ? d : []))
        .catch(() => {})
    )
    if (sid) {
      tasks.push(
        apiFetch(`/api/presets/${sid}`)
          .then((r) => (r.ok ? r.json() : []))
          .then((d) => setPresets(Array.isArray(d) ? d : []))
          .catch(() => {})
      )
    }

    await Promise.all(tasks)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function savePreset(e: React.FormEvent) {
    e.preventDefault()
    const sid = getServerId()
    if (!sid || !presetName.trim() || !presetStatus.trim()) return
    if (/\s/.test(presetName.trim())) {
      setPresetMsg("Der Preset-Name darf keine Leerzeichen enthalten.")
      return
    }
    setPresetBusy(true)
    setPresetMsg("")
    try {
      const r = await apiFetch(`/api/presets/${sid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: presetName.trim(),
          status: presetStatus.trim(),
          color: presetColor.trim() || "reset",
        }),
      })
      if (r.ok) {
        setPresetName("")
        setPresetStatus("")
        setPresetColor("")
        setPresetMsg("Preset gespeichert.")
        await load()
      } else {
        const d = await r.json().catch(() => null)
        setPresetMsg(d?.error ?? "Speichern fehlgeschlagen.")
      }
    } catch {
      setPresetMsg("Netzwerkfehler.")
    }
    setPresetBusy(false)
  }

  async function deletePreset(name: string) {
    const sid = getServerId()
    if (!sid) return
    try {
      const r = await apiFetch(`/api/presets/${sid}/${encodeURIComponent(name)}`, { method: "DELETE" })
      if (r.ok) await load()
    } catch {}
  }

  async function toggleGlobalMod() {
    const next = !globalModEnabled
    if (!next && !window.confirm(
      "Status Player auf allen Servern deaktivieren? Status-Anzeige, Befehle und Sync werden sofort gestoppt (greift nach max. 15 s)."
    )) return
    setBulkModBusy(true)
    try {
      const r = await apiFetch("/api/admin/servers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mod_enabled: next }),
      })
      if (r.ok) await load()
    } catch {}
    setBulkModBusy(false)
  }

  async function toggleServerMod(s: FleetServer) {
    const next = s.mod_enabled === false
    if (!next && !window.confirm(
      `Status Player auf Server ${s.id.slice(0, 8)} deaktivieren? Status-Anzeige, Befehle und Sync werden sofort gestoppt (greift nach max. 15 s).`
    )) return
    setModBusyId(s.id)
    try {
      const r = await apiFetch(`/api/admin/servers/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mod_enabled: next }),
      })
      if (r.ok) await load()
    } catch {}
    setModBusyId(null)
  }

  async function saveFleet(e: React.FormEvent) {
    e.preventDefault()
    const body: Record<string, unknown> = {}
    if (fleetUrl.trim() !== "") body.dashboard_url = fleetUrl.trim()
    if (fleetSecret.trim() !== "") body.setup_secret = fleetSecret.trim()
    if (Object.keys(body).length === 0) {
      setFleetMsg("Bitte mindestens ein Feld ausfüllen.")
      return
    }
    setFleetBusy(true)
    setFleetMsg("")
    try {
      const r = await apiFetch("/api/fleet/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (r.ok) {
        setFleetMsg("Verteilt — die Server übernehmen die Werte in ca. 1 Minute (Neustart erforderlich).")
        await load()
      } else {
        setFleetMsg("Speichern fehlgeschlagen.")
      }
    } catch {
      setFleetMsg("Netzwerkfehler.")
    }
    setFleetBusy(false)
  }

  async function rollback(id: number) {
    setRestoreId(id)
    setFleetMsg("")
    try {
      const r = await apiFetch("/api/fleet/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restore_id: id }),
      })
      if (r.ok) {
        setFleetMsg(`Stand #${id} wiederhergestellt — übernehmen die Server in ca. 1 Minute (Neustart erforderlich).`)
        await load()
      } else {
        setFleetMsg("Zurücksetzen fehlgeschlagen.")
      }
    } catch {
      setFleetMsg("Netzwerkfehler.")
    }
    setRestoreId(null)
  }

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {}
  }

  const now = Date.now()
  const activeKeys = keys.filter((k) => !k.expires_at || new Date(k.expires_at).getTime() > now)
  const expiringSoon = activeKeys.filter((k) => {
    if (!k.expires_at) return false
    const ms = new Date(k.expires_at).getTime() - now
    return ms > 0 && ms < 7 * 86400000
  })
  const onlineTotal = servers.reduce((a, s) => a + (s.online ?? 0), 0)
  const knownTotal = servers.reduce((a, s) => a + (s.known ?? 0), 0)
  const fleetActive = fleetUrl.trim() !== "" && fleetSecret.trim() !== ""

  type Alert = { level: "error" | "warn" | "info" | "ok"; text: string }
  const alerts: Alert[] = []
  if (health && health.status !== "healthy") alerts.push({ level: "error", text: "Dashboard meldet Probleme — Dienst oder Datenbank nicht erreichbar." })
  if (health?.previous_secret_active) alerts.push({ level: "warn", text: "Alter JWT-Schlüssel noch aktiv (JWT_SECRET_PREVIOUS) — Rotation abschließen." })
  if (!loading && !fleetActive) alerts.push({ level: "warn", text: "Keine Verteilung aktiv — neue Server holen ihre Verbindungsdaten nicht automatisch." })
  if (!loading && activeKeys.length === 0) alerts.push({ level: "warn", text: "Kein aktiver API-Key — der Mod kann sich nicht verbinden." })
  for (const k of expiringSoon) {
    alerts.push({ level: "warn", text: `Key ${k.key_prefix}… läuft ab am ${new Date(k.expires_at as string).toLocaleDateString()}.` })
  }
  if (!loading && servers.length === 0) alerts.push({ level: "info", text: "Noch kein Server registriert — er erscheint automatisch beim ersten Setup." })
  if (!loading && servers.length > 0 && knownTotal === 0) alerts.push({ level: "info", text: "Noch keine Spieler bekannt — die Daten kommen mit dem ersten Sync." })
  if (!loading && alerts.length === 0) alerts.push({ level: "ok", text: "Alles in Ordnung." })

  const alertColor = (level: Alert["level"]) =>
    level === "error" ? "var(--red)" :
    level === "warn" ? "var(--amber)" :
    level === "ok" ? "var(--accent)" : "var(--text-muted)"
  const alertLine = (level: Alert["level"]) =>
    level === "error" ? "var(--red-line)" :
    level === "warn" ? "var(--amber-line)" : "var(--border)"

  return (
    <div>
      <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="kicker mb-2">Admin-Dashboard · {servers.length} Server · {onlineTotal} online</div>
          <h1 className="font-display font-bold text-3xl" style={{ color: "var(--text-primary)" }}>Übersicht</h1>
        </div>
        <div
          className="flex items-center gap-2 px-4 py-2 rounded-xl font-mono text-xs"
          style={{
            border: `1px solid ${health?.status === "healthy" ? "var(--accent-line)" : "var(--border)"}`,
            backgroundColor: health?.status === "healthy" ? "var(--accent-soft)" : "var(--bg-hover)",
            color: health?.status === "healthy" ? "var(--accent-text)" : "var(--text-muted)",
          }}
        >
          <span className="pulse-dot" />
          {health?.status === "healthy" ? "VERBUNDEN" : health ? "GETRENNT" : "…"}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="card !p-5">
          <div className="kicker mb-2" style={{ fontSize: "10px" }}>Server</div>
          <span className="stat-num">{servers.length}</span>
        </div>
        <div className="card !p-5">
          <div className="kicker mb-2" style={{ fontSize: "10px" }}>Spieler online</div>
          <div className="flex items-center gap-2">
            <span className="stat-num">{onlineTotal}</span>
            {onlineTotal > 0 && <span className="pulse-dot" />}
          </div>
        </div>
        <div className="card !p-5">
          <div className="kicker mb-2" style={{ fontSize: "10px" }}>Datenbank</div>
          <div className="flex items-center gap-2">
            <span className="stat-num">{health ? (health.database === "connected" ? "OK" : "!") : "—"}</span>
            {health && (health.database === "connected"
              ? <span className="badge-green">verbunden</span>
              : <span className="badge-red">Fehler</span>)}
          </div>
        </div>
        <div className="card !p-5">
          <div className="kicker mb-2" style={{ fontSize: "10px" }}>API-Keys aktiv</div>
          <div className="flex items-center gap-2">
            <span className="stat-num">{loading ? "—" : activeKeys.length}</span>
            {expiringSoon.length > 0 && <span className="badge-yellow">{expiringSoon.length} bald ab</span>}
          </div>
        </div>
      </div>

      <div className="mb-8">
        <SectionHead kicker="Status" title="Warnungen" sub="Was Aufmerksamkeit braucht — sonst ist alles ruhig." />
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div
              key={i}
              className="card !py-3 !px-4 flex items-center gap-3"
              style={{ borderColor: alertLine(a.level) }}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: alertColor(a.level) }} />
              <p className="text-sm" style={{ color: "var(--text-primary)" }}>{a.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-8">
        <SectionHead
          kicker="Global"
          title="Alle Server"
          sub="Jeder Server meldet sich automatisch beim ersten Setup. Status Player lässt sich pro Server oder global stilllegen."
        />
        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton h-28" />)}
          </div>
        ) : servers.length === 0 ? (
          <div className="card text-center py-10">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>Noch kein Server registriert</p>
          </div>
        ) : (
          <>
            <div
              className="card !p-4 mb-4 flex items-center justify-between gap-4 flex-wrap"
              style={{ borderColor: globalModEnabled ? "var(--border)" : "var(--red-line)" }}
            >
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display font-semibold text-sm" style={{ color: "var(--text-primary)" }}>Status Player global</span>
                  {globalModEnabled
                    ? <span className="badge-green text-[10px]">Aktiv</span>
                    : <span className="badge-red text-[10px]">Alle Server aus</span>}
                </div>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {globalModEnabled
                    ? "Die Schalter der einzelnen Server gelten."
                    : "Übersteuert alle Server. Einzelne Schalter bleiben gespeichert."}
                </p>
              </div>
              <button
                type="button"
                onClick={toggleGlobalMod}
                disabled={bulkModBusy}
                className={globalModEnabled ? "btn-danger text-xs px-4 py-2" : "btn-primary text-xs px-4 py-2"}
              >
                {bulkModBusy ? "Speichert…" : globalModEnabled ? "Alle deaktivieren" : "Global aktivieren"}
              </button>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {servers.map((s) => {
                const effective = globalModEnabled && s.mod_enabled !== false
                return (
                  <div
                    key={s.id}
                    className="card !p-5"
                    style={{ borderColor: effective ? "var(--border)" : "var(--red-line)" }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="font-display font-semibold" style={{ color: "var(--text-primary)" }}>{s.id.slice(0, 8)}</span>
                      <button
                        onClick={() => copyId(s.id)}
                        className="font-mono text-[11px] px-2.5 py-1 rounded-lg transition-colors"
                        style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-primary)", color: "var(--text-muted)" }}
                      >
                        {copiedId === s.id ? "kopiert" : "ID kopieren"}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                      {(s.online ?? 0) > 0 && <span className="pulse-dot" />}
                      <span>
                        {s.online ?? "—"} online · {s.known ?? "—"} bekannt
                        {s.created_at ? ` · seit ${new Date(s.created_at).toLocaleDateString()}` : ""}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono mt-2 break-all" style={{ color: "var(--text-muted)" }}>{s.id}</p>

                    <div className="flex items-center justify-between gap-3 mt-4 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>Status Player</span>
                          {effective
                            ? <span className="badge-green text-[10px]">Aktiv</span>
                            : <span className="badge-red text-[10px]">{globalModEnabled ? "Deaktiviert" : "Global aus"}</span>}
                        </div>
                        <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>Greift nach max. 15 s</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={s.mod_enabled !== false}
                        aria-label={`Status Player auf Server ${s.id.slice(0, 8)} ${s.mod_enabled === false ? "aktivieren" : "deaktivieren"}`}
                        disabled={!globalModEnabled || bulkModBusy || modBusyId === s.id}
                        onClick={() => toggleServerMod(s)}
                        className="relative shrink-0 rounded-full transition-colors disabled:opacity-40"
                        style={{
                          width: 38,
                          height: 22,
                          backgroundColor: s.mod_enabled !== false ? "var(--accent)" : "var(--bg-hover)",
                          border: `1px solid ${s.mod_enabled !== false ? "var(--accent)" : "var(--border)"}`,
                        }}
                      >
                        <span
                          className="absolute top-1/2 rounded-full bg-white transition-transform"
                          style={{
                            left: 0,
                            width: 16,
                            height: 16,
                            marginTop: -8,
                            transform: s.mod_enabled !== false ? "translateX(19px)" : "translateX(3px)",
                          }}
                        />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      <div className="mb-8">
        <SectionHead kicker="Verwaltung" title="Presets & Verteilung" sub="Schnellauswahl für deinen Server und Verbindungsdaten für alle Server." />
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <div className="card">
            <h3 className="font-display font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Presets</h3>
            {presets.length === 0 ? (
              <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>Noch keine Presets.</p>
            ) : (
              <div className="space-y-2 mb-4">
                {presets.map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center gap-3 rounded-xl px-3 py-2"
                    style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-primary)" }}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 inline-block" style={{ background: cssColor(p.color || "reset") }} />
                    <span className="font-mono text-xs" style={{ color: "var(--text-primary)" }}>{p.name}</span>
                    <span className="text-xs flex-1 min-w-0 truncate" style={{ color: "var(--text-muted)" }}>{p.status}</span>
                    <button onClick={() => deletePreset(p.name)} className="text-xs transition-opacity hover:opacity-80" style={{ color: "var(--red)" }}>
                      Löschen
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={savePreset} className="space-y-3">
              <div>
                <label className="label">Name</label>
                <input className="input" value={presetName} onChange={(e) => setPresetName(e.target.value)} maxLength={32} placeholder="z. B. farmen" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Status</label>
                  <input className="input" value={presetStatus} onChange={(e) => setPresetStatus(e.target.value)} maxLength={64} placeholder="Farmen" />
                </div>
                <div>
                  <label className="label">Farbe (optional)</label>
                  <input className="input" value={presetColor} onChange={(e) => setPresetColor(e.target.value)} maxLength={32} placeholder="green" />
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button type="submit" className="btn-primary text-xs px-4 py-2" disabled={presetBusy || !presetName.trim() || !presetStatus.trim()}>
                  {presetBusy ? "Speichert…" : "Preset speichern"}
                </button>
                {presetMsg && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{presetMsg}</span>}
              </div>
            </form>
          </div>

          <div className="card">
            <h3 className="font-display font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Verteilung</h3>
            <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
              Verbindungsdaten für alle Server. Mods holen sie sich automatisch beim Start.
            </p>
            <form onSubmit={saveFleet} className="space-y-3">
              <div>
                <label className="label">Dashboard-URL</label>
                <input className="input font-mono text-xs" value={fleetUrl} onChange={(e) => setFleetUrl(e.target.value)} maxLength={256} placeholder="https://statusmod-dashboard.vercel.app" />
              </div>
              <div>
                <label className="label">Setup-Secret</label>
                <input className="input font-mono text-xs" value={fleetSecret} onChange={(e) => setFleetSecret(e.target.value)} maxLength={512} placeholder="…" />
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button type="submit" className="btn-primary text-xs px-4 py-2" disabled={fleetBusy}>
                  {fleetBusy ? "Verteilt…" : "Verteilen"}
                </button>
                {fleetUpdatedAt && (
                  <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
                    zuletzt {new Date(fleetUpdatedAt).toLocaleString()}
                  </span>
                )}
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Die Server übernehmen Änderungen in ca. 1 Minute — Neustart erforderlich.
              </p>
              {fleetMsg && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{fleetMsg}</p>}
            </form>
          </div>
        </div>

        <div className="card mt-4">
          <h3 className="font-display font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Verlauf & Rollback</h3>
          <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>Die letzten Verteilungen — jeder Stand lässt sich wiederherstellen.</p>
          {history.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>Noch keine Einträge.</p>
          ) : (
            <div className="space-y-2">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-3 rounded-xl px-3 py-2 flex-wrap"
                  style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-primary)" }}
                >
                  <span className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>#{h.id}</span>
                  <span className="text-xs font-mono flex-1 min-w-[160px] truncate" style={{ color: "var(--text-secondary)" }}>
                    {h.dashboard_url || "—"}
                  </span>
                  <span className="badge-neutral text-[10px]" style={{ opacity: h.has_secret ? 1 : 0.5 }}>
                    {h.has_secret ? "mit Secret" : "ohne Secret"}
                  </span>
                  <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
                    {h.created_at ? new Date(h.created_at).toLocaleString() : ""}
                  </span>
                  <button
                    onClick={() => rollback(h.id)}
                    disabled={restoreId !== null}
                    className="text-xs transition-opacity hover:opacity-80 disabled:opacity-40"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {restoreId === h.id ? "Setzt zurück…" : "Zurückrollen"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
