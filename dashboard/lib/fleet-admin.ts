// "Fleet-Admin" ist das Projekt-Konto, nicht der Server-Owner.
//
// role === "owner" bekommt JEDER Server-Owner aus dem Setup-Flow (er besitzt
// genau einen Server). Fuer Aktionen, die alle Server betreffen - z. B. einen
// unbekannten Mod-Build freischalten - braucht es deshalb ein eigenes Flag
// auf dem Konto.
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
