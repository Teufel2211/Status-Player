import { RefreshTokenSchema } from "@/lib/validators"
import { badRequest, unauthorized, serverError } from "@/lib/response"
import { NextResponse } from "next/server"
import { getServiceClient } from "@/lib/supabase"
import { signJwt } from "@/lib/jwt"
import { hashIp, hashUserAgent } from "@/lib/hash"
import { checkRateLimit, RATE_LIMITS, getRateLimitHeaders } from "@/lib/rate-limit"
import { getRefreshTokenFromCookie, refreshCookieHeader } from "@/lib/cookies"
import crypto from "crypto"


export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown"
  // Erhöhtes Limit: Browser-Session-Restore öffnet viele Tabs parallel,
  // jeder refresht einmal (Rotation mit Grace, s. unten).
  const rl = checkRateLimit(`refresh:${hashIp(ip)}`, { windowMs: 60_000, max: 30 })
  if (!rl.allowed) {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 429, headers: getRateLimitHeaders(rl) })
  }

  let refreshToken = getRefreshTokenFromCookie(request)

  if (!refreshToken) {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return badRequest()
    }

    const parsed = RefreshTokenSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest()
    }

    refreshToken = parsed.data.refresh_token
  }

  if (!refreshToken) {
    return unauthorized()
  }

  const sb = getServiceClient()
  const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex")

  const { data: tokenData, error: tokenError } = await (sb as any)
    .from("refresh_tokens")
    .select("*")
    .eq("token_hash", tokenHash)
    .is("revoked", false)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()

  if (tokenError || !tokenData) {
    return unauthorized()
  }

  const ua = request.headers.get("user-agent") ?? "unknown"

  if (tokenData.user_agent_hash !== hashUserAgent(ua)) {
    await (sb as any).from("refresh_tokens").update({ revoked: true }).eq("id", tokenData.id)
    return unauthorized()
  }

  // Rotation mit Grace: Der alte Token bleibt 60s gueltig statt sofort revoked.
  // Grund: Session-Restore öffnet N Tabs parallel mit demselben Cookie —
  // bei sofortigem Revoke würde der erste Tab alle anderen ausloggen (401 ->
  // clearSession leert das geteilte localStorage). UA-Binding bleibt als
  // Diebstahlschutz bestehen (Mismatch -> sofort revoke + 401).
  // Grace nur EINMAL vergeben: ein bereits verkürzter Token wird nicht erneut
  // verlängert, sonst lebt ein gestohlener Token bei Nutzung alle <60s ewig
  // (Sliding Window). Restlaufzeit >60s = noch nie rotiert.
  const remainingMs = new Date(tokenData.expires_at).getTime() - Date.now()
  if (remainingMs > 60_000) {
    await (sb as any).from("refresh_tokens").update({
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }).eq("id", tokenData.id)
  }

  const { data: user, error: userError } = await (sb as any)
    .from("dashboard_users")
    .select("uuid, role, server_id, is_fleet_admin")
    .eq("uuid", tokenData.uuid)
    .maybeSingle()

  if (userError || !user) {
    return unauthorized()
  }

  const newAccessToken = signJwt({
    sub: user.uuid,
    server_id: user.server_id,
    role: user.role,
    is_fleet_admin: user.is_fleet_admin === true,
  })

  const newRefreshTokenRaw = crypto.randomUUID()
  const newRefreshTokenHash = crypto.createHash("sha256").update(newRefreshTokenRaw).digest("hex")

  const { error: rtError } = await (sb as any).from("refresh_tokens").insert({
    uuid: user.uuid,
    server_id: user.server_id,
    token_hash: newRefreshTokenHash,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ip_hash: hashIp(ip),
    user_agent_hash: hashUserAgent(ua),
  })

  if (rtError) {
    return serverError()
  }

  return NextResponse.json(
    { access_token: newAccessToken, expires_in: 900, uuid: user.uuid, server_id: user.server_id },
    {
      headers: {
        ...getRateLimitHeaders(rl),
        "Set-Cookie": refreshCookieHeader(newRefreshTokenRaw),
      },
    }
  )
}
