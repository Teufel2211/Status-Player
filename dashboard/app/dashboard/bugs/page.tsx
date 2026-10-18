"use client"

import { useEffect, useState } from "react"
import { apiFetch, getServerId } from "@/lib/client/auth"

type BugReport = {
  id: number
  player: string
  text: string
  mod_version: string
  mc_version: string
  loader: string
  resolved: boolean
  created_at: string
  resolved_at: string | null
}

function ago(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime()
  if (Number.isNaN(ms) || ms < 0) return ""
  const min = Math.floor(ms / 60000)
  if (min < 1) return "gerade eben"
  if (min < 60) return `vor ${min} Min.`
  const h = Math.floor(min / 60)
  if (h < 24) return `vor ${h} Std.`
  const d = Math.floor(h / 24)
  if (d < 7) return `vor ${d} Tag${d === 1 ? "" : "en"}`
  return new Date(createdAt).toLocaleDateString()
}

export default function BugsPage() {
  const [reports, setReports] = useState<BugReport[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    const serverId = getServerId()
    if (!serverId) {
      setLoading(false)
      return
    }
    apiFetch(`/api/bug-reports/${serverId}`)
      .then((r) => r.json())
      .then((d) => setReports(Array.isArray(d?.reports) ? d.reports : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function toggleResolved(report: BugReport) {
    const serverId = getServerId()
    if (!serverId || busyId !== null) return
    setBusyId(report.id)
    try {
      const res = await apiFetch(`/api/bug-reports/${serverId}/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved: !report.resolved }),
      })
      if (res.ok) {
        const resolved = !report.resolved
        setReports((prev) =>
          prev.map((p) => (p.id === report.id ? { ...p, resolved, resolved_at: resolved ? new Date().toISOString() : null } : p))
        )
      }
    } catch {}
    setBusyId(null)
  }

  async function remove(report: BugReport) {
    const serverId = getServerId()
    if (!serverId || busyId !== null) return
    if (!window.confirm("Diese Bug-Meldung wirklich löschen?")) return
    setBusyId(report.id)
    try {
      const res = await apiFetch(`/api/bug-reports/${serverId}/${report.id}`, { method: "DELETE" })
      if (res.ok) setReports((prev) => prev.filter((p) => p.id !== report.id))
    } catch {}
    setBusyId(null)
  }

  const openCount = reports.filter((r) => !r.resolved).length

  return (
    <div>
      <div className="mb-8 fade-up">
        <div className="kicker mb-2">Posteingang</div>
        <h1 className="font-display font-bold text-3xl text-glow" style={{ color: "var(--text-primary)" }}>Bug-Meldungen</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Meldungen deiner Spieler aus dem /bug-Befehl — neueste zuerst
        </p>
      </div>

      {loading ? (
        <div className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>Loading...</div>
      ) : reports.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-3xl mb-3 opacity-30">✉</div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Keine Bug-Meldungen — alles ruhig</p>
          <p className="text-xs mt-1 font-mono" style={{ color: "var(--text-muted)" }}>Meldungen über /bug landen hier automatisch</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
            <span>{reports.length} Meldung{reports.length === 1 ? "" : "en"}</span>
            <span>·</span>
            <span style={openCount > 0 ? { color: "#f59e0b" } : undefined}>{openCount} offen</span>
          </div>
          {reports.map((report) => (
            <div key={report.id} className="card py-4 px-5 fade-up" style={{ opacity: report.resolved ? 0.65 : 1 }}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-medium" style={{ color: "var(--text-primary)" }}>{report.player}</span>
                  {report.resolved ? <span className="badge-green">erledigt</span> : <span className="badge-yellow">offen</span>}
                </div>
                <span className="text-[10px] font-mono shrink-0" style={{ color: "var(--text-muted)" }} title={new Date(report.created_at).toLocaleString()}>
                  {ago(report.created_at)}
                </span>
              </div>
              <p className="text-xs font-mono mt-2" style={{ color: "var(--text-muted)" }}>
                MC {report.mc_version || "?"} · Mod {report.mod_version || "?"} · {report.loader || "?"}
              </p>
              <p className="text-sm mt-2 break-words whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{report.text}</p>
              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={() => toggleResolved(report)}
                  disabled={busyId !== null}
                  className="btn-secondary !px-3.5 !py-1.5 text-xs"
                >
                  {report.resolved ? "Wieder öffnen" : "Erledigt"}
                </button>
                <button
                  onClick={() => remove(report)}
                  disabled={busyId !== null}
                  className="btn-secondary !px-3.5 !py-1.5 text-xs"
                  style={{ color: "#ef4444" }}
                >
                  Löschen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
