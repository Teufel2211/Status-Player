import crypto from "crypto"
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2"

const ALGORITHM = "aes-256-gcm"
const KEY_LENGTH = 32
const IV_LENGTH = 16
const TAG_LENGTH = 16

function getEncryptionKey(): Buffer {
  // Bewusst hart: ohne Key-Material wuerde SHA-256("") als allgemein bekannter
  // Schluessel verschluesseln. getEnv() verlangt beide Vars ohnehin.
  const env = process.env.SERVICE_ROLE_KEY ?? process.env.JWT_SECRET ?? ""
  if (!env) throw new Error("SERVICE_ROLE_KEY/JWT_SECRET missing")
  return crypto.createHash("sha256").update(env).digest()
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(plaintext, "utf8", "hex")
  encrypted += cipher.final("hex")
  const tag = cipher.getAuthTag()
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`
}

export function decryptSecret(ciphertext: string): string | null {
  try {
    const key = getEncryptionKey()
    const parts = ciphertext.split(":")
    if (parts.length !== 3) return null
    const iv = Buffer.from(parts[0], "hex")
    const tag = Buffer.from(parts[1], "hex")
    const encrypted = parts[2]
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    let decrypted = decipher.update(encrypted, "hex", "utf8")
    decrypted += decipher.final("utf8")
    return decrypted
  } catch {
    return null
  }
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex")
}

// Peppered hash for persisted values (refresh_tokens, audit_log): without a
// pepper, IPv4/user-agents are brute-forceable from a DB leak. The pepper is
// the service key (never leaves the server). NOTE: rotating SERVICE_ROLE_KEY
// invalidates all sessions + audit linkability (one-time logout for everyone).
function pepperedHex(input: string): string {
  const pepper = process.env.SERVICE_ROLE_KEY ?? ""
  // Hart statt still ungepeffert: sonst wandern weak hashes in die DB, falls
  // eine kuenftige Route frueher persistiert als sie getEnv() aufruft.
  if (!pepper) throw new Error("SERVICE_ROLE_KEY missing")
  return crypto.createHash("sha256").update(pepper + "|" + input).digest("hex")
}

export function hashIp(ip: string): string {
  return pepperedHex("ip|" + ip)
}

export function hashUserAgent(ua: string): string {
  return pepperedHex("ua|" + ua)
}

export function hashAuditUuid(uuid: string): string {
  return pepperedHex("audit|" + uuid)
}

export async function hashArgon2id(plaintext: string): Promise<string> {
  return argon2Hash(plaintext, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  })
}

export async function verifyArgon2id(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2Verify(hash, plaintext)
  } catch {
    return false
  }
}

export function hmacUuid(uuid: string, serverSecret: string): string {
  return crypto.createHmac("sha256", serverSecret).update(uuid).digest("hex")
}
