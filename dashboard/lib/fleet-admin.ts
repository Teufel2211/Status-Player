import { requireSession } from "./auth"
import { getServiceClient } from "./supabase"
import type { JwtPayload } from "./jwt"

// "Fleet-Admin" ist das Projekt-Konto, nicht der Server-Owner.
//
// role === "owner" bekommt JEDER Server-Owner aus dem Setup-Flow (er besitzt
// genau einen Server). Fuer Aktionen, die alle Server betreffen - z. B. einen
// unbekannten Mod-Build freischalten oder die globale Verteilung lesen - braucht
// es deshalb ein eigenes Flag auf dem Konto. Admin-Routen muessen dieses Flag
// pruefen, NICHT role === "owner" (das hat jeder Server-Owner).
export async function isFleetAdmin(sb: any, uuid: string): Promise<boolean> {
  if (!uuid) return false
  const { data, error } = await (sb as any)
    .from("dashboard_users")
    .select("is_fleet_admin")
    .eq("uuid", uuid)
    .maybeSingle()
  if (error || !data) return false
  return data.is_fleet_admin === true
}

export type FleetAdminGate =
  | { ok: true; session: JwtPayload; sb: any }
  | { ok: false; status: 401 | 403 }

// Gate fuer Routen, die ALLE Server betreffen (Admin-Dashboard): Session muss
// gueltig sein UND das Konto muss is_fleet_admin haben. 401 = kein Token,
// 403 = Token ok, aber kein Projekt-Konto.
export async function requireFleetAdmin(request: Request): Promise<FleetAdminGate> {
  const session = requireSession(request)
  if (!session) return { ok: false, status: 401 }
  const sb = getServiceClient()
  if (!(await isFleetAdmin(sb, session.sub))) return { ok: false, status: 403 }
  return { ok: true, session, sb }
}
