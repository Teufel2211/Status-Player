"use client"

import { Fragment, useEffect, useState } from "react"
import { apiFetch } from "@/lib/client/auth"
import { cssColor } from "@/lib/color"
import { PlayerAvatar } from "@/components/player-avatar"

const COLORS = [
  "reset", "black", "dark_blue", "dark_green", "dark_aqua", "dark_red",
  "dark_purple", "gold", "gray", "dark_gray", "blue", "green",
  "aqua", "red", "light_purple", "yellow", "white",
]

type AdminPlayer = {
  id: number
  server_id: string
  uuid: string
  username: string | null
  status: string | null
  color: string | null
  avatar: string | null
  is_online: boolean | null
  created_at: string
}

const rowKey = (p: AdminPlayer) => `${p.server_id}:${p.uuid}`

export default function AdminPlayersPage() {
  const [players, setPlayers] = useState<AdminPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [onlineOnly, setOnlineOnly] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [editStatus, setEditStatus] = useState("")
  const [editColor, setEditColor] = useState("reset")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    apiFetch("/api/admin/players")
      .then((r) => (r.ok ? r.json() : { players: [] }))
      .then((d) => setPlayers(Array.isArray(d.players) ? d.players : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function startEdit(p: AdminPlayer) {
    setEditing(rowKey(p))
    setEditStatus(p.status ?? "")
    setEditColor(p.color ?? "reset")
    setError("")
  }

  function cancelEdit() {
    setEditing(null)
    setError("")
  }

  async function save(p: AdminPlayer) {
    setSaving(true)
    setError("")
    try {
      const r = await apiFetch(`/api/players/${p.server_id}/${p.uuid}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: editStatus, color: editColor }),
      })
      if (r.ok) {
        setPlayers((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: editStatus, color: editColor } : x)))
        setEditing(null)
      } else {
        setError(`Speichern fehlgeschlagen (${r.status})`)
      }
    } catch {
      setError("Netzwerkfehler")
    }
    setSaving(false)
  }

  const q = query.trim().toLowerCase()
  const filtered = players.filter((p) => {
    if (onlineOnly && !p.is_online) return false
    if (!q) return true
    return (
      (p.username ?? "").toLowerCase().includes(q) ||
      p.uuid.toLowerCase().includes(q) ||
      p.server_id.toLowerCase().includes(q)
    )
  })
  const onlineCount = players.filter((p) => p.is_online).length

  return (
    <div>
      <div className="mb-6">
        <div className="kicker mb-2">Admin-Dashboard · {players.length} Spieler · {onlineCount} online</div>
        <h1 className="font-display font-bold text-3xl" style={{ color: "var(--text-primary)" }}>Spieler</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Alle Spieler aller Server — Status und Farbe direkt änderbar.</p>
      </div>

      <div className="card mb-4 !p-4">
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm" style={{ color: "var(--text-muted)" }}>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, UUID oder Server suchen…"
              className="input !pl-10"
              spellCheck={false}
            />
          </div>
          <button
            onClick={() => setOnlineOnly(!onlineOnly)}
            className="font-mono text-xs px-4 rounded-lg border transition-colors"
            style={onlineOnly ? {
              borderColor: "var(--accent-line)",
              backgroundColor: "var(--accent-soft)",
              color: "var(--accent-text)",
            } : {
              borderColor: "var(--border)",
              backgroundColor: "var(--bg-input)",
              color: "var(--text-muted)",
            }}
          >
            ● nur online
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm rounded-lg px-3 py-2 mb-4" style={{ color: "var(--red)", backgroundColor: "var(--red-soft)", border: "1px solid var(--red-line)" }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-16" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <div className="font-display text-4xl mb-3" style={{ color: "var(--text-muted)" }}>◎</div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {players.length === 0 ? "Noch keine Spieler bekannt" : "Kein Treffer — andere Suche probieren"}
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b font-mono text-[11px] uppercase tracking-widest" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-primary)", color: "var(--text-muted)" }}>
                <th className="text-left px-5 py-3 font-medium">Spieler</th>
                <th className="text-left px-5 py-3 font-medium hidden md:table-cell">Server</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium hidden sm:table-cell">Farbe</th>
                <th className="text-right px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <Fragment key={rowKey(p)}>
                  <tr
                    className="border-b transition-colors"
                    style={{ borderColor: "var(--border)", opacity: p.is_online ? 1 : 0.55 }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-hover)"; e.currentTarget.style.opacity = "1" }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; e.currentTarget.style.opacity = p.is_online ? "1" : "0.55" }}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <PlayerAvatar uuid={p.uuid} username={p.username} avatar={p.avatar} sizePx={24} />
                        <span
                          className="w-1.5 h-1.5 rounded-full inline-block"
                          style={p.is_online ? { backgroundColor: "var(--accent)" } : { backgroundColor: "var(--border)" }}
                          title={p.is_online ? "online" : "offline"}
                        />
                        <span className="font-medium" style={{ color: "var(--text-primary)" }}>{p.username ?? "—"}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 hidden md:table-cell">
                      <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>{p.server_id.slice(0, 8)}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      {p.status ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-primary)" }}>
                          {p.color && <span className="w-2 h-2 rounded-full inline-block" style={{ background: cssColor(p.color) }} />}
                          <span style={{ color: "var(--text-secondary)" }}>{p.status}</span>
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 hidden sm:table-cell">
                      {p.color ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: cssColor(p.color) }} />
                          <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>{p.color}</span>
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => (editing === rowKey(p) ? cancelEdit() : startEdit(p))}
                        className="text-xs transition-opacity hover:opacity-80"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {editing === rowKey(p) ? "Schließen" : "Ändern"}
                      </button>
                    </td>
                  </tr>
                  {editing === rowKey(p) && (
                    <tr className="border-b" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-primary)" }}>
                      <td colSpan={5} className="px-5 py-4">
                        <div className="space-y-3 max-w-2xl">
                          <div>
                            <label className="label">Statustext</label>
                            <input
                              type="text"
                              value={editStatus}
                              onChange={(e) => setEditStatus(e.target.value)}
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
                                  onClick={() => setEditColor(c)}
                                  className="w-7 h-7 rounded-lg border-2 transition-colors"
                                  style={{
                                    backgroundColor: cssColor(c),
                                    borderColor: editColor === c ? "var(--accent)" : "var(--border)",
                                    boxShadow: editColor === c ? "0 0 0 2px var(--accent-soft)" : undefined,
                                  }}
                                  title={c}
                                />
                              ))}
                              <input
                                type="text"
                                value={editColor.startsWith("#") ? editColor : ""}
                                onChange={(e) => { const v = e.target.value; if (v.startsWith("#")) setEditColor(v) }}
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
                          <div className="flex items-center gap-3">
                            <button onClick={() => save(p)} disabled={saving} className="btn-primary text-xs px-4 py-2">
                              {saving ? "Speichert…" : "Speichern"}
                            </button>
                            <button onClick={cancelEdit} className="btn-secondary text-xs px-4 py-2">
                              Abbrechen
                            </button>
                            <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
                              in ~30 s ingame sichtbar
                            </span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
