import { ok, serverError, unauthorized, forbidden } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireFleetAdmin } from "@/lib/fleet-admin"

export const dynamic = "force-dynamic"

// Alle Spieler aller Server — nur das Projekt-Konto (Admin-Dashboard).
export async function GET(request: Request) {
  const gate = await requireFleetAdmin(request)
  if (!gate.ok) return gate.status === 401 ? unauthorized() : forbidden("Nur der Projekt-Admin sieht alle Spieler")

  const sb = getServiceClient()
  const { data, error } = await (sb as any)
    .from("players")
    .select("id, server_id, uuid, username, status, color, avatar, is_online, created_at")
    .order("is_online", { ascending: false })
    .order("username", { ascending: true })
    .limit(2000)

  if (error) return serverError()
  return ok({ players: data ?? [] })
}
