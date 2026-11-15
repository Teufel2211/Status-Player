"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/client/auth"

type ApiKey = {
  id: number
  key_prefix: string
  scopes: string[]
  created_at: string
  expires_at: string
  revoked: boolean
}

export default function KeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [newKey, setNewKey] = useState("")

  useEffect(() => {
    loadKeys()
  }, [])

  async function loadKeys() {
    const res = await apiFetch("/api/keys")
    const d = await res.json()
    setKeys(Array.isArray(d) ? d : [])
    setLoading(false)
  }

  async function createKey() {
    const res = await apiFetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopes: ["check"] }),
    })

    if (res.ok) {
      const d = await res.json()
      setNewKey(d.api_key)
      loadKeys()
    }
  }

  async function revokeKey(id: number) {
    await apiFetch(`/api/keys/${id}`, {
      method: "DELETE",
    })
    loadKeys()
  }

  return (
    <div>
      <div className="mb-8">
        <div className="kicker mb-2">Zugangsschlüssel · max. 2 aktiv</div>
        <h1 className="font-display font-bold text-3xl" style={{ color: "var(--text-primary)" }}>API-Keys</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Verwalte den API-Zugang für deinen Mod.</p>
      </div>

      {newKey && (
        <div className="card mb-6" style={{ borderColor: "var(--accent-line)", backgroundColor: "var(--accent-soft)" }}>
          <div className="text-sm font-medium mb-2" style={{ color: "var(--accent-text)" }}>Key erstellt — jetzt kopieren!</div>
          <code className="block text-xs rounded-lg px-4 py-3 font-mono break-all" style={{ backgroundColor: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
            {newKey}
          </code>
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>Dieser Key wird nur einmal angezeigt.</p>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{keys.filter((k) => !k.revoked).length}/2 aktiv</span>
        </div>
        <button
          className="btn-primary text-xs px-4 py-2"
          onClick={createKey}
          disabled={keys.filter((k) => !k.revoked).length >= 2}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Neuer Key
        </button>
      </div>

      {loading ? (
        <div className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>Lädt…</div>
      ) : keys.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-3xl mb-3" style={{ color: "var(--text-muted)" }}>⌨</div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Noch keine API-Keys</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Erzeuge einen Key, damit sich dein Mod verbinden kann.</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b font-mono text-[11px] uppercase tracking-widest" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-primary)", color: "var(--text-muted)" }}>
                <th className="text-left px-5 py-3 font-medium">Key</th>
                <th className="text-left px-5 py-3 font-medium">Scopes</th>
                <th className="text-left px-5 py-3 font-medium">Erstellt</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-right px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b last:border-0 transition-colors" style={{ borderColor: "var(--border)", opacity: k.revoked ? 0.55 : 1 }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-hover)"; e.currentTarget.style.opacity = "1" }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; e.currentTarget.style.opacity = k.revoked ? "0.55" : "1" }}
                >
                  <td className="px-5 py-3.5">
                    <code className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>{k.key_prefix}...</code>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex gap-1 flex-wrap">
                      {k.scopes.map((s) => (
                        <span key={s} className="badge-neutral text-[10px]">
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    {new Date(k.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={k.revoked ? "badge-red" : "badge-green"}>
                      {k.revoked ? "Widerrufen" : "Aktiv"}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {!k.revoked && (
                      <button
                        className="text-xs transition-opacity hover:opacity-80"
                        style={{ color: "var(--red)" }}
                        onClick={() => revokeKey(k.id)}
                      >
                        Widerrufen
                      </button>
                    )}
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
