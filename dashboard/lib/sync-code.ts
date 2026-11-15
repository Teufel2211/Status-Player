import crypto from "crypto"
import { hashArgon2id, verifyArgon2id, encryptSecret, decryptSecret } from "./hash"

// Der Mod erwartet genau 8 Zeichen (A-Z, a-z, 0-9). Das Alphabet laesst 0/O
// und 1/I/L weg, damit der Code im Log/Support-Fall eindeutig lesbar bleibt.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
const SYNC_CODE_LENGTH = 8

export const SYNC_CODE_SELECT =
  "id, created_at, sync_code_hash, sync_code_pending_hash, sync_code_pending_secret, sync_code_created_at, sync_confirmed_at"

export type SyncCodeServerRow = {
  id: string
  created_at: string | null
  sync_code_hash: string | null
  sync_code_pending_hash: string | null
  sync_code_pending_secret: string | null
  sync_code_created_at: string | null
  sync_confirmed_at: string | null
}

export type SyncCodeGate = {
  allowed: boolean
  /** Nur bei der automatischen Paarung: Klartext fuer genau diesen Sync-Aufruf. */
  setupCode?: string
}

export function generateSyncCode(): string {
  let out = ""
  for (let i = 0; i < SYNC_CODE_LENGTH; i++) {
    out += ALPHABET[crypto.randomInt(ALPHABET.length)]
  }
  return out
}

/**
 * Prueft den vom Mod gesendeten Code.
 *
 * Der Code wird vollstaendig intern ausgehandelt - der Server-Admin muss nichts
 * eingeben oder bestaetigen. Der Mod fragt beim ersten Kontakt ohne Code an,
 * das Dashboard stellt einen aus und liefert ihn einmalig als
 * `sync_code_setup` mit; der Mod speichert und schickt ihn ab dann selbst.
 *
 * Reihenfolge:
 * 1. passt zum aktiven Hash            -> erlaubt
 * 2. passt zum ausstehenden Hash       -> erlaubt + befoerdern (alter Code stirbt)
 * 3. gar kein Code vorhanden           -> Code ausstellen und mitliefern
 * 4. ausstehender Code da, Aufrufer schickt keinen Code
 *                                      -> Klartext erneut ausliefern (Mod hat
 *                                         ihn noch nicht uebernommen)
 * 5. sonst                             -> 403 sync_not_confirmed
 */
export async function evaluateSyncCode(
  sb: any,
  row: SyncCodeServerRow,
  providedRaw: string | null
): Promise<SyncCodeGate> {
  const provided = (providedRaw ?? "").trim()
  const active = row.sync_code_hash
  const pending = row.sync_code_pending_hash

  if (provided && active && (await verifyArgon2id(active, provided))) {
    return { allowed: true }
  }

  if (provided && pending && (await verifyArgon2id(pending, provided))) {
    // Befoerdern: der neue Code wird aktiv, der alte verliert seine Gueltigkeit.
    const nowIso = new Date().toISOString()
    const { error } = await sb
      .from("servers")
      .update({
        sync_code_hash: pending,
        sync_code_pending_hash: null,
        sync_code_pending_secret: null,
        sync_confirmed_at: nowIso,
      })
      .eq("id", row.id)
    if (error) return { allowed: false }
    return { allowed: true }
  }

  // Noch nie ein Code gesetzt: dieser Aufruf ist die Paarung. Der Code wird
  // ausgestellt, verschluesselt hinterlegt und einmalig ausgeliefert.
  if (!active && !pending) {
    const code = generateSyncCode()
    const nowIso = new Date().toISOString()
    const { error } = await sb
      .from("servers")
      .update({
        sync_code_pending_hash: await hashArgon2id(code),
        sync_code_pending_secret: encryptSecret(code),
        sync_code_created_at: nowIso,
        sync_confirmed_at: null,
      })
      .eq("id", row.id)
    if (error) return { allowed: false }
    return { allowed: true, setupCode: code }
  }

  // Paarung laeuft, Mod hat den Code noch nicht uebernommen. Nur ausliefern,
  // wenn der Aufrufer gar keinen Code geschickt hat (sonst koennte ein Client
  // mit falschem Code den Paarungscode ueberschreiben).
  if (!provided && row.sync_code_pending_secret) {
    const code = decryptSecret(row.sync_code_pending_secret)
    if (code) return { allowed: true, setupCode: code }
  }

  return { allowed: false }
}
