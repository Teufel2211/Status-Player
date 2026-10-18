"use client"

import { useEffect, useState } from "react"
import { apiFetch, getServerId } from "@/lib/client/auth"
import { useRealtimePlayers } from "@/lib/client/use-realtime"
import { cssColor } from "@/lib/color"
import { PlayerAvatar } from "@/components/player-avatar"

type PlayerRow = {
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

export default function PlayersPage() {
  const [players, setPlayers] = useState<PlayerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [onlineOnly, setOnlineOnly] = useState(false)
  const { players: livePlayers, connection } = useRealtimePlayers()

  useEffect(() => {
    const serverId = getServerId()
    if (!serverId) { setLoading(false); return }

    apiFetch(`/api/players/${serverId}`)
      .then((r) => r.json())
      .then((d) => setPlayers(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const liveMap = new Map(livePlayers.map((p) => [p.uuid, p]))

  const merged = players.map((p) => {
    const live = liveMap.get(p.uuid)
    if (!live) return p
    return {
      ...p,
      username: live.username ?? p.username,
      status: live.status ?? p.status,
      color: live.color ?? p.color,
      avatar: live.avatar ?? p.avatar,
    }
  })

  const q = query.trim().toLowerCase()
  const filtered = merged.filter((p) => {
    if (onlineOnly && !p.is_online) return false
    if (!q) return true
    return (p.username ?? "").toLowerCase().includes(q) || p.uuid.toLowerCase().includes(q)
  })

  const onlineCount = merged.filter((p) => p.is_online).length

  return (
    <div>
      <div className="mb-6">
        <div className="kicker mb-2">Liste · {players.length} bekannt · {onlineCount} online</div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-display font-bold text-3xl" style={{ color: "var(--text-primary)" }}>Spieler</h1>
          {connection === "connected" && (
            <span className="badge-green"><span className="pulse-dot mr-1.5" />live</span>
          )}
        </div>
      </div>

      <div className="card mb-4 !p-4">
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm" style={{ color: "var(--text-muted)" }}>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name oder UUID suchen…"
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

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-16" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <div className="font-display text-4xl mb-3" style={{ color: "var(--text-muted)" }}>◎</div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {players.length === 0 ? "Noch keine Spieler" : "Kein Treffer — andere Suche probieren"}
          </p>
          <p className="text-xs mt-1 font-mono" style={{ color: "var(--text-muted)" }}>
            {players.length === 0 ? "Spieler erscheinen hier, sobald sie dem Server beitreten" : `${players.length} insgesamt bekannt`}
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b font-mono text-[11px] uppercase tracking-widest" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-primary)", color: "var(--text-muted)" }}>
                <th className="text-left px-5 py-3 font-medium">Spieler</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium hidden md:table-cell">UUID</th>
                <th className="text-left px-5 py-3 font-medium">Beigetreten</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className="border-b last:border-0 transition-colors cursor-pointer"
                  style={{ borderColor: "var(--border)", opacity: p.is_online ? 1 : 0.55 }}
                  onClick={() => window.location.href = `/dashboard/players/${p.uuid}`}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--bg-hover)"
                    e.currentTarget.style.opacity = "1"
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = ""
                    e.currentTarget.style.opacity = p.is_online ? "1" : "0.55"
                  }}
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <PlayerAvatar uuid={p.uuid} username={p.username} avatar={p.avatar} sizePx={24} />
                      <span
                        className="w-1.5 h-1.5 rounded-full inline-block"
                        style={p.is_online
                          ? { backgroundColor: "var(--accent)" }
                          : { backgroundColor: "var(--border)" }}
                        title={p.is_online ? "online" : "offline"}
                      />
                      <span className="font-medium" style={{ color: "var(--text-primary)" }}>{p.username ?? "—"}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    {p.status ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-primary)" }}>
                        {p.color && (
                          <span
                            className="w-2 h-2 rounded-full inline-block"
                            style={{ background: cssColor(p.color) }}
                          />
                        )}
                        <span style={{ color: "var(--text-secondary)" }}>{p.status}</span>
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 hidden md:table-cell">
                    <code className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{p.uuid.slice(0, 8)}...</code>
                  </td>
                  <td className="px-5 py-3.5 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
