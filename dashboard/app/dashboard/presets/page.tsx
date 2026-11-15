"use client"

import { useCallback, useEffect, useState } from "react"
import { apiFetch, getServerId } from "@/lib/client/auth"
import { cssColor } from "@/lib/color"

type Preset = {
  name: string
  status: string
  color: string
  updated_at?: string
}

const COLORS = [
  "reset", "white", "gray", "dark_gray", "black", "red", "dark_red",
  "gold", "yellow", "green", "dark_green", "aqua", "dark_aqua",
  "blue", "dark_blue", "light_purple", "dark_purple",
]

export default function PresetsPage() {
  const [presets, setPresets] = useState<Preset[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState("")
  const [status, setStatus] = useState("")
  const [color, setColor] = useState("reset")
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    const serverId = getServerId()
    if (!serverId) return
    try {
      const r = await apiFetch(`/api/presets/${serverId}`)
      if (r.ok) {
        const d = await r.json()
        setPresets(Array.isArray(d) ? d : [])
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const resetForm = () => {
    setName("")
    setStatus("")
    setColor("reset")
    setEditing(null)
    setError("")
  }

  const save = async () => {
    const serverId = getServerId()
    if (!serverId) return
    setSaving(true)
    setError("")
    setNotice("")
    try {
      const r = await apiFetch(`/api/presets/${serverId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), status: status.trim(), color }),
      })
      if (r.ok) {
        setNotice(editing ? `Preset „${name.trim()}“ aktualisiert.` : `Preset „${name.trim()}“ angelegt.`)
        resetForm()
        await load()
      } else {
        const d = await r.json().catch(() => ({}))
        setError(d.error ?? "Preset konnte nicht gespeichert werden")
      }
    } catch {
      setError("Netzwerkfehler")
    }
    setSaving(false)
  }

  const remove = async (presetName: string) => {
    if (!confirm(`Preset „${presetName}“ wirklich löschen?`)) return
    const serverId = getServerId()
    if (!serverId) return
    setError("")
    setNotice("")
    try {
      const r = await apiFetch(`/api/presets/${serverId}/${encodeURIComponent(presetName)}`, { method: "DELETE" })
      if (r.ok) {
        setNotice(`Preset „${presetName}“ gelöscht.`)
        if (editing === presetName) resetForm()
        await load()
      } else {
        const d = await r.json().catch(() => ({}))
        setError(d.error ?? "Preset konnte nicht gelöscht werden")
      }
    } catch {
      setError("Netzwerkfehler")
    }
  }

  const edit = (p: Preset) => {
    setEditing(p.name)
    setName(p.name)
    setStatus(p.status)
    setColor(p.color || "reset")
    setError("")
    setNotice("")
  }

  return (
    <div>
      <div className="mb-6">
        <div className="kicker mb-2">Konfiguration</div>
        <h1 className="font-display font-bold text-3xl" style={{ color: "var(--text-primary)" }}>Server-Presets</h1>
        <p className="text-sm mt-2 max-w-2xl" style={{ color: "var(--text-muted)" }}>
          Presets gelten für alle Spieler und erscheinen ingame in <span className="font-mono">/status</span>,
          <span className="font-mono"> /status preset list</span> und im Statusmenü. Spieler-eigene Presets haben Vorrang.
        </p>
      </div>

      <div className="card mb-4">
        <h2 className="font-display font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
          {editing ? `Preset „${editing}“ bearbeiten` : "Neues Preset"}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              placeholder="z. B. Bauen"
              className="input"
              disabled={editing != null}
            />
            {editing && <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Name ist beim Bearbeiten fix.</p>}
          </div>
          <div>
            <label className="label">Status-Text</label>
            <input
              type="text"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              maxLength={64}
              placeholder="z. B. Bauen"
              className="input"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="label">Farbe</label>
          <div className="flex flex-wrap items-center gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="w-7 h-7 rounded-lg border-2 transition-colors"
                style={{
                  backgroundColor: cssColor(c),
                  borderColor: color === c ? "var(--accent)" : "var(--border)",
                  boxShadow: color === c ? "0 0 0 2px var(--accent-soft)" : undefined,
                }}
                title={c}
              />
            ))}
            <input
              type="text"
              value={color.startsWith("#") ? color : ""}
              onChange={(e) => { const v = e.target.value; if (v.startsWith("#")) setColor(v) }}
              placeholder="#RRGGBB"
              className="w-24 rounded-lg px-2 py-1 text-xs font-mono"
              style={{ backgroundColor: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-5 flex-wrap">
          <button onClick={save} disabled={saving || !name.trim() || !status.trim()} className="btn-primary text-sm px-5 py-2">
            {saving ? "Speichert…" : editing ? "Änderungen speichern" : "Preset anlegen"}
          </button>
          {editing && (
            <button onClick={resetForm} className="btn-secondary text-sm px-4 py-2">Abbrechen</button>
          )}
          {error && <span className="text-xs" style={{ color: "var(--red)" }}>{error}</span>}
          {notice && <span className="text-xs" style={{ color: "var(--accent-text)" }}>{notice}</span>}
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-semibold" style={{ color: "var(--text-primary)" }}>Vorhandene Presets</h2>
          <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>{presets.length}</span>
        </div>

        {loading ? (
          <div className="space-y-2">
            <div className="skeleton h-12" />
            <div className="skeleton h-12" />
          </div>
        ) : presets.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Noch keine Server-Presets angelegt.</p>
        ) : (
          <div className="space-y-2">
            {presets.map((p) => (
              <div key={p.name} className="flex items-center gap-3 p-3 rounded-lg" style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-primary)" }}>
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: cssColor(p.color) }} />
                <div className="flex-1 min-w-0">
                  <div className="font-display font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{p.name}</div>
                  <div className="font-mono text-xs truncate" style={{ color: "var(--text-muted)" }}>
                    {p.status} · {p.color}
                    {p.updated_at ? ` · ${new Date(p.updated_at).toLocaleDateString("de-DE")}` : ""}
                  </div>
                </div>
                <button onClick={() => edit(p)} className="btn-secondary text-xs px-3 py-1.5">Bearbeiten</button>
                <button onClick={() => remove(p.name)} className="btn-danger text-xs px-3 py-1.5">Löschen</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
