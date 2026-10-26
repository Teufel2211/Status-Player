"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Sidebar from "@/components/sidebar"
import Footer from "@/components/footer"
import { apiFetch, ensureSession } from "@/lib/client/auth"

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [owner, setOwner] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    ensureSession().then((ok) => {
      if (cancelled) return
      if (ok) {
        setAuthed(true)
        apiFetch("/api/me")
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => { if (!cancelled) setOwner(d?.role === "owner") })
          .catch(() => { if (!cancelled) setOwner(false) })
      } else {
        router.push("/login")
      }
    })
    return () => {
      cancelled = true
    }
  }, [router])

  if (!authed || owner === null) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--bg-primary)" }}>
        <div className="flex items-center gap-3">
          <div className="pulse-dot" />
          <span className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>Lädt…</span>
        </div>
      </div>
    )
  }

  if (!owner) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ backgroundColor: "var(--bg-primary)" }}>
        <div className="card max-w-md w-full text-center sm:p-8">
          <div className="kicker mb-2">Admin-Dashboard</div>
          <h1 className="font-display font-bold text-2xl mb-2" style={{ color: "var(--text-primary)" }}>Kein Zugriff</h1>
          <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
            Dieser Bereich ist nur für den Owner. Erzeuge in der Server-Konsole einen Owner-Code und melde dich
            damit an.
          </p>
          <div className="flex gap-2 justify-center">
            <a href="/dashboard" className="btn-secondary text-sm">Zum Dashboard</a>
            <a href="/login" className="btn-primary text-sm">Zum Login</a>
          </div>
        </div>
        <Footer className="mt-12" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: "var(--bg-primary)" }}>
      <Sidebar variant="admin" />
      <main className="flex-1 overflow-auto flex flex-col">
        <div className="max-w-6xl mx-auto px-8 py-8 flex-1 w-full">
          {children}
        </div>
        <Footer className="px-8 pb-6" />
      </main>
    </div>
  )
}
