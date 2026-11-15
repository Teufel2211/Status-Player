"use client"

import { useCallback, useEffect, useState } from "react"
import { apiFetch, getServerId } from "@/lib/client/auth"

type Settings = {
  warn_default_days: number
  warn_auto_mute_suggestion: boolean
}

export default function ModerationSettingsPage() {
  const [settings, setSettings] = useState<Settings>({ warn_default_days: 14, warn_auto_mute_suggestion: false })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    const serverId = getServerId()
    if (!serverId) return
    try {
      const r = await apiFetch(`/api/server/${serverId}/moderation`)
      if (r.ok) setSettings(await r.json())
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    const serverId = getServerId()
    if (!serverId) return
    setSaving(true)
    setError("")
    setSaved(false)
    try {
      const r = await apiFetch(`/api/server/${serverId}/moderation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      })
      if (r.ok) {
        setSettings(await r.json())
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        const d = await r.json().catch(() => ({}))
        setError(d.error ?? "Einstellungen konnten nicht gespeichert werden")
      }
    } catch {
      setError("Netzwerkfehler")
    }
    setSaving(false)
  }

  if (loading) return (
    <div className="space-y-3">
      <div className="skeleton h-24" />
      <div className="skeleton h-40" />
    </div>
  )

  return (
    <div>
      <div className="mb-6">
        <div className="kicker mb-2">Konfiguration</div>
        <h1 className="font-display font-bold text-3xl" style={{ color: "var(--text-primary)" }}>Moderation</h1>
        <p className="text-sm mt-2 max-w-2xl" style={{ color: "var(--text-muted)" }}>
          Warnungen laufen automatisch ab. Nur aktive Warnungen zählen für das Badge ingame.
          Ein Mute wird nie automatisch gesetzt — der Vorschlag muss bestätigt werden.
        </p>
      </div>

      <div className="card max-w-2xl">
        <div className="space-y-5">
          <div>
            <label className="label">Standard-Gültigkeit neuer Warnungen (Tage)</label>
            <input
              type="number"
              min={1}
              max={365}
              value={settings.warn_default_days}
              onChange={(e) => setSettings((s) => ({ ...s, warn_default_days: Math.max(1, Math.min(365, Number(e.target.value) || 1)) }))}
              className="input max-w-[160px]"
            />
            <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
              Gilt, wenn beim Anlegen einer Warnung keine eigene Dauer angegeben wird. Standard: 14 Tage.
            </p>
          </div>

          <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer" style={{ border: "1px solid var(--border)", backgroundColor: "var(--bg-primary)" }}>
            <input
              type="checkbox"
              checked={settings.warn_auto_mute_suggestion}
              onChange={(e) => setSettings((s) => ({ ...s, warn_auto_mute_suggestion: e.target.checked }))}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium" style={{ color: "var(--text-primary)" }}>Mute-Vorschlag ab 3 aktiven Warnungen</span>
              <span className="block text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                Zeigt im Spieler-Profil einen Vorschlag (60 Minuten). Der Mute wird erst durch einen Klick angewendet.
              </span>
            </span>
          </label>

          <div className="flex items-center gap-3 flex-wrap pt-1">
            <button onClick={save} disabled={saving} className="btn-primary text-sm px-5 py-2">
              {saving ? "Speichert…" : "Einstellungen speichern"}
            </button>
            {saved && <span className="text-xs" style={{ color: "var(--accent-text)" }}>Gespeichert.</span>}
            {error && <span className="text-xs" style={{ color: "var(--red)" }}>{error}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
