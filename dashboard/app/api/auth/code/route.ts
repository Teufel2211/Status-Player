import crypto from "crypto"
import { LoginCodeSchema } from "@/lib/validators"
import { badRequest, unauthorized, ok, serverError } from "@/lib/response"
import { checkRateLimit, RATE_LIMITS, getRateLimitHeaders, isLockedOut, lockoutRemainingMs, recordLoginFailure, clearLoginFailures } from "@/lib/rate-limit"
import { NextResponse } from "next/server"
import { getServiceClient } from "@/lib/supabase"
import { signJwt } from "@/lib/jwt"
import { hashIp, hashUserAgent, verifyArgon2id } from "@/lib/hash"
import { verifySecondFactor } from "@/lib/second-factor"
import { refreshCookieHeader } from "@/lib/cookies"


export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown"
  const ipHash = hashIp(ip)

  const lockoutKey = `login-lockout:${ipHash}`
  if (isLockedOut(lockoutKey)) {
    return NextResponse.json(
      { error: "Ungültige Anfrage" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(lockoutRemainingMs(lockoutKey) / 1000)) } }
    )
  }

  const rl = checkRateLimit(`login:${ipHash}`, RATE_LIMITS.LOGIN)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 429, headers: getRateLimitHeaders(rl) })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequest()
  }

  const parsed = LoginCodeSchema.safeParse(body)
  if (!parsed.success) {
    return badRequest()
  }

  const { code } = parsed.data

  const sb = getServiceClient()

  const { data: verifyCodes, error: findError } = await (sb as any)
    .from("verify_codes")
    .select("*")
    .is("used", false)
    .gt("expires_at", new Date().toISOString())
    .lt("attempt_count", 3)

  if (findError || !verifyCodes || verifyCodes.length === 0) {
    return unauthorized()
  }

  let matchedCode = null
  for (const vc of verifyCodes) {
    const valid = await verifyArgon2id(vc.code_hash, code)
    if (valid) {
      matchedCode = vc
      break
    }
  }

  if (!matchedCode) {
    recordLoginFailure(lockoutKey)
    // Hinweis: kein globales Verbrennen von attempt_count aller Codes (DoS:
    // 3 Fehlversuche würden fremde Codes mitsperren). Schutz via IP-Lockout.
    return unauthorized()
  }

  const { data: user, error: userError } = await (sb as any)
    .from("dashboard_users")
    .select("uuid, role, server_id, totp_secret, is_fleet_admin")
    .eq("uuid", matchedCode.uuid)
    .maybeSingle()

  if (userError || !user) {
    return unauthorized()
  }

  // 2FA-Pflicht: ohne bestandenen zweiten Faktor gibt es keine Tokens.
  // Der Code bleibt dabei unverbraucht (Burn erst bei Erfolg), Retry möglich.
  if (user.totp_secret) {
    const sf = await verifySecondFactor(sb, user.uuid, body as Record<string, unknown>, `totp-login:${ipHash}`)
    if (sf.rateLimited) {
      return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 429 })
    }
    if (!sf.ok) {
      return NextResponse.json({ need_2fa: true })
    }
  }

  const { error: useError, data: burned } = await (sb as any)
    .from("verify_codes")
    .update({ used: true })
    .eq("code_hash", matchedCode.code_hash)
    .is("used", false)
    .select("code_hash")

  if (useError || !burned || burned.length === 0) {
    // Bereits eingelöst (Race) -> kein zweites Login.
    return unauthorized()
  }

  clearLoginFailures(lockoutKey)

  const accessToken = signJwt({
    sub: user.uuid,
    server_id: user.server_id,
    role: user.role,
    is_fleet_admin: user.is_fleet_admin === true,
  })

  const refreshTokenRaw = crypto.randomUUID()
  const refreshTokenHash = crypto.createHash("sha256").update(refreshTokenRaw).digest("hex")

  const { error: rtError } = await (sb as any).from("refresh_tokens").insert({
    uuid: user.uuid,
    server_id: user.server_id,
    token_hash: refreshTokenHash,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ip_hash: ipHash,
    user_agent_hash: hashUserAgent(request.headers.get("user-agent") ?? "unknown"),
  })

  if (rtError) {
    return serverError()
  }

  return NextResponse.json(
    { access_token: accessToken, expires_in: 900, uuid: user.uuid, server_id: user.server_id },
    {
      headers: {
        ...getRateLimitHeaders(rl),
        "Set-Cookie": refreshCookieHeader(refreshTokenRaw),
      },
    }
  )
}
