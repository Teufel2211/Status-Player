"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
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
  image_count: number
}

type BugImage = {
  id: number
  url: string | null
  mime: string
  size_bytes: number
  created_at: string
}

type ImageState = { loading: boolean; items: BugImage[]; error?: string }

type Filter = "open" | "all" | "done"

export default function AdminBugsPage() {
  const [reports, setReports] = useState<BugReport[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>("open")
  const [busyId, setBusyId] = useState<number | null>(null)
  const [openImages, setOpenImages] = useState<number | null>(null)
  const [images, setImages] = useState<Record<number, ImageState>>({})
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    apiFetch("/api/bug-reports")
      .then((r) => (r.ok ? r.json() : { reports: [] }))
      .then((d) => setReports(Array.isArray(d.reports) ? d.reports : []))
      .catch(() => setError("Meldungen konnten nicht geladen werden."))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

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
    setError(null)
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
      } else if (res.status === 404) {
        setReports((prev) => prev.filter((x) => x.id !== r.id))
        setError("Diese Meldung existierte nicht mehr und wurde aus der Liste entfernt.")
      } else {
        setError("Speichern fehlgeschlagen. Bitte Seite neu laden.")
      }
    } catch {
      setError("Speichern fehlgeschlagen. Bitte Seite neu laden.")
    }
    setBusyId(null)
  }

  async function remove(r: BugReport) {
    if (!confirm("Diese Bug-Meldung inklusive aller Bilder wirklich löschen?")) return
    setBusyId(r.id)
    setError(null)
    try {
      const res = await apiFetch(`/api/bug-reports/${r.id}`, { method: "DELETE" })
      if (res.ok || res.status === 404) {
        setReports((prev) => prev.filter((x) => x.id !== r.id))
      } else {
        setError("Löschen fehlgeschlagen. Bitte Seite neu laden.")
      }
    } catch {
      setError("Löschen fehlgeschlagen. Bitte Seite neu laden.")
    }
    setBusyId(null)
  }

  async function toggleImages(r: BugReport) {
    if (openImages === r.id) {
      setOpenImages(null)
      return
    }
    setOpenImages(r.id)
    if (images[r.id]?.items.length) return

    setImages((prev) => ({ ...prev, [r.id]: { loading: true, items: [] } }))
    try {
      const res = await apiFetch(`/api/bug-reports/${r.id}/images`)
      const data = res.ok ? await res.json() : null
      setImages((prev) => ({
        ...prev,
        [r.id]: {
          loading: false,
          items: Array.isArray(data?.images) ? data.images : [],
          error: res.ok ? undefined : "Bilder konnten nicht geladen werden.",
        },
      }))
    } catch {
      setImages((prev) => ({ ...prev, [r.id]: { loading: false, items: [], error: "Bilder konnten nicht geladen werden." } }))
    }
  }

  const chips: { key: Filter; label: string; count: number }[] = [
    { key: "open", label: "Offen", count: counts.open },
    { key: "all", label: "Alle", count: counts.all },
    { key: "done", label: "Erledigt", count: counts.done },
  ]

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="kicker mb-2">Admin-Dashboard · {counts.open} offen · {counts.all} gesamt</div>
            <h1 className="font-display font-bold text-3xl" style={{ color: "var(--text-primary)" }}>Bug-Meldungen</h1>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Meldungen aus dem /bug-Befehl — nur für den Owner sichtbar.</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="font-mono text-xs px-4 py-2 rounded-lg border transition-colors disabled:opacity-40"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-input)", color: "var(--text-muted)" }}
          >
            ↻ Aktualisieren
          </button>
        </div>
      </div>

      {error && (
        <div className="card mb-4 !p-4" style={{ borderColor: "var(--red)" }}>
          <p className="text-xs" style={{ color: "var(--red)" }}>{error}</p>
        </div>
      )}

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
              {r.image_count > 0 && (
                <div className="mb-3">
                  <button
                    onClick={() => { void toggleImages(r) }}
                    className="badge-neutral text-[11px] hover:opacity-80"
                  >
                    📎 {r.image_count} {r.image_count === 1 ? "Bild" : "Bilder"} {openImages === r.id ? "ausblenden" : "anzeigen"}
                  </button>
                  {openImages === r.id && (
                    <div className="mt-3">
                      {images[r.id]?.loading ? (
                        <div className="skeleton h-24 w-36" />
                      ) : images[r.id]?.error ? (
                        <p className="text-xs" style={{ color: "var(--red)" }}>{images[r.id].error}</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {(images[r.id]?.items ?? []).map((img) => (
                            img.url ? (
                              <a
                                key={img.id}
                                href={img.url}
                                target="_blank"
                                rel="noreferrer"
                                title={`${img.mime} · ${Math.max(1, Math.round(img.size_bytes / 1024))} KB`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={img.url}
                                  alt={`Screenshot ${img.id}`}
                                  className="h-24 w-36 object-cover rounded-lg border transition-opacity hover:opacity-90"
                                  style={{ borderColor: "var(--border)" }}
                                />
                              </a>
                            ) : (
                              <div
                                key={img.id}
                                className="h-24 w-36 rounded-lg border flex items-center justify-center text-[10px] font-mono"
                                style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                              >
                                nicht verfügbar
                              </div>
                            )
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
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
