import Link from "next/link"
import Footer from "@/components/footer"

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "var(--bg-primary)" }}>
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="text-center max-w-xl w-full">
          <div className="inline-flex items-center gap-2.5 mb-6 px-4 py-1.5 rounded-full font-mono text-xs tracking-widest uppercase" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
            <span className="pulse-dot" />
            StatusMod · Server-Ops
          </div>

          <h1 className="font-display font-bold leading-[0.98] mb-4" style={{ color: "var(--text-primary)", fontSize: "clamp(2.5rem, 7vw, 4.5rem)" }}>
            StatusMod
          </h1>

          <p className="mb-8 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Spieler-Status für deine Minecraft-Server — eine Konsole, keine Datei-Bastelei.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/setup" className="btn-primary text-base px-7 py-3">
              Server einrichten
            </Link>
            <Link href="/login" className="btn-secondary text-base px-7 py-3">
              Anmelden
            </Link>
            <Link href="/dashboard" className="btn-secondary text-base px-7 py-3">
              Dashboard
            </Link>
          </div>
        </div>
      </div>

      <Footer className="pb-8" />
    </div>
  )
}
