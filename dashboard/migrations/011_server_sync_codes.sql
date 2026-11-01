-- 011 – Sync-Bestätigungscode (Status Player 1.4.2)
--
-- Der Mod darf nur noch synchronisieren, wenn er einen vom Dashboard
-- ausgestellten Code mitschickt (Header x-sync-code). Ein kopiertes JAR mit
-- kopierter config.json verliert den Zugang, sobald der Code im Dashboard
-- zurückgesetzt wird.
--
-- servers.sync_code_hash           = Argon2id-Hash des aktiven Codes (NULL = keiner)
-- servers.sync_code_pending_hash   = neu erzeugter, noch nicht bestätigter Code
--                                    (alter Code bleibt bis zur Bestätigung gültig)
-- servers.sync_code_pending_secret = AES-verschlüsselter Klartext des
--                                    automatisch erzeugten Migrationscodes;
--                                    wird beim Bestätigen gelöscht
-- servers.sync_code_created_at     = Zeitpunkt der letzten Code-Erzeugung
-- servers.sync_confirmed_at        = Zeitpunkt der letzten Bestätigung
-- servers.sync_reset_at            = Zeitpunkt des letzten Zurücksetzens.
--                                    Verhindert, dass ein bewusst
--                                    zurückgesetzter Alt-Server beim nächsten
--                                    Sync wieder automatisch einen Code bekommt.
--
-- Bestehende Server ohne Hash bekommen beim ersten Pull automatisch einen
-- Code (siehe lib/sync-code.ts). Server, die nach dem Stichtag angelegt
-- wurden, müssen manuell paaren.

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS sync_code_hash text,
  ADD COLUMN IF NOT EXISTS sync_code_pending_hash text,
  ADD COLUMN IF NOT EXISTS sync_code_pending_secret text,
  ADD COLUMN IF NOT EXISTS sync_code_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_reset_at timestamptz;
