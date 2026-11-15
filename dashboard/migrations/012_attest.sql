-- 012 – Signiertes Build-Attest (Status Player 1.4.2)
--
-- Jedes Release-JAR trägt zwei Root-Entries:
--   statusmod-attest.json  kanonisches JSON (build_id, Hashes, key_id, ...)
--   statusmod-attest.sig   Base64(Ed25519-Signatur über die exakten JSON-Bytes)
--
-- Der Mod schickt beides als Header bei jedem Sync-Aufruf mit
-- (x-mod-attest / x-mod-attest-sig). Das Dashboard prüft die Signatur gegen
-- die hier hinterlegten Public Keys und lehnt sonst mit 403 ab:
--   attest_required  Header fehlen (Dev-Build) und allow_dev_builds = false
--   attest_invalid   Signatur ungültig, key_id unbekannt oder Schema falsch
--
-- Das Dashboard kann die JAR-Hashes NICHT nachrechnen (es hat die JAR nicht).
-- Geprüft wird "dieser Attest-Inhalt wurde von unserem Release-Key signiert".
--
-- attest_keys.public_key = Base64 der rohen 32 Ed25519-Bytes; die Quelle ist
-- scripts/ci/attest-keys.json (Mod: AttestKeys.java, CI: sign-build.mjs).
-- Key-Rotation: neue Zeile mit neuem key_id; der alte Key bleibt active,
-- solange Release-JARs damit im Umlauf sind.

create table if not exists public.attest_keys (
  key_id      text primary key,
  public_key  text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.attest_keys enable row level security;

-- Aktueller Release-Key (2026-11). Wert identisch zu scripts/ci/attest-keys.json.
insert into public.attest_keys (key_id, public_key, active)
values ('2026-11', '9cXmjg4Nn4SoksWeNbCZi6D3HfXLaUmp0fvu9HPU0rM=', true)
on conflict (key_id) do update set public_key = excluded.public_key;

alter table public.servers
  add column if not exists attest_build_id    text,
  add column if not exists attest_key_id      text,
  add column if not exists attest_verified_at timestamptz,
  add column if not exists allow_dev_builds   boolean not null default false;

comment on column public.servers.attest_build_id is
  'Build-ID aus dem zuletzt verifizierten Attest (NULL = Dev-Build erlaubt, aber unsigniert)';
comment on column public.servers.allow_dev_builds is
  'Nur für Testserver: erlaubt Sync ohne Attest-Header (unsignierter Dev-Build)';
