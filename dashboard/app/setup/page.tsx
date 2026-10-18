"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Footer from "@/components/footer"
import { setAccessToken } from "@/lib/client/auth"

type SetupResult = {
  access_token: string
  api_key?: string
  key_prefix?: string
  server_id: string
}

const steps = [
  { n: "01", text: "Der Server holt den API-Key automatisch (≤ 30 s) — kein config.json-Eintrag nötig." },
  { n: "02", text: "Fallback: Key oben in config/statusmod/config.json eintragen." },
  { n: "03", text: "Im Spiel funktioniert /code sofort — kein Neustart nötig." },
]

export default function SetupPage() {
  const router = useRouter()
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SetupResult | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })

      if (!res.ok) {
        setError("Ungültiger oder abgelaufener Setup-Code")
        return
      }

      const data: SetupResult = await res.json()
      setResult(data)
      setAccessToken(data.access_token)
    } catch {
      setError("Verbindung fehlgeschlagen — bitte erneut versuchen.")
    } finally {
      setLoading(false)
    }
  }

  async function copyKey() {
    if (!result?.api_key) return
    try {
      await navigator.clipboard.writeText(result.api_key)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  function goToDashboard() {
    router.push("/dashboard")
  }

  if (result) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ backgroundColor: "var(--bg-primary)" }}>
        <div className="w-full max-w-lg">
          <div className="card sm:p-8">
            <div className="flex items-center gap-3 mb-3">
              <span className="badge-green">VERBUNDEN</span>
            </div>
            <h1 className="font-display font-bold text-3xl mb-2" style={{ color: "var(--text-primary)" }}>
              Server verbunden
            </h1>
            <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
              Dein Server ist registriert. Der API-Key wird automatisch übertragen.
            </p>

            {result.api_key && (
              <div className="rounded-xl p-4 mb-4" style={{ border: "1px solid var(--accent-line)", backgroundColor: "var(--accent-soft)" }}>
                <div className="text-sm font-medium mb-2" style={{ color: "var(--accent-text)" }}>
                  Mod-API-Key — automatisch an deinen Server
                </div>
                <code className="block text-xs rounded-lg px-4 py-3 font-mono break-all" style={{ backgroundColor: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                  {result.api_key}
                </code>
                <div className="mt-3 flex items-center gap-2">
                  <button className="btn-primary text-xs px-4 py-2" onClick={copyKey}>
                    {copied ? "Kopiert!" : "Key kopieren"}
                  </button>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>Nur Fallback — Übergabe erfolgt automatisch binnen 30 s</span>
                </div>
              </div>
            )}

            <div className="rounded-xl p-4 text-xs space-y-2 mb-6 font-mono" style={{ color: "var(--text-muted)", border: "1px solid var(--border)", backgroundColor: "var(--bg-primary)" }}>
              {steps.map((s) => (
                <div key={s.n} className="flex gap-3">
                  <span style={{ color: "var(--text-secondary)" }}>{s.n}</span>
                  <span>{s.text}</span>
                </div>
              ))}
            </div>

            <button className="btn-primary w-full" onClick={goToDashboard}>
              Zum Dashboard
            </button>
          </div>
        </div>

        <Footer className="mt-12" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ backgroundColor: "var(--bg-primary)" }}>
      <div className="w-full max-w-sm">
        <div className="card sm:p-8">
          <div className="kicker mb-2">Neuer Server</div>
          <h1 className="font-display font-bold text-3xl mb-2" style={{ color: "var(--text-primary)" }}>
            Server einrichten
          </h1>
          <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
            Gib den 16-stelligen Setup-Code aus deiner Server-Konsole ein.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Setup-Code</label>
              <input
                className="input tracking-widest text-center text-lg uppercase"
                placeholder="Xk9mR2pL7vN3bW8z"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={16}
                autoFocus
              />
            </div>

            {error && (
              <div className="text-sm rounded-lg px-3 py-2" style={{ color: "var(--red)", backgroundColor: "var(--red-soft)", border: "1px solid var(--red-line)" }}>
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={code.length !== 16 || loading}>
              {loading ? "Wird geprüft…" : "Server verbinden"}
            </button>
          </form>

          <p className="text-center mt-6 text-xs" style={{ color: "var(--text-muted)" }}>
            Der Code erscheint nur im Server-Konsolen-Log.
            <br />
            <span style={{ color: "var(--text-secondary)" }}>Läuft in 24 Stunden ab</span>
          </p>
        </div>
      </div>

      <Footer className="mt-12" />
    </div>
  )
}
