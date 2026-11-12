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
    case "moderation_settings": {
      const parts: string[] = []
      if (typeof d.warn_default_days === "number") parts.push(`Warn-Dauer ${d.warn_default_days} Tage`)
      if (typeof d.warn_auto_mute_suggestion === "boolean") {
        parts.push(`Mute-Vorschlag ${d.warn_auto_mute_suggestion ? "an" : "aus"}`)
      }
      return parts.length > 0 ? `Moderationseinstellungen geändert: ${parts.join(", ")}` : "Moderationseinstellungen geändert"
    }
    case "build_settings":
      return typeof d.allow_dev_builds === "boolean"
        ? `Dev-Builds ${d.allow_dev_builds ? "erlaubt" : "gesperrt"}`
        : "Dev-Build-Einstellung geändert"
    case "build_override_set": {
      const build = str(d.build_override_id)
      return build ? `Build „${build}" für diesen Server freigeschaltet` : "Build für diesen Server freigeschaltet"
    }
    case "build_override_cleared":
      return "Build-Freischaltung zurückgezogen"
    case "ignore_add": {
      if (d.permanent === true) return "Spieler dauerhaft blockiert"
      const mins = typeof d.duration_minutes === "number" ? d.duration_minutes : null
      const until = fmtDate(d.expires_at)
      return `Spieler blockiert${mins !== null ? ` · ${mins} Min.` : ""}${until ? ` (bis ${until})` : ""}`
    }
    case "ignore_remove":
      return "Blockierung aufgehoben"
    case "slowmode": {
      const secs = typeof d.seconds === "number" ? d.seconds : null
      return secs !== null ? `Slowmode auf ${secs} Sek. gesetzt` : "Slowmode geändert"
    }
    case "warn_add": {
      const days = typeof d.days === "number" ? d.days : null
      const reason = str(d.reason)
      return `Verwarnung erteilt${days !== null ? ` · ${days} Tage` : ""}${reason ? ` · „${reason}"` : ""}`
    }
    case "warn_revoke":
      return "Verwarnung zurückgenommen"
    case "warn_clear":
      return "Alle Verwarnungen zurückgenommen"
    default:
      return entry.action
  }
}
