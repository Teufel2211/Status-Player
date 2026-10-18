"use client"

import { useEffect, useState } from "react"
import { apiFetch, getServerId } from "@/lib/client/auth"
import { useRealtimePlayers } from "@/lib/client/use-realtime"
import { PlayerAvatar } from "@/components/player-avatar"

type HealthData = {
  status: string
  database: string
  timestamp: string
}

export default function DashboardOverview() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [knownCount, setKnownCount] = useState<number | null>(null)
  const { players: livePlayers, connection } = useRealtimePlayers()

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setHealth(d))
      .catch(() => {})
    const sid = getServerId()
    if (sid) {
      apiFetch(`/api/players/${sid}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setKnownCount(Array.isArray(d) ? d.length : null))
        .catch(() => {})
    }
  }, [])

  const live = connection === "connected"

  return (
    <div>
      <div className="card mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="kicker mb-2">Übersicht · Live-Feed</div>
            <h1 className="font-display font-bold text-3xl sm:text-4xl" style={{ color: "var(--text-primary)" }}>
              {livePlayers.length > 0 ? (
                <>{livePlayers.length} online</>
              ) : (
                <>Alles ruhig</>
              )}
            </h1>
            <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>
              {knownCount !== null ? `${knownCount} bekannte Spieler` : "Lade Spielerliste…"}
              {" · "}{health?.status === "healthy" ? "Systeme in Ordnung" : "Systeme werden geprüft…"}
            </p>
          </div>
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-mono text-xs"
            style={{
              border: `1px solid ${live ? "var(--accent-line)" : "var(--border)"}`,
              backgroundColor: live ? "var(--accent-soft)" : "var(--bg-hover)",
              color: live ? "var(--accent-text)" : "var(--text-muted)",
            }}
          >
            <span className="pulse-dot" />
            {live ? "LIVE" : connection === "connecting" ? "VERBINDET…" : "OFFLINE"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Server", value: health?.status === "healthy" ? "Online" : (health?.status ?? "—"), ok: health?.status === "healthy" },
          { label: "Datenbank", value: health?.database === "connected" ? "Verbunden" : (health?.database ?? "—"), ok: health?.database === "connected" },
          { label: "Bekannte Spieler", value: knownCount !== null ? String(knownCount) : "—", ok: null },
          { label: "Echtzeit", value: live ? "Live" : connection === "connecting" ? "…" : "Aus", ok: live ? true : connection === "connecting" ? null : false },
        ].map((s) => (
          <div key={s.label} className="card !p-5">
            <div className="kicker mb-2" style={{ fontSize: "10px" }}>{s.label}</div>
            <div className="flex items-center gap-2">
              <span className="stat-num">{s.value}</span>
              {s.ok === true && <span className="badge-green">OK</span>}
              {s.ok === false && <span className="badge-red">!</span>}
              {s.ok === null && s.label === "Echtzeit" && <span className="badge-yellow">…</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="pulse-dot" />
            <h2 className="font-display font-semibold" style={{ color: "var(--text-primary)" }}>Spieler online</h2>
          </div>
          <a href="/dashboard/players" className="font-mono text-xs underline underline-offset-2" style={{ color: "var(--text-muted)" }}>
            zur Liste →
          </a>
        </div>
        {livePlayers.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Gerade ist niemand online — der Feed springt an, sobald jemand beitritt.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {livePlayers.map((p) => (
              <a
                key={p.uuid}
                href={`/dashboard/players/${p.uuid}`}
                className="flex items-center gap-2 px-3 py-2 rounded-xl transition-colors text-sm"
                style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-primary)" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent-line)" }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)" }}
              >
                <PlayerAvatar uuid={p.uuid} username={p.username} avatar={p.avatar} sizePx={20} />
                <span className="font-medium" style={{ color: "var(--text-primary)" }}>{p.username ?? "Unbekannt"}</span>
                {p.status && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: "var(--accent-soft)", color: "var(--accent-text)" }}>{p.status}</span>
                )}
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="kicker mb-3">Schnellzugriff</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { href: "/dashboard/players", label: "Spieler", icon: "◎", hint: "Liste" },
            { href: "/dashboard/keys", label: "API-Keys", icon: "⌨", hint: "Zugriff" },
            { href: "/dashboard/audit", label: "Verlauf", icon: "◉", hint: "Chronik" },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-xl px-3 py-3.5 transition-colors"
              style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-primary)" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent-line)" }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)" }}
            >
              <div className="font-display text-xl mb-1" style={{ color: "var(--text-secondary)" }}>{link.icon}</div>
              <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{link.label}</div>
              <div className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>{link.hint}</div>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
