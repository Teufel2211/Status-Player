-- 008 – Ablaufzeit-Status, Slowmode, Kurzzeit-Ignore, Server-Presets (StatusMod 1.4.2)
--
-- status_expires_at: Ablaufzeit des aktuell gesetzten Timed-Status (nur Anzeige;
--   der Mod haelt den vorherigen Status lokal als Stash).
-- slowmode_seconds: Mindestabstand zwischen zwei /status-Aenderungen pro Spieler.
-- blocked_players.expires_at: NULL = permanenter Block, sonst automatische Rueckkehr.
-- custom_presets.updated_at: Wasserzeichen fuer den Mod-Pull (Server-Presets).

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS status_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS slowmode_seconds integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'players_slowmode_range'
  ) THEN
    ALTER TABLE public.players
      ADD CONSTRAINT players_slowmode_range
      CHECK (slowmode_seconds >= 0 AND slowmode_seconds <= 3600);
  END IF;
END $$;

ALTER TABLE public.blocked_players
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS blocked_players_expires_idx
  ON public.blocked_players (server_id, expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE public.custom_presets
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS custom_presets_server_updated_idx
  ON public.custom_presets (server_id, updated_at DESC);

-- NOTE: applied via Supabase migration tool (tracked). Live schema_version
-- uses different columns, so no manual INSERT here.
