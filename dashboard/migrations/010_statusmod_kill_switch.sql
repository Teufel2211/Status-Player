-- 010 – StatusMod Kill-Switch (StatusMod 1.4.2)
--
-- Der Fleet-Owner kann StatusMod pro Server und global deaktivieren.
-- Effektiv aktiv ist der Mod nur, wenn BEIDE Flags true sind.
--
-- servers.mod_enabled       = Schalter auf der Serverkarte
-- fleet_config.mod_enabled  = globaler Schalter (Zeile id = 1)
--
-- Der Mod liest den Effektivwert ueber GET /api/players/<server_id>/sync
-- und pollt weiter, damit ein Re-Enable ohne Serverneustart greift.

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS mod_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.fleet_config
  ADD COLUMN IF NOT EXISTS mod_enabled boolean NOT NULL DEFAULT true;
