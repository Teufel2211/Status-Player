"use client"

import { useEffect, useState } from "react"
import { apiFetch, getServerId } from "@/lib/client/auth"
import { ago, describeAudit } from "@/lib/audit-format"

type AuditEntry = {
  id: number
  server_id: string
  who_uuid_hash: string | null
  action: string
  target_uuid_hash: string | null
  detail: string | null
  created_at: string
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const serverId = getServerId()
    if (!serverId) {
      setLoading(false)
      return
    }
    apiFetch(`/api/audit/${serverId}`)
      .then((r) => r.json())
      .then((d) => setLogs(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="mb-8">
        <div className="kicker mb-2">Verlauf</div>
        <h1 className="font-display font-bold text-3xl" style={{ color: "var(--text-primary)" }}>Aktivitäten</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Was auf deinem Server passiert ist — neueste zuerst</p>
      </div>

      {loading ? (
        <div className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>Lädt…</div>
      ) : logs.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-3xl mb-3" style={{ color: "var(--text-muted)" }}>◉</div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Noch nichts passiert — Aktionen erscheinen hier automatisch</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((entry) => (
            <div key={entry.id} className="card !py-3 !px-4 flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: "var(--text-muted)" }} />
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
