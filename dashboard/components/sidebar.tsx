"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { apiFetch, logout } from "@/lib/client/auth"
import { useTheme } from "@/components/theme-provider"

type Variant = "dashboard" | "admin"

export default function Sidebar({ variant = "dashboard" }: { variant?: Variant }) {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, toggle } = useTheme()
  const base = variant === "admin" ? "/admin-dashboard" : "/dashboard"
  const [openBugs, setOpenBugs] = useState<number | null>(null)

  useEffect(() => {
    if (variant !== "admin") return
    let cancelled = false
    apiFetch("/api/bug-reports")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const reports: Array<{ resolved?: boolean }> = data.reports ?? []
        setOpenBugs(reports.filter((r) => !r.resolved).length)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [variant])

  async function handleLogout() {
    await logout()
    router.push("/")
  }

  const sections: Array<{ title: string; items: Array<{ href: string; label: string; icon: string; count?: number | null }> }> = [
    {
      title: "Betrieb",
      items: [
        { href: base, label: "Übersicht", icon: "◆" },
        { href: `${base}/players`, label: "Spieler", icon: "◎" },
        ...(variant === "admin"
          ? [{ href: `${base}/bugs`, label: "Bug-Meldungen", icon: "✉", count: openBugs }]
          : []),
      ],
    },
    {
      title: "Konfiguration",
      items: [
        ...(variant === "dashboard"
          ? [
              { href: `${base}/presets`, label: "Presets", icon: "★" },
              { href: `${base}/moderation`, label: "Moderation", icon: "⚖" },
            ]
          : []),
        { href: `${base}/keys`, label: "API-Keys", icon: "⌨" },
        { href: `${base}/audit`, label: "Verlauf", icon: "◉" },
      ],
    },
  ]

  return (
    <aside className="w-60 min-h-screen border-r flex flex-col shrink-0" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-card)" }}>
      <div className="px-5 py-6 border-b" style={{ borderColor: "var(--border)" }}>
        <Link href={base} className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center font-display font-bold" style={{ backgroundColor: "var(--accent)", color: "var(--accent-fg)" }}>
            S
          </div>
          <div className="font-display font-bold leading-none" style={{ color: "var(--text-primary)" }}>Status Player</div>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-5 overflow-auto">
        {sections.map((section) => (
          <div key={section.title}>
            <div className="kicker px-3 pb-2" style={{ fontSize: "10px" }}>{section.title}</div>
            <div className="space-y-1">
              {section.items.map((item) => {
                const active = pathname === item.href || (item.href !== base && pathname.startsWith(item.href))
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors font-medium"
                    style={active ? {
                      backgroundColor: "var(--accent-soft)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--accent-line)",
                    } : {
                      color: "var(--text-secondary)",
                      border: "1px solid transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!active) {
                        e.currentTarget.style.color = "var(--text-primary)"
                        e.currentTarget.style.backgroundColor = "var(--bg-hover)"
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!active) {
                        e.currentTarget.style.color = "var(--text-secondary)"
                        e.currentTarget.style.backgroundColor = ""
                      }
                    }}
                  >
                    <span className="w-5 text-center text-base" style={active ? { color: "var(--accent-text)" } : undefined}>{item.icon}</span>
                    {item.label}
                    {typeof item.count === "number" && item.count > 0 && (
                      <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>· {item.count}</span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-3 py-4 border-t space-y-1" style={{ borderColor: "var(--border)" }}>
        <button
          onClick={toggle}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm w-full transition-colors"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text-primary)"
            e.currentTarget.style.backgroundColor = "var(--bg-hover)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-secondary)"
            e.currentTarget.style.backgroundColor = ""
          }}
        >
          <span className="w-5 text-center">{theme === "dark" ? "☀" : "☾"}</span>
          {theme === "dark" ? "Helles Design" : "Dunkles Design"}
        </button>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm w-full transition-colors"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--red)"
            e.currentTarget.style.backgroundColor = "var(--red-soft)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-secondary)"
            e.currentTarget.style.backgroundColor = ""
          }}
        >
          <span className="w-5 text-center">✕</span>
          Abmelden
        </button>
      </div>
    </aside>
  )
}
