"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Footer from "@/components/footer"
import { setAccessToken } from "@/lib/client/auth"

export default function LoginPage() {
  const router = useRouter()
  const [code, setCode] = useState("")
  const [totp, setTotp] = useState("")
  const [need2fa, setNeed2fa] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [ownerMode, setOwnerMode] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const endpoint = ownerMode ? "/api/auth/owner-login" : "/api/auth/code"
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(need2fa ? { code, token: totp } : { code }),
      })

      if (!res.ok) {
        if (res.status === 429) {
          setError("Zu viele Versuche — bitte kurz warten.")
        } else {
          setError("Ungültiger oder abgelaufener Code")
        }
        return
      }

      const data = await res.json()
      if (data.need_2fa) {
        if (need2fa) {
          // Zweiter Versuch mit falschem TOTP -> Feedback statt Stille.
          setError("Falscher Authenticator-Code, bitte erneut versuchen")
        }
        setNeed2fa(true)
        setTotp("")
        return
      }
      setAccessToken(data.access_token)
      router.push(ownerMode ? "/admin-dashboard" : "/dashboard")
    } catch {
      setError("Verbindung fehlgeschlagen — bitte erneut versuchen.")
    } finally {
      setLoading(false)
    }
  }

  const codeLength = ownerMode ? 16 : 8

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ backgroundColor: "var(--bg-primary)" }}>
      <div className="w-full max-w-sm">
        <div className="card sm:p-8">
          <div className="kicker mb-2">{ownerMode ? "Owner-Zugang" : "Spieler-Zugang"}</div>
          <h1 className="font-display font-bold text-3xl mb-2" style={{ color: "var(--text-primary)" }}>
            Anmelden
          </h1>
          <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
            {ownerMode
              ? "Erzeuge mit /fleet owner-code in der Server-Konsole deinen Owner-Code."
              : "Hol dir mit /code im Spiel deinen Login-Code."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">{ownerMode ? "Owner-Code" : "Login-Code"}</label>
              <input
                className="input tracking-widest text-center text-lg uppercase"
                placeholder={ownerMode ? "AAAAAAAAAAAAAAAA" : "A3kR9xZ2"}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={codeLength}
                autoFocus
              />
            </div>

            {need2fa && (
              <div>
                <label className="label">Authenticator-Code</label>
                <input
                  className="input tracking-widest text-center text-lg"
                  placeholder="123456"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                  maxLength={8}
                  autoFocus
                />
              </div>
            )}

            {error && (
              <div className="text-sm rounded-lg px-3 py-2" style={{ color: "var(--red)", backgroundColor: "var(--red-soft)", border: "1px solid var(--red-line)" }}>
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={code.length !== codeLength || loading || (need2fa && totp.length < 6)}>
              {loading ? "Wird geprüft…" : need2fa ? "Code bestätigen" : "Anmelden"}
            </button>

            <button
              type="button"
              className="w-full text-xs underline underline-offset-2"
              style={{ color: "var(--text-muted)" }}
              onClick={() => { setOwnerMode(!ownerMode); setCode(""); setTotp(""); setNeed2fa(false); setError("") }}
            >
              {ownerMode ? "Stattdessen Spieler-Code verwenden" : "Als Owner anmelden"}
            </button>
          </form>

          <p className="text-center mt-6 text-xs" style={{ color: "var(--text-muted)" }}>
            Der Code läuft nach 10 Minuten ab.
          </p>
        </div>
      </div>

      <Footer className="mt-12" />
    </div>
  )
}
