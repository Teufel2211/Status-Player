"use client"

import { useEffect, useState } from "react"
import { apiFetch, getRole, getServerId } from "@/lib/client/auth"
import { useRealtimePlayers } from "@/lib/client/use-realtime"
import { PlayerAvatar } from "@/components/player-avatar"

type HealthData = {
  status: string
  database: string
  timestamp: string
}

type BuildData = {
  attest_build_id: string | null
  attest_key_id: string | null
  attest_verified_at: string | null
  allow_dev_builds: boolean
}

export default function DashboardOverview() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [knownCount, setKnownCount] = useState<number | null>(null)
  const [build, setBuild] = useState<BuildData | null>(null)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [savingBuild, setSavingBuild] = useState(false)
  const { players: livePlayers, connection } = useRealtimePlayers()
  const role = typeof window === "undefined" ? null : getRole()

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
      apiFetch(`/api/server/${sid}/build`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d) setBuild(d); else setBuildError("Build-Status nicht verfügbar.") })
        .catch(() => setBuildError("Build-Status nicht verfügbar."))
    }
  }, [])

  async function toggleDevBuilds(next: boolean) {
    const sid = getServerId()
    if (!sid) return
    setSavingBuild(true)
    setBuildError(null)
    try {
      const res = await apiFetch(`/api/server/${sid}/build`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allow_dev_builds: next }),
      })
      if (!res.ok) {
        setBuildError(res.status === 403 ? "Nur der Owner kann Dev-Builds freigeben." : "Speichern fehlgeschlagen.")
        return
      }
      const data = await res.json()
      setBuild((prev) => (prev ? { ...prev, allow_dev_builds: data.allow_dev_builds === true } : prev))
    } catch {
      setBuildError("Speichern fehlgeschlagen.")
    } finally {
      setSavingBuild(false)
    }
  }

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

      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <div className="kicker mb-1">Mod-Build</div>
            <h2 className="font-display font-semibold" style={{ color: "var(--text-primary)" }}>Echtheit des laufenden Builds</h2>
          </div>
          {build?.attest_build_id ? <span className="badge-green">signiert</span> : <span className="badge-neutral">unsigniert</span>}
        </div>
        {build === null ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {buildError ?? "Lade Build-Status…"}
          </p>
        ) : (
          <>
            <div className="font-mono text-sm break-all" style={{ color: "var(--text-primary)" }}>
              {build.attest_build_id ?? "Kein verifizierter Build — der Server läuft mit einem Dev-Build oder hat sich noch nicht gemeldet."}
            </div>
            <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
              {build.attest_verified_at
                ? `Verifiziert am ${new Date(build.attest_verified_at).toLocaleString("de-DE")} · Schlüssel ${build.attest_key_id ?? "—"}`
                : "Noch keine Signatur geprüft."}
            </p>
            <label className="flex items-start gap-3 mt-4" style={{ cursor: role === "owner" && !savingBuild ? "pointer" : "default" }}>
              <input
                type="checkbox"
                className="mt-1"
                checked={build.allow_dev_builds}
                disabled={role !== "owner" || savingBuild}
                onChange={(e) => toggleDevBuilds(e.target.checked)}
              />
              <span>
                <span className="text-sm font-medium block" style={{ color: "var(--text-primary)" }}>Dev-Builds erlauben</span>
                <span className="text-xs block" style={{ color: "var(--text-muted)" }}>
                  Nur für Testserver: Sync auch ohne signiertes Build-Manifest zulassen.
                </span>
              </span>
            </label>
            {role !== "owner" && (
              <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>Nur der Owner kann das ändern.</p>
            )}
            {buildError && <p className="text-xs mt-2" style={{ color: "var(--red)" }}>{buildError}</p>}
          </>
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
