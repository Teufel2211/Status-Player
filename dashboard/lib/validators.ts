import { z } from "zod"

// Version 1-5 (nicht nur v4): Offline-Mode-Server erzeugen v3-UUIDs,
// die sonst auf allen Lesewegen mit 400 abgewiesen würden.
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const SetupCodeSchema = z.object({
  code: z.string().length(16).regex(/^[A-Za-z0-9]+$/),
})

export const SetupInitSchema = z.object({
  server_id: z.string().regex(uuidRegex),
  code: z.string().length(16).regex(/^[A-Za-z0-9]+$/),
})

export const LoginCodeSchema = z.object({
  code: z.string().length(8).regex(/^[A-Za-z0-9]+$/),
})

export const OwnerCodeSchema = z.object({
  code: z.string().length(16).regex(/^[A-Za-z0-9]+$/),
})

export const RefreshTokenSchema = z.object({
  refresh_token: z.string().min(1),
})

export const ApiKeyCreateSchema = z.object({
  scopes: z.array(z.enum(["check", "audit", "*"])).min(1).max(5),
})

export const PlayerStatusFieldSchema = z.object({
  status: z.string().max(64).optional(),
  color: z.string().max(32).optional(),
})

export const MutePlayerSchema = z.object({
  duration_minutes: z.number().int().positive().max(525600),
})

export const FleetConfigSchema = z.object({
  dashboard_url: z.string().max(256).optional(),
  setup_secret: z.string().max(512).optional(),
  restore_id: z.number().int().positive().optional(),
})

export const ModKillSwitchSchema = z.object({
  mod_enabled: z.boolean(),
})

export const BugReportSchema = z.object({
  server_id: z.string().regex(uuidRegex),
  // Nur für den Rate-Limit-Schlüssel - wird nicht gespeichert.
  uuid: z.string().min(1).max(64),
  player: z.string().min(1).max(32),
  text: z.string().min(10).max(2000),
  mod_version: z.string().max(32).optional().default("unknown"),
  mc_version: z.string().max(32).optional().default("unknown"),
  loader: z.string().max(32).optional().default("unknown"),
})

export const BugReportUpdateSchema = z.object({
  resolved: z.boolean(),
})

export function validatePathUuid(value: string): boolean {
  return uuidRegex.test(value)
}
