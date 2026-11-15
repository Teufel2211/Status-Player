"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Sidebar from "@/components/sidebar"
import Footer from "@/components/footer"
import { ensureSession } from "@/lib/client/auth"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    ensureSession().then((ok) => {
      if (cancelled) return
      if (ok) {
        setAuthed(true)
        setChecking(false)
      } else {
        router.push("/login")
      }
    })
    return () => {
      cancelled = true
    }
  }, [router])

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--bg-primary)" }}>
        <div className="flex items-center gap-3">
          <div className="pulse-dot" />
          <span className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>Lädt…</span>
        </div>
      </div>
    )
  }

  if (!authed) return null

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: "var(--bg-primary)" }}>
      <Sidebar />
      <main className="flex-1 overflow-auto flex flex-col">
        <div className="max-w-6xl mx-auto px-8 py-8 flex-1 w-full">
          {children}
        </div>
        <Footer className="px-8 pb-6" />
      </main>
    </div>
  )
}
