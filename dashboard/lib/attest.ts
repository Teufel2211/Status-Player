import crypto from "crypto"
import { z } from "zod"

// Prueft das signierte Build-Attest, das der Mod bei jedem Sync-Aufruf als
// Header mitschickt (siehe docs/superpowers/specs/2026-11-06-sync-fallback-attest-design.md).
//
// Das Dashboard hat die JAR nicht und kann die Inhalts-Hashes nicht
// nachrechnen. Geprueft wird: "dieser Attest-Inhalt (build_id + Hashes) wurde
// von unserem Release-Key signiert". Selbstgebaute Fremd-JARs und gefaelschte
// Build-IDs fallen damit auf. Replay eines echten Attests bleibt moeglich und
// ist laut Spec bewusst akzeptiert.

export const ATTEST_HEADER = "x-mod-attest"
export const ATTEST_SIG_HEADER = "x-mod-attest-sig"

// Header duerfen nicht beliebig gross werden: das Attest ist ein kleines JSON
// (~400 Bytes), die Signatur 64 Bytes Base64.
const MAX_ATTEST_CHARS = 4096
const MAX_SIG_CHARS = 512

const AttestSchema = z.object({
  schema: z.literal(1),
  build_id: z.string().min(1).max(64).regex(/^[0-9A-Za-z.\-]+$/),
  version: z.string().min(1).max(32),
  loader: z.enum(["fabric", "forge", "neoforge", "quilt"]),
  minecraft: z.string().min(1).max(32),
  classes_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  resources_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  key_id: z.string().min(1).max(64),
  issued_at: z.string().min(1).max(40),
})

export type AttestFields = z.infer<typeof AttestSchema>

export type AttestOutcome =
  | { status: "valid"; fields: AttestFields }
  | { status: "missing" }
  | { status: "invalid"; reason: string }

// Reihenfolge identisch zu canonicalJson() in scripts/ci/sign-build.mjs. Wenn
// die Bytes nicht exakt dieser Form entsprechen, ist das Attest nicht das, was
// unsere CI erzeugt hat - dann lehnen wir ab, statt zu raten.
const CANONICAL_ORDER: (keyof AttestFields)[] = [
  "schema",
  "build_id",
  "version",
  "loader",
  "minecraft",
  "classes_sha256",
  "resources_sha256",
  "key_id",
  "issued_at",
]

// Roh-32-Byte-Ed25519-Public-Key in den SPKI-Wrapper packen (wie sign-build.mjs).
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

function publicKeyFromRaw(rawB64: string): crypto.KeyObject {
  const raw = Buffer.from(rawB64, "base64")
  if (raw.length !== 32) throw new Error("public key must be 32 raw bytes")
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  })
}

function decodeBase64Url(value: string): Buffer {
  // Buffer akzeptiert base64url direkt; Padding ist optional.
  return Buffer.from(value, "base64url")
}

function decodeBase64(value: string): Buffer {
  return Buffer.from(value.replace(/\s+/g, ""), "base64")
}

export async function verifyAttest(sb: any, request: Request): Promise<AttestOutcome> {
  const rawAttest = request.headers.get(ATTEST_HEADER)
  const rawSig = request.headers.get(ATTEST_SIG_HEADER)

  if (!rawAttest && !rawSig) return { status: "missing" }
  if (!rawAttest || !rawSig) return { status: "invalid", reason: "incomplete attest headers" }
  if (rawAttest.length > MAX_ATTEST_CHARS) return { status: "invalid", reason: "attest header too large" }
  if (rawSig.length > MAX_SIG_CHARS) return { status: "invalid", reason: "signature header too large" }

  let jsonBytes: Buffer
  let jsonText: string
  let parsed: unknown
  try {
    jsonBytes = decodeBase64Url(rawAttest)
    jsonText = jsonBytes.toString("utf8")
    parsed = JSON.parse(jsonText)
  } catch {
    return { status: "invalid", reason: "attest is not valid JSON" }
  }

  const shape = AttestSchema.safeParse(parsed)
  if (!shape.success) return { status: "invalid", reason: "attest schema mismatch" }

  // Only accept the exact byte form our signing script produces.
  const canonical = JSON.stringify(shape.data, CANONICAL_ORDER)
  if (canonical !== jsonText) return { status: "invalid", reason: "attest JSON is not canonical" }

  const { data: keyRow, error } = await (sb as any)
    .from("attest_keys")
    .select("public_key, active")
    .eq("key_id", shape.data.key_id)
    .maybeSingle()
  if (error) return { status: "invalid", reason: "attest key lookup failed" }
  if (!keyRow || keyRow.active === false) {
    return { status: "invalid", reason: "unknown attest key" }
  }

  try {
    const signature = decodeBase64(rawSig)
    if (signature.length !== 64) return { status: "invalid", reason: "signature length mismatch" }
    const verified = crypto.verify(
      null,
      jsonBytes,
      publicKeyFromRaw(keyRow.public_key as string),
      signature
    )
    if (!verified) return { status: "invalid", reason: "signature invalid" }
  } catch {
    return { status: "invalid", reason: "signature verification failed" }
  }

  return { status: "valid", fields: shape.data }
}

/**
 * Ergebnis des Checks fuer die Sync-Route: darf geschrieben werden?
 * `devBuilds` unterscheidet "kein Attest, aber Owner hat Dev-Builds erlaubt".
 */
export function attestGate(outcome: AttestOutcome, allowDevBuilds: boolean) {
  if (outcome.status === "valid") {
    return { allowed: true as const, devBuild: false as const, fields: outcome.fields }
  }
  if (outcome.status === "missing" && allowDevBuilds) {
    return { allowed: true as const, devBuild: true as const, fields: null }
  }
  if (outcome.status === "missing") {
    return {
      allowed: false as const,
      error: "attest_required" as const,
      reason: "attest headers missing",
    }
  }
  return { allowed: false as const, error: "attest_invalid" as const, reason: outcome.reason }
}

/**
 * Haelt fest, welcher Build zuletzt synchronisiert hat (nur bei gueltigem
 * Attest, damit ein Dev-Build die Spur nicht ueberschreibt).
 */
export async function recordAttest(
  sb: any,
  serverId: string,
  fields: AttestFields
): Promise<void> {
  await (sb as any)
    .from("servers")
    .update({
      attest_build_id: fields.build_id,
      attest_key_id: fields.key_id,
      attest_verified_at: new Date().toISOString(),
    })
    .eq("id", serverId)
}

/**
 * Laesst die Build-Spur verfallen, wenn ein Dev-Build die Freigabe
 * (`allow_dev_builds = true`) nutzt. So zeigt die Owner-Karte nie einen
 * verifizierten Build, der gerade gar nicht laeuft.
 */
export async function clearAttest(sb: any, serverId: string): Promise<void> {
  await (sb as any)
    .from("servers")
    .update({
      attest_build_id: null,
      attest_key_id: null,
      attest_verified_at: null,
    })
    .eq("id", serverId)
}
