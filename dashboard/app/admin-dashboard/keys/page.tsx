"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/client/auth"

type AdminKey = {
  id: number
  server_id: string
  key_prefix: string
  scopes: string[]
  created_at: string
  expires_at: string | null
}

export default function AdminKeysPage() {
  const [keys, setKeys] = useState<AdminKey[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch("/api/admin/keys")
      .then((r) => (r.ok ? r.json() : { keys: [] }))
      .then((d) => setKeys(Array.isArray(d.keys) ? d.keys : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const now = Date.now()
  const active = keys.filter((k) => !k.expires_at || new Date(k.expires_at).getTime() > now)
  const expiringSoon = (k: AdminKey) => {
    if (!k.expires_at) return false
    const ms = new Date(k.expires_at).getTime() - now
    return ms > 0 && ms < 7 * 86400000
  }

  return (
    <div>
      <div className="mb-6">
        <div className="kicker mb-2">Admin-Dashboard · {active.length} aktiv</div>
        <h1 className="font-display font-bold text-3xl" style={{ color: "var(--text-primary)" }}>API-Keys</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Alle aktiven Zugangsschlüssel aller Server — abgelaufene und widerrufene sind ausgeblendet.</p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-14" />)}
        </div>
      ) : active.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-3xl mb-3" style={{ color: "var(--text-muted)" }}>⌨</div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Keine aktiven API-Keys</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Keys entstehen automatisch beim Server-Setup.</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b font-mono text-[11px] uppercase tracking-widest" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-primary)", color: "var(--text-muted)" }}>
                <th className="text-left px-5 py-3 font-medium">Server</th>
                <th className="text-left px-5 py-3 font-medium">Key</th>
                <th className="text-left px-5 py-3 font-medium hidden sm:table-cell">Scopes</th>
                <th className="text-left px-5 py-3 font-medium hidden md:table-cell">Erstellt</th>
                <th className="text-left px-5 py-3 font-medium">Läuft ab</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {active.map((k) => (
                <tr
                  key={k.id}
                  className="border-b last:border-0 transition-colors"
                  style={{ borderColor: "var(--border)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-hover)" }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "" }}
                >
                  <td className="px-5 py-3.5">
                    <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>{k.server_id.slice(0, 8)}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <code className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>{k.key_prefix}…</code>
                  </td>
                  <td className="px-5 py-3.5 hidden sm:table-cell">
                    <div className="flex gap-1 flex-wrap">
                      {k.scopes.map((s) => (
                        <span key={s} className="badge-neutral text-[10px]">{s}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-xs hidden md:table-cell" style={{ color: "var(--text-muted)" }}>
                    {new Date(k.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3.5 text-xs font-mono" style={{ color: expiringSoon(k) ? "var(--amber)" : "var(--text-muted)" }}>
                    {k.expires_at ? new Date(k.expires_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-5 py-3.5">
                    {expiringSoon(k)
                      ? <span className="badge-yellow">bald ab</span>
                      : <span className="badge-green">aktiv</span>}
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
