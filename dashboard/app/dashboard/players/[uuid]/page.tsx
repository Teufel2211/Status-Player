"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { apiFetch, getServerId } from "@/lib/client/auth"
import { cssColor } from "@/lib/color"
import { PlayerAvatar } from "@/components/player-avatar"

const COLORS = [
  "reset", "black", "dark_blue", "dark_green", "dark_aqua", "dark_red",
  "dark_purple", "gold", "gray", "dark_gray", "blue", "green",
  "aqua", "red", "light_purple", "yellow", "white",
]

const IGNORE_DURATIONS = [
  { label: "30 Minuten", minutes: 30 },
  { label: "1 Stunde", minutes: 60 },
  { label: "6 Stunden", minutes: 360 },
  { label: "1 Tag", minutes: 1440 },
  { label: "7 Tage", minutes: 10080 },
]

type Warning = {
  id: number
  reason: string | null
  created_at: string
  expires_at: string
}

type IgnoreInfo = {
  uuid: string
  blocked_at: string
  expires_at: string | null
}

type PlayerDetail = {
  id: number
  server_id: string
  uuid: string
  username: string | null
  status: string | null
  color: string | null
  avatar: string | null
  created_at: string
  updated_at: string | null
  anonymized: boolean | null
  is_online?: boolean
  status_expires_at?: string | null
  slowmode_seconds?: number
  warnings?: Warning[]
  ignore?: IgnoreInfo | null
}

type ModerationSettings = {
  warn_default_days: number
  warn_auto_mute_suggestion: boolean
}

function formatRemaining(iso: string | null | undefined): string {
  if (!iso) return ""
  const diff = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(diff) || diff <= 0) return ""
  const mins = Math.ceil(diff / 60000)
  if (mins < 60) return `${mins} Min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} Std ${mins % 60} Min`
  const days = Math.floor(hours / 24)
  return `${days} Tag${days === 1 ? "" : "e"} ${hours % 24} Std`
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })
}

export default function PlayerDetailPage() {
  const { uuid } = useParams<{ uuid: string }>()
  const [player, setPlayer] = useState<PlayerDetail | null>(null)
  const [settings, setSettings] = useState<ModerationSettings>({ warn_default_days: 14, warn_auto_mute_suggestion: false })
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState("")
  const [color, setColor] = useState("reset")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  const [slowmode, setSlowmode] = useState(0)
  const [slowmodeBusy, setSlowmodeBusy] = useState(false)
  const [slowmodeSaved, setSlowmodeSaved] = useState(false)
  const [ignoreMinutes, setIgnoreMinutes] = useState(60)
  const [ignoreBusy, setIgnoreBusy] = useState(false)
  const [warnReason, setWarnReason] = useState("")
  const [warnDays, setWarnDays] = useState(14)
  const [warnBusy, setWarnBusy] = useState(false)
  const [moderationError, setModerationError] = useState("")
  const [muteBusy, setMuteBusy] = useState(false)

  const load = useCallback(async () => {
    if (!uuid) return
    const serverId = getServerId()
    if (!serverId) return

    try {
      const [playerRes, settingsRes] = await Promise.all([
        apiFetch(`/api/players/${serverId}/${uuid}`),
        apiFetch(`/api/server/${serverId}/moderation`),
      ])
      if (playerRes.ok) {
        const d = await playerRes.json()
        setPlayer(d)
        setStatus(d?.status ?? "")
        setColor(d?.color ?? "reset")
        setSlowmode(d?.slowmode_seconds ?? 0)
      }
      if (settingsRes.ok) {
        const s = await settingsRes.json()
        setSettings(s)
        setWarnDays((prev) => (prev === 14 ? s.warn_default_days : prev))
      }
    } catch {}
    setLoading(false)
  }, [uuid])

  useEffect(() => { load() }, [load])

  const save = async () => {
    const serverId = getServerId()
    if (!serverId || !uuid) return
    setSaving(true)
    setError("")
    setSaved(false)
    try {
      const r = await apiFetch(`/api/players/${serverId}/${uuid}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, color }),
      })
      if (r.ok) {
        setSaved(true)
        setPlayer((p) => p ? { ...p, status, color } : p)
        setTimeout(() => setSaved(false), 2000)
      } else {
        const d = await r.json().catch(() => ({}))
        setError(d.error ?? "Speichern fehlgeschlagen")
      }
    } catch {
      setError("Netzwerkfehler")
    }
    setSaving(false)
  }

  const saveSlowmode = async () => {
    const serverId = getServerId()
    if (!serverId || !uuid) return
    setSlowmodeBusy(true)
    setModerationError("")
    setSlowmodeSaved(false)
    try {
      const r = await apiFetch(`/api/players/${serverId}/${uuid}/slowmode`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: slowmode }),
      })
      if (r.ok) {
        setSlowmodeSaved(true)
        setPlayer((p) => p ? { ...p, slowmode_seconds: slowmode } : p)
        setTimeout(() => setSlowmodeSaved(false), 2000)
      } else {
        const d = await r.json().catch(() => ({}))
        setModerationError(d.error ?? "Slowmode konnte nicht gespeichert werden")
      }
    } catch {
      setModerationError("Netzwerkfehler")
    }
    setSlowmodeBusy(false)
  }

  const startIgnore = async () => {
    const serverId = getServerId()
    if (!serverId || !uuid) return
    setIgnoreBusy(true)
    setModerationError("")
    try {
      const r = await apiFetch(`/api/players/${serverId}/${uuid}/ignore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration_minutes: ignoreMinutes }),
      })
      if (r.ok) await load()
      else {
        const d = await r.json().catch(() => ({}))
        setModerationError(d.error ?? "Ignore konnte nicht gesetzt werden")
      }
    } catch {
      setModerationError("Netzwerkfehler")
    }
    setIgnoreBusy(false)
  }

  const endIgnore = async () => {
    const serverId = getServerId()
    if (!serverId || !uuid) return
    setIgnoreBusy(true)
    setModerationError("")
    try {
      const r = await apiFetch(`/api/players/${serverId}/${uuid}/ignore`, { method: "DELETE" })
      if (r.ok) await load()
      else {
        const d = await r.json().catch(() => ({}))
        setModerationError(d.error ?? "Ignore konnte nicht aufgehoben werden")
      }
    } catch {
      setModerationError("Netzwerkfehler")
    }
    setIgnoreBusy(false)
  }

  const addWarning = async () => {
    const serverId = getServerId()
    if (!serverId || !uuid) return
    setWarnBusy(true)
    setModerationError("")
    try {
      const r = await apiFetch(`/api/players/${serverId}/${uuid}/warnings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: warnReason.trim(), days: warnDays }),
      })
      if (r.ok) {
        setWarnReason("")
        await load()
      } else {
        const d = await r.json().catch(() => ({}))
        setModerationError(d.error ?? "Warnung konnte nicht hinzugefügt werden")
      }
    } catch {
      setModerationError("Netzwerkfehler")
    }
    setWarnBusy(false)
  }

  const revokeWarning = async (id: number) => {
    const serverId = getServerId()
    if (!serverId || !uuid) return
    setWarnBusy(true)
    setModerationError("")
    try {
      const r = await apiFetch(`/api/players/${serverId}/${uuid}/warnings?id=${id}`, { method: "DELETE" })
      if (r.ok) await load()
      else {
        const d = await r.json().catch(() => ({}))
        setModerationError(d.error ?? "Warnung konnte nicht zurückgenommen werden")
      }
    } catch {
      setModerationError("Netzwerkfehler")
    }
    setWarnBusy(false)
  }

  const applyMute = async () => {
    const serverId = getServerId()
    if (!serverId || !uuid) return
    setMuteBusy(true)
    setModerationError("")
    try {
      const r = await apiFetch(`/api/players/${serverId}/${uuid}/mute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration_minutes: 60 }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setModerationError(d.error ?? "Mute konnte nicht gesetzt werden")
      }
    } catch {
      setModerationError("Netzwerkfehler")
    }
    setMuteBusy(false)
  }

  if (loading) return (
    <div className="space-y-3">
      <div className="skeleton h-24" />
      <div className="skeleton h-40" />
    </div>
  )

  if (!player) {
    return (
      <div className="card text-center py-12">
        <div className="font-display text-4xl mb-3" style={{ color: "var(--text-muted)" }}>◎</div>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Spieler nicht gefunden</p>
        <a href="/dashboard/players" className="font-mono text-xs underline underline-offset-2 mt-3 inline-block" style={{ color: "var(--accent-text)" }}>← zurück zur Liste</a>
      </div>
    )
  }

  const displayColor = cssColor(color)
  const warnings = player.warnings ?? []
  const warnLevel = Math.min(3, warnings.length)
  const warnColor = warnLevel >= 3 ? "var(--red)" : warnLevel === 2 ? "#f59e0b" : "#eab308"
  const statusRemaining = formatRemaining(player.status_expires_at)
  const ignoreRemaining = player.ignore
    ? (player.ignore.expires_at ? formatRemaining(player.ignore.expires_at) : "permanent")
    : ""

  return (
    <div>
      <a href="/dashboard/players" className="font-mono text-xs underline underline-offset-2" style={{ color: "var(--text-muted)" }}>← Spielerliste</a>
      <div className="card mt-4 mb-4">
        <div className="flex items-center gap-5 flex-wrap">
          <PlayerAvatar uuid={player.uuid} username={player.username} avatar={player.avatar} sizePx={76} />
          <div className="flex-1 min-w-[200px]">
            <div className="kicker mb-1">Profil · {player.uuid.slice(0, 8)}</div>
            <h1 className="font-display font-bold text-3xl" style={{ color: "var(--text-primary)" }}>
              {player.username ?? "Unbekannter Spieler"}
            </h1>
            <p className="text-xs font-mono mt-1.5 break-all" style={{ color: "var(--text-muted)" }}>{player.uuid}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="font-mono text-[11px] px-2 py-0.5 rounded-full" style={{
                color: player.is_online ? "var(--accent-text)" : "var(--text-muted)",
                backgroundColor: "var(--bg-input)",
                border: "1px solid var(--border)",
              }}>
                {player.is_online ? "● online" : "○ offline"}
              </span>
              {warnLevel > 0 && (
                <span className="font-mono text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{
                  color: warnColor,
                  border: `1px solid ${warnColor}`,
                  backgroundColor: "var(--bg-input)",
                }}>
                  Warnstufe {warnLevel}
                </span>
              )}
              {ignoreRemaining && (
                <span className="font-mono text-[11px] px-2 py-0.5 rounded-full" style={{
                  color: "var(--text-secondary)", border: "1px solid var(--border)", backgroundColor: "var(--bg-input)",
                }}>
                  ignoriert · {ignoreRemaining}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl" style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-primary)" }}>
            {player.color && player.color !== "reset" && (
              <span className="w-3.5 h-3.5 rounded-full inline-block shrink-0" style={{ background: cssColor(player.color) }} />
            )}
            <span className="font-display font-semibold" style={{ color: "var(--text-primary)" }}>{player.status ?? "—"}</span>
            {statusRemaining && (
              <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>· {statusRemaining}</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        {[
          { label: "Beigetreten", value: new Date(player.created_at).toLocaleDateString() },
          { label: "Aktualisiert", value: player.updated_at ? new Date(player.updated_at).toLocaleDateString() : "—" },
        ].map((s) => (
          <div key={s.label} className="card !p-4">
            <div className="kicker mb-1" style={{ fontSize: "10px" }}>{s.label}</div>
            <div className="font-mono text-sm" style={{ color: "var(--text-primary)" }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="card mb-4">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
          <h2 className="font-display font-semibold" style={{ color: "var(--text-primary)" }}>Status bearbeiten</h2>
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: displayColor }} />
            <span className="text-xs truncate max-w-[160px] font-mono" style={{ color: "var(--text-secondary)" }}>{status || "—"}</span>
          </span>
        </div>
        <div className="space-y-4">
          <div>
            <label className="label">Statustext</label>
            <input
              type="text"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              maxLength={64}
              placeholder="AFK, Bauen, PvP…"
              className="input"
            />
          </div>

          <div>
            <label className="label">Farbe</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-lg border-2 transition-colors"
                  style={{
                    backgroundColor: cssColor(c),
                    borderColor: color === c ? "var(--accent)" : "var(--border)",
                    boxShadow: color === c ? "0 0 0 2px var(--accent-soft)" : undefined,
                  }}
                  title={c}
                />
              ))}
              <input
                type="text"
                value={color.startsWith("#") ? color : ""}
                onChange={(e) => { const v = e.target.value; if (v.startsWith("#")) setColor(v) }}
                placeholder="#RRGGBB"
                className="w-24 rounded-lg px-2 py-1 text-xs font-mono"
                style={{
                  backgroundColor: "var(--bg-input)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2 flex-wrap">
            <button
              onClick={save}
              disabled={saving}
              className="btn-primary text-sm px-5 py-2"
            >
              {saving ? "Speichert…" : "Status speichern"}
            </button>
            {saved && <span className="text-xs" style={{ color: "var(--accent-text)" }}>Gespeichert — in ~30 s im Spiel sichtbar.</span>}
            {error && <span className="text-xs" style={{ color: "var(--red)" }}>{error}</span>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="card">
          <h2 className="font-display font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Slowmode</h2>
          <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
            Mindestabstand zwischen zwei Chat-Nachrichten. 0 = aus. Befehle sind nicht betroffen.
          </p>
          <label className="label">Sekunden</label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={0}
              max={3600}
              value={slowmode}
              onChange={(e) => setSlowmode(Math.max(0, Math.min(3600, Number(e.target.value) || 0)))}
              className="input max-w-[140px]"
            />
            <button onClick={saveSlowmode} disabled={slowmodeBusy} className="btn-primary text-sm px-4 py-2">
              {slowmodeBusy ? "Speichert…" : "Speichern"}
            </button>
          </div>
          {slowmodeSaved && <p className="text-xs mt-2" style={{ color: "var(--accent-text)" }}>Gespeichert.</p>}
        </div>

        <div className="card">
          <h2 className="font-display font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Kurzzeit-Ignore</h2>
          <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
            Status wird versteckt und nach Ablauf automatisch wiederhergestellt.
          </p>
          {player.ignore ? (
            <div className="space-y-3">
              <div className="text-sm" style={{ color: "var(--text-primary)" }}>
                Ignoriert {player.ignore.expires_at ? `bis ${formatDate(player.ignore.expires_at)}` : "permanent"}
                {ignoreRemaining && ignoreRemaining !== "permanent" && (
                  <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}> · noch {ignoreRemaining}</span>
                )}
              </div>
              <button onClick={endIgnore} disabled={ignoreBusy} className="btn-secondary text-sm px-4 py-2">
                {ignoreBusy ? "…" : "Ignore aufheben"}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={ignoreMinutes}
                onChange={(e) => setIgnoreMinutes(Number(e.target.value))}
                className="input max-w-[170px]"
              >
                {IGNORE_DURATIONS.map((d) => (
                  <option key={d.minutes} value={d.minutes}>{d.label}</option>
                ))}
              </select>
              <button onClick={startIgnore} disabled={ignoreBusy} className="btn-primary text-sm px-4 py-2">
                {ignoreBusy ? "…" : "Ignorieren"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 className="font-display font-semibold" style={{ color: "var(--text-primary)" }}>Warnungen</h2>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Nur aktive Warnungen zählen. Badge ingame: {warnLevel > 0 ? `Stufe ${warnLevel}` : "keine"}.
            </p>
          </div>
          {warnLevel > 0 && (
            <span className="font-mono text-xs px-2.5 py-1 rounded-full font-semibold" style={{
              color: warnColor, border: `1px solid ${warnColor}`, backgroundColor: "var(--bg-input)",
            }}>
              {warnLevel} / 3 aktiv
            </span>
          )}
        </div>

        {warnings.length === 0 ? (
          <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>Keine aktiven Warnungen.</p>
        ) : (
          <div className="space-y-2 mb-4">
            {warnings.map((w) => (
              <div key={w.id} className="flex items-start gap-3 p-3 rounded-lg" style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-primary)" }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm" style={{ color: "var(--text-primary)" }}>{w.reason || "(ohne Grund)"}</div>
                  <div className="text-xs font-mono mt-1" style={{ color: "var(--text-muted)" }}>
                    {formatDate(w.created_at)} · läuft ab in {formatRemaining(w.expires_at) || "weniger als 1 Minute"}
                  </div>
                </div>
                <button onClick={() => revokeWarning(w.id)} disabled={warnBusy} className="btn-secondary text-xs px-3 py-1.5 shrink-0">
                  Zurücknehmen
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[1fr_130px_auto] gap-3 items-end">
          <div>
            <label className="label">Grund (optional)</label>
            <input
              type="text"
              value={warnReason}
              onChange={(e) => setWarnReason(e.target.value)}
              maxLength={200}
              placeholder="z. B. Spam im Chat"
              className="input"
            />
          </div>
          <div>
            <label className="label">Gültig (Tage)</label>
            <input
              type="number"
              min={1}
              max={365}
              value={warnDays}
              onChange={(e) => setWarnDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
              className="input"
            />
          </div>
          <button onClick={addWarning} disabled={warnBusy || warnLevel >= 3} className="btn-primary text-sm px-4 py-2.5">
            {warnBusy ? "…" : "Warnung hinzufügen"}
          </button>
        </div>

        {warnLevel >= 3 && (
          <div className="mt-4 p-3 rounded-lg" style={{ border: "1px solid var(--red-line)", backgroundColor: "var(--red-soft)" }}>
            {settings.warn_auto_mute_suggestion ? (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                  3 aktive Warnungen — automatischer Mute ist <strong>nicht</strong> aktiv. Vorschlag: 60 Minuten Mute.
                </p>
                <button onClick={applyMute} disabled={muteBusy} className="btn-danger text-sm px-4 py-2">
                  {muteBusy ? "…" : "Mute jetzt anwenden"}
                </button>
              </div>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                3 aktive Warnungen erreicht. Mute-Vorschläge sind in den Moderationseinstellungen deaktiviert.
              </p>
            )}
          </div>
        )}

        {moderationError && <p className="text-xs mt-3" style={{ color: "var(--red)" }}>{moderationError}</p>}
      </div>
    </div>
  )
}
