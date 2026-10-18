import { ok, serverError, unauthorized, forbidden } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"

export const dynamic = "force-dynamic"

// Alle Spieler aller Server — nur für den Owner (Admin-Dashboard).
export async function GET(request: Request) {
  const session = requireSession(request)
  if (!session) return unauthorized()
  if (session.role !== "owner") return forbidden("Nur der Owner sieht alle Spieler")

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
