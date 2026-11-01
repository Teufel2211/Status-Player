"use client"

import { useEffect, useState } from "react"
import { apiFetch, getAccessToken, getServerId } from "@/lib/client/auth"

type SyncCodeStatus = {
  configured: boolean
  pending: boolean
  confirmed: boolean
  created_at: string | null
  confirmed_at: string | null
  reset_at: string | null
}

function readRole(): string | null {
  const token = getAccessToken()
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split(".")[1])) as Record<string, unknown>
    return typeof payload.role === "string" ? (payload.role as string) : null
  } catch {
    return null
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString()
}

export default function SyncPage() {
  const [serverId, setServerId] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [status, setStatus] = useState<SyncCodeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [newCode, setNewCode] = useState("")
  const [copied, setCopied] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    setServerId(getServerId())
    setIsOwner(readRole() === "owner")
  }, [])

  useEffect(() => {
    if (serverId) loadStatus()
  }, [serverId])

  async function loadStatus() {
    if (!serverId) return
    const res = await apiFetch(`/api/server/${serverId}/sync-code`)
    if (res.ok) {
      setStatus((await res.json()) as SyncCodeStatus)
    } else {
      setError("Status konnte nicht geladen werden.")
    }
    setLoading(false)
  }

  async function generateCode() {
    if (!serverId || busy) return
    setBusy(true)
    setError("")
    setCopied(false)
    const res = await apiFetch(`/api/server/${serverId}/sync-code`, { method: "POST" })
    const data = await res.json().catch(() => ({}))
    if (res.ok && typeof data.code === "string") {
      setNewCode(data.code)
      await loadStatus()
    } else {
      setError(typeof data.error === "string" ? data.error : "Code konnte nicht erzeugt werden.")
    }
    setBusy(false)
  }

  async function resetSync() {
    if (!serverId || busy) return
    setBusy(true)
    setError("")
    setNewCode("")
    const res = await apiFetch(`/api/server/${serverId}/sync-code`, { method: "DELETE" })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setConfirmReset(false)
      await loadStatus()
    } else {
      setError(typeof data.error === "string" ? data.error : "Zurücksetzen fehlgeschlagen.")
    }
    setBusy(false)
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(newCode)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const stateLabel = !status
    ? null
    : status.pending
      ? { text: "Neuer Code wartet auf Bestätigung", badge: "badge-yellow" }
      : status.configured
        ? { text: "Bestätigt", badge: "badge-green" }
        : status.reset_at
          ? { text: "Zurückgesetzt", badge: "badge-red" }
          : { text: "Noch nicht bestätigt", badge: "badge-neutral" }

  return (
    <div>
      <div className="mb-8">
        <div className="kicker mb-2">Synchronisation · Bestätigungscode</div>
        <h1 className="font-display font-bold text-3xl" style={{ color: "var(--text-primary)" }}>Sync</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Nur ein Server mit bestätigtem Code darf Spielerdaten mit diesem Dashboard austauschen.
        </p>
      </div>

      {error && (
        <div className="card mb-6" style={{ borderColor: "var(--red-line)", backgroundColor: "var(--red-soft)" }}>
          <div className="text-sm" style={{ color: "var(--red)" }}>{error}</div>
        </div>
      )}

      {newCode && (
        <div className="card mb-6" style={{ borderColor: "var(--accent-line)", backgroundColor: "var(--accent-soft)" }}>
          <div className="text-sm font-medium mb-2" style={{ color: "var(--accent-text)" }}>
            Neuer Code — jetzt im Spiel bestätigen
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <code className="text-lg rounded-lg px-4 py-3 font-mono tracking-widest" style={{ backgroundColor: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
              {newCode}
            </code>
            <button className="btn-primary text-xs px-4 py-2" onClick={copyCode}>
              {copied ? "Kopiert" : "Kopieren"}
            </button>
          </div>
          <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>
            Im Spiel als Operator eingeben: <code className="font-mono" style={{ color: "var(--text-secondary)" }}>/status sync confirm {newCode}</code>
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Der Code wird nur einmal angezeigt. Bis zur Bestätigung bleibt der bisherige Code gültig — der Sync läuft ohne Unterbrechung weiter.
          </p>
        </div>
      )}

      <div className="card mb-6">
        <div className="kicker mb-4">Status</div>
        {loading ? (
          <div className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>Lädt…</div>
        ) : !status ? (
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>Keine Daten verfügbar.</div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Zustand</span>
              {stateLabel && <span className={stateLabel.badge}>{stateLabel.text}</span>}
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Code erzeugt</span>
              <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{formatDate(status.created_at)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Zuletzt bestätigt</span>
              <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{formatDate(status.confirmed_at)}</span>
            </div>
            {status.reset_at && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Zuletzt zurückgesetzt</span>
                <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{formatDate(status.reset_at)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card mb-6">
        <div className="kicker mb-3">So funktioniert es</div>
        <ol className="text-sm space-y-2 list-decimal list-inside" style={{ color: "var(--text-secondary)" }}>
          <li>Hier einen Code erzeugen und kopieren.</li>
          <li>Im Spiel <code className="font-mono" style={{ color: "var(--text-primary)" }}>/status sync confirm &lt;Code&gt;</code> als Operator ausführen.</li>
          <li>Der Mod bestätigt den Code beim nächsten Sync-Zyklus automatisch.</li>
        </ol>
        <p className="text-xs mt-4" style={{ color: "var(--text-muted)" }}>
          Wird der Code zurückgesetzt, verliert jede Kopie des Mods sofort den Zugang. Bereits laufende Syncs werden mit 403 abgewiesen, bis ein neuer Code bestätigt ist.
        </p>
      </div>

      {isOwner ? (
        <div className="flex items-center gap-3 flex-wrap">
          <button className="btn-primary text-xs px-4 py-2" onClick={generateCode} disabled={busy}>
            Neuen Code erzeugen
          </button>
          {confirmReset ? (
            <>
              <button className="btn-danger text-xs px-4 py-2" onClick={resetSync} disabled={busy}>
                Wirklich zurücksetzen
              </button>
              <button
                className="text-xs transition-opacity hover:opacity-80"
                style={{ color: "var(--text-muted)" }}
                onClick={() => setConfirmReset(false)}
                disabled={busy}
              >
                Abbrechen
              </button>
            </>
          ) : (
            <button
              className="text-xs transition-opacity hover:opacity-80"
              style={{ color: "var(--red)" }}
              onClick={() => setConfirmReset(true)}
              disabled={busy}
            >
              Sync zurücksetzen
            </button>
          )}
        </div>
      ) : (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Nur der Owner dieses Servers kann Codes erzeugen oder zurücksetzen.
        </p>
      )}
    </div>
  )
}
