import { unauthorized } from "@/lib/response"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"
import { verifyJwt } from "@/lib/jwt"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  let session = requireSession(request)

  if (!session) {
    const url = new URL(request.url)
    const token = url.searchParams.get("token")
    if (token) {
      session = verifyJwt(token)
    }
  }

  if (!session) return unauthorized()

  const sb = getServiceClient()
  const serverId = session.server_id

  const loadPlayers = async () => {
    const { data, error } = await (sb as any)
      .from("players")
      .select("uuid, username, status, color, avatar, updated_at")
      .eq("server_id", serverId)
      .eq("is_online", true)
      .order("updated_at", { ascending: false })
      .limit(100)
    if (error) throw new Error(error.message)
    return data ?? []
  }

  // Erster Snapshot VOR dem Stream-Aufbau: sonst bekommt das Dashboard bis zu
  // 30 s lang gar kein players-Event (der erste Push kam bisher aus dem Intervall).
  let initial: unknown[] | null = null
  try {
    initial = await loadPlayers()
  } catch { /* erster Intervall-Push holt es nach */ }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      let closed = false

      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch { /* ignore */ }
      }

      send("connected", { server_id: serverId })
      if (initial) send("players", initial)

      const interval = setInterval(async () => {
        if (closed) { clearInterval(interval); return }
        try {
          const data = await loadPlayers()
          if (!closed) send("players", data)
        } catch { /* silent */ }
      }, 30_000)

      request.signal.addEventListener("abort", () => {
        closed = true
        clearInterval(interval)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
