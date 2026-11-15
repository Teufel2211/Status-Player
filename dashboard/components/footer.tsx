import Link from "next/link"

const links = [
  { href: "/agb", label: "AGB" },
  { href: "/datenschutz", label: "Datenschutz" },
  { href: "/nutzungsbedingungen", label: "Nutzungsbedingungen" },
  { href: "/impressum", label: "Impressum" },
]

export default function Footer({ className = "" }: { className?: string }) {
  return (
    <footer className={`text-xs font-mono ${className}`} style={{ color: "var(--text-muted)" }}>
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        <span style={{ color: "var(--text-muted)" }}>▲</span>
        <span>statusmod-dashboard.vercel.app</span>
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="hover:opacity-80 transition-opacity">
            {link.label}
          </Link>
        ))}
      </div>
    </footer>
  )
}
