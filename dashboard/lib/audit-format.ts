// Gemeinsame Formatierung für Audit- und Zeit-Anzeigen (Dashboard + Admin).

export function ago(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime()
  if (Number.isNaN(ms) || ms < 0) return ""
  const min = Math.floor(ms / 60000)
  if (min < 1) return "gerade eben"
  if (min < 60) return `vor ${min} Min.`
  const h = Math.floor(min / 60)
  if (h < 24) return `vor ${h} Std.`
  const d = Math.floor(h / 24)
  if (d < 7) return `vor ${d} Tag${d === 1 ? "" : "en"}`
  return new Date(createdAt).toLocaleDateString()
}

export type AuditLike = { action: string; detail: string | null }

function parseDetail(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const v: unknown = JSON.parse(raw)
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  } catch {}
  return {}
}

function fmtDate(value: unknown): string | null {
  if (typeof value === "number" || typeof value === "string") {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d.toLocaleString()
  }
  return null
}

// Jede Aktion als ein Satz, den auch Nicht-Techniker verstehen.
export function describeAudit(entry: AuditLike): string {
  const d = parseDetail(entry.detail)
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null)
  switch (entry.action) {
    case "mute": {
      const mins = typeof d.duration_minutes === "number" ? d.duration_minutes : null
      const until = fmtDate(d.muted_until)
      return `Spieler stummgeschaltet${mins !== null ? ` · ${mins} Min.` : ""}${until ? ` (bis ${until})` : ""}`
    }
    case "unmute":
      return "Stummschaltung aufgehoben"
    case "status_update": {
      const parts: string[] = []
      const status = str(d.status)
      const color = str(d.color)
      if (status) parts.push(`Status „${status}"`)
      if (color) parts.push(`Farbe „${color}"`)
      return parts.length > 0 ? `Spielerstatus geändert: ${parts.join(", ")}` : "Spielerstatus geändert"
    }
    case "preset_upsert": {
      const name = str(d.name)
      return name ? `Preset „${name}" gespeichert` : "Preset gespeichert"
    }
    case "preset_delete": {
      const name = str(d.name)
      return name ? `Preset „${name}" gelöscht` : "Preset gelöscht"
    }
    case "fleet_config_update":
      return "Verteilung aktualisiert"
    case "fleet_config_rollback":
      return "Verteilung zurückgesetzt"
    case "mod_disable":
      return "Status Player für diesen Server deaktiviert"
    case "mod_enable":
      return "Status Player für diesen Server aktiviert"
    case "mod_global_disable":
      return "Status Player auf allen Servern deaktiviert"
    case "mod_global_enable":
      return "Status Player global aktiviert"
    case "config_update":
      return "Server-Config geändert"
    default:
      return entry.action
  }
}
