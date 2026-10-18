-- Bug-Posteingang: Ingame-Meldungen (/bug im Mod) landen im Dashboard des Servers.
CREATE TABLE IF NOT EXISTS bug_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id uuid NOT NULL,
  player text NOT NULL,
  text text NOT NULL,
  mod_version text NOT NULL DEFAULT '',
  mc_version text NOT NULL DEFAULT '',
  loader text NOT NULL DEFAULT '',
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS bug_reports_server_created_idx ON bug_reports (server_id, created_at DESC);
ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;

-- NOTE: applied via Supabase migration tool (tracked). Live schema_version
-- uses different columns, so no manual INSERT here.
