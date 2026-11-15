"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/client/auth"
import { ago, describeAudit } from "@/lib/audit-format"

type AuditEntry = {
  id: number
  server_id: string
  action: string
  detail: string | null
  created_at: string
}

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch("/api/admin/audit")
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((d) => setEntries(Array.isArray(d.entries) ? d.entries : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="mb-8">
        <div className="kicker mb-2">Admin-Dashboard · letzte {entries.length} Einträge</div>
        <h1 className="font-display font-bold text-3xl" style={{ color: "var(--text-primary)" }}>Verlauf</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Wer wann und wo etwas geändert hat — neueste zuerst</p>
      </div>

      {loading ? (
        <div className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>Lädt…</div>
      ) : entries.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-3xl mb-3" style={{ color: "var(--text-muted)" }}>◉</div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Noch nichts passiert — Aktionen erscheinen hier automatisch</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.id} className="card !py-3 !px-4 flex items-center gap-3">
              <span className="badge-neutral text-[10px] shrink-0 hidden sm:inline-flex">{entry.server_id.slice(0, 8)}</span>
              <p className="text-sm flex-1 min-w-0" style={{ color: "var(--text-primary)" }}>{describeAudit(entry)}</p>
              <span className="text-[10px] font-mono shrink-0" style={{ color: "var(--text-muted)" }} title={new Date(entry.created_at).toLocaleString()}>
                {ago(entry.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
