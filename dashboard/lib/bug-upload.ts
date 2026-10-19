import crypto from "crypto"

/** Upload-Codes für /bug-Bildanhänge: 8 Zeichen, 30 Minuten gültig. */
export const UPLOAD_CODE_LENGTH = 8
export const UPLOAD_CODE_TTL_MS = 30 * 60 * 1000
export const MAX_IMAGES_PER_REPORT = 3
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024
export const ALLOWED_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp"] as const
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number]

// Ohne I/O/0/1 — der Code steht im Chat und wird ggf. abgetippt.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export function generateUploadCode(): string {
  const bytes = crypto.randomBytes(UPLOAD_CODE_LENGTH)
  let code = ""
  for (let i = 0; i < UPLOAD_CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return code
}

export function isValidUploadCode(value: string): boolean {
  return new RegExp(`^[A-Za-z0-9]{${UPLOAD_CODE_LENGTH}}$`).test(value)
}

/** In der DB liegt nur der SHA-256-Hash — der Code selbst ist nicht gespeichert. */
export function hashUploadCode(code: string): string {
  return crypto.createHash("sha256").update(code.trim().toUpperCase()).digest("hex")
}

/** Magic-Bytes-Prüfung — der Content-Type des Clients ist nicht vertrauenswürdig. */
export function detectImageMime(buffer: Buffer): AllowedImageMime | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg"
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return "image/png"
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp"
  }
  return null
}

/** Öffentliche Basis-URL für Links im Chat (Vercel-Header, lokaler Fallback). */
export function getBaseUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, "")
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (!host) return "https://statusmod-dashboard.vercel.app"
  const proto = request.headers.get("x-forwarded-proto")
    ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https")
  return `${proto}://${host}`
}
