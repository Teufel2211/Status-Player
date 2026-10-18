"use client"

import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/client/auth"
import { ago } from "@/lib/audit-format"

type BugReport = {
  id: number
  server_id: string
  player: string
  text: string
  mod_version: string
  mc_version: string
  loader: string
  resolved: boolean
  created_at: string
  resolved_at: string | null
}

type Filter = "open" | "all" | "done"

export default function AdminBugsPage() {
  const [reports, setReports] = useState<BugReport[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>("open")
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    apiFetch("/api/bug-reports")
      .then((r) => (r.ok ? r.json() : { reports: [] }))
      .then((d) => setReports(Array.isArray(d.reports) ? d.reports : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const counts = useMemo(() => ({
    open: reports.filter((r) => !r.resolved).length,
    done: reports.filter((r) => r.resolved).length,
    all: reports.length,
  }), [reports])

  const filtered = reports.filter((r) =>
    filter === "all" ? true : filter === "open" ? !r.resolved : r.resolved
  )

  async function setResolved(r: BugReport, resolved: boolean) {
    setBusyId(r.id)
    try {
      const res = await apiFetch(`/api/bug-reports/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved }),
      })
      if (res.ok) {
        setReports((prev) => prev.map((x) =>
          x.id === r.id ? { ...x, resolved, resolved_at: resolved ? new Date().toISOString() : null } : x
        ))
      }
    } catch {}
    setBusyId(null)
  }

  async function remove(r: BugReport) {
    if (!confirm("Diese Bug-Meldung wirklich löschen?")) return
    setBusyId(r.id)
    try {
      const res = await apiFetch(`/api/bug-reports/${r.id}`, { method: "DELETE" })
      if (res.ok) setReports((prev) => prev.filter((x) => x.id !== r.id))
    } catch {}
    setBusyId(null)
  }

  const chips: { key: Filter; label: string; count: number }[] = [
    { key: "open", label: "Offen", count: counts.open },
    { key: "all", label: "Alle", count: counts.all },
    { key: "done", label: "Erledigt", count: counts.done },
  ]

  return (
    <div>
      <div className="mb-6">
        <div className="kicker mb-2">Admin-Dashboard · {counts.open} offen · {counts.all} gesamt</div>
        <h1 className="font-display font-bold text-3xl" style={{ color: "var(--text-primary)" }}>Bug-Meldungen</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Meldungen aus dem /bug-Befehl — nur für den Owner sichtbar.</p>
      </div>

      <div className="card mb-4 !p-4">
        <div className="flex gap-2 flex-wrap">
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className="font-mono text-xs px-4 py-2 rounded-lg border transition-colors"
              style={filter === c.key ? {
                borderColor: "var(--accent-line)",
                backgroundColor: "var(--accent-soft)",
                color: "var(--accent-text)",
              } : {
                borderColor: "var(--border)",
                backgroundColor: "var(--bg-input)",
                color: "var(--text-muted)",
              }}
            >
              {c.label} · {c.count}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => <div key={i} className="skeleton h-32" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-3xl mb-3" style={{ color: "var(--text-muted)" }}>✓</div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {filter === "open" && "Keine offenen Meldungen — alles ruhig"}
            {filter === "done" && "Keine erledigten Meldungen"}
            {filter === "all" && "Keine Bug-Meldungen — alles ruhig"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <div key={r.id} className="card" style={{ opacity: r.resolved ? 0.6 : 1 }}>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="font-display font-semibold" style={{ color: "var(--text-primary)" }}>{r.player}</span>
                <span className="badge-neutral text-[10px]">{r.server_id.slice(0, 8)}</span>
                {r.resolved ? <span className="badge-green">erledigt</span> : <span className="badge-yellow">offen</span>}
                <span className="text-[11px] font-mono ml-auto" style={{ color: "var(--text-muted)" }} title={new Date(r.created_at).toLocaleString()}>
                  {ago(r.created_at)}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap mb-3" style={{ color: "var(--text-primary)" }}>{r.text}</p>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
                  MC {r.mc_version} · Mod {r.mod_version} · {r.loader}
                </span>
                <div className="ml-auto flex items-center gap-4">
                  <button
                    onClick={() => setResolved(r, !r.resolved)}
                    disabled={busyId === r.id}
                    className="text-xs transition-opacity hover:opacity-80 disabled:opacity-40"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {r.resolved ? "Wieder öffnen" : "Erledigt"}
                  </button>
                  <button
                    onClick={() => remove(r)}
                    disabled={busyId === r.id}
                    className="text-xs transition-opacity hover:opacity-80 disabled:opacity-40"
                    style={{ color: "var(--red)" }}
                  >
                    Löschen
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
