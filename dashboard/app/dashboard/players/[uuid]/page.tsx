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
}

export default function PlayerDetailPage() {
  const { uuid } = useParams<{ uuid: string }>()
  const [player, setPlayer] = useState<PlayerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState("")
  const [color, setColor] = useState("reset")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    if (!uuid) return
    const serverId = getServerId()
    if (!serverId) return

    try {
      const r = await apiFetch(`/api/players/${serverId}/${uuid}`)
      const d = await r.json()
      setPlayer(d)
      setStatus(d?.status ?? "")
      setColor(d?.color ?? "reset")
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
          </div>
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl" style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-primary)" }}>
            {player.color && player.color !== "reset" && (
              <span className="w-3.5 h-3.5 rounded-full inline-block shrink-0" style={{ background: cssColor(player.color) }} />
            )}
            <span className="font-display font-semibold" style={{ color: "var(--text-primary)" }}>{player.status ?? "—"}</span>
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

      <div className="card">
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
    </div>
  )
}
