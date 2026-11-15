import { ok, serverError, unauthorized, badRequest } from "@/lib/response"
import { NextResponse } from "next/server"
import { getServiceClient } from "@/lib/supabase"
import { requireSession } from "@/lib/auth"
import { encryptSecret, hashArgon2id, hashIp } from "@/lib/hash"
import { verifySecondFactor } from "@/lib/second-factor"
import { generateSecret } from "otplib"
import crypto from "crypto"


export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const session = requireSession(request)
  if (!session) return unauthorized()

  const sb = getServiceClient()

  // Rotation nur mit Nachweis: Wer bereits 2FA hat, muss aktuelles TOTP
  // oder einen Recovery-Code vorzeigen (sonst sperrt ein Session-Dieb per
  // eigenem Secret das Opfer dauerhaft aus). Ersteinrichtung ohne Nachweis.
  const { data: existing } = await (sb as any)
    .from("dashboard_users")
    .select("totp_secret")
    .eq("uuid", session.sub)
    .maybeSingle()
  if (existing?.totp_secret) {
    let rawBody: Record<string, unknown> = {}
    try { rawBody = (await request.json()) as Record<string, unknown> } catch { return badRequest() }
    const ip = request.headers.get("x-forwarded-for") ?? "unknown"
    const sf = await verifySecondFactor(sb, session.sub, rawBody, `totp-setup:${hashIp(ip)}`)
    if (sf.rateLimited) {
      return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 429 })
    }
    if (!sf.ok) return unauthorized()
  }

  const secret = generateSecret()

  const issuer = "Status Player"
  const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(session.sub)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`

  const encryptedSecret = encryptSecret(secret)

  const recoveryCodes = Array.from({ length: 10 }, () => crypto.randomBytes(4).toString("hex"))
  const recoveryCodeHashes = await Promise.all(recoveryCodes.map((rc) => hashArgon2id(rc)))

  const { error } = await (sb as any)
    .from("dashboard_users")
    .update({
      totp_secret: encryptedSecret,
      recovery_code_hashes: recoveryCodeHashes,
    })
    .eq("uuid", session.sub)

  if (error) return serverError()

  return ok({
    secret,
    otpauth_url: otpauth,
    recovery_codes: recoveryCodes,
  })
}
