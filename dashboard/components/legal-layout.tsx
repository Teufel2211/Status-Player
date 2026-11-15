import Link from "next/link"
import type { ReactNode } from "react"
import Footer from "@/components/footer"

export default function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col px-4 py-12">
      <div className="w-full max-w-3xl mx-auto flex-1">
        <Link href="/" className="text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
          ← Zurück zur Startseite
        </Link>

        <div className="mt-6 mb-8">
          <h1 className="text-3xl font-display text-[var(--text-primary)] mb-2">{title}</h1>
          <p className="text-xs font-mono text-[var(--text-muted)]">Zuletzt aktualisiert: {updated}</p>
        </div>

        <div className="card prose prose-sm max-w-none dark:prose-invert prose-headings:font-display prose-headings:text-[var(--text-primary)] prose-p:text-[var(--text-secondary)] prose-li:text-[var(--text-secondary)] prose-a:text-[var(--accent-text)] prose-strong:text-[var(--text-primary)]">
          {children}
        </div>
      </div>

      <Footer className="mt-12" />
    </div>
  )
}
