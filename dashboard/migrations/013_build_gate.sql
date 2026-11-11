-- 013 - Release-Gate: Build-ID-Registry (Status Player 1.4.2)
--
-- Jedes vom CI erzeugte Release-JAR wird mit seiner Build-ID hier eingetragen.
-- Der Mod fragt beim Start, ob seine eigene ID registriert ist:
--   registriert        -> Mod startet
--   ausdruecklich neu  -> Mod startet nicht (nur /modinfo)
--   nicht erreichbar   -> Mod startet (Fail-open, siehe Spec)
--
-- Die "ID pro JAR" ist die bestehende Build-ID "<version>-<loader>-<mc>-<sha8>",
-- z. B. 1.4.2-fabric-26.2-a1b2c3d4. Verglichen wird beim Start nur die ID; die
-- Inhaltsintegritaet garantiert bereits das lokale Attest im JAR.
--
-- Befuellt wird die Tabelle ausschliesslich vom CI ueber
-- POST /api/builds/register (Bearer BUILD_REGISTRY_TOKEN + gueltige
-- Attest-Signatur). Deshalb RLS an ohne Policy (nur service_role).

create table if not exists public.builds (
  build_id         text primary key,
  version          text not null,
  loader           text not null,
  minecraft        text not null,
  classes_sha256   text not null,
  resources_sha256 text not null,
  key_id           text not null,
  registered_at    timestamptz not null default now()
);

alter table public.builds enable row level security;

comment on table public.builds is
  'Registry aller vom CI signierten Release-JARs (Build-ID je JAR)';

alter table public.servers
  add column if not exists build_check_status   text,
  add column if not exists build_check_build_id text,
  add column if not exists build_check_at       timestamptz,
  add column if not exists build_override_id    text;

comment on column public.servers.build_check_status is
  'Ergebnis der Start-Pruefung: ok | unknown | NULL (noch nie geprueft)';
comment on column public.servers.build_check_build_id is
  'Build-ID, die zuletzt geprueft wurde';
comment on column public.servers.build_override_id is
  'Manuell (nur Fleet-Admin) freigegebene Build-ID fuer genau diesen Server';

-- Freischalten darf nur das Projekt-Konto. role = "owner" genuegt nicht, weil
-- jeder Server-Owner aus dem Setup-Flow diesen Wert bekommt.
alter table public.dashboard_users
  add column if not exists is_fleet_admin boolean not null default false;

comment on column public.dashboard_users.is_fleet_admin is
  'Darf unbekannte Builds freischalten (Release-Gate). Wird manuell gesetzt.';
