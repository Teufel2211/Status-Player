# Design-Spezifikation: `/bug` → Dashboard-Posteingang

**Datum:** 2026-10-18
**Status:** Mit Nutzer abgestimmt (Chat, 2026-10-18: „das passt"). Ersetzt den GitHub-Issue-Ansatz (uncommittet).
**Betroffene Version:** 1.4.2 (auf `development`)

> **Nachtrag 2026-10-19 (Dashboard-Redesign):** Der Posteingang lebt jetzt **nur noch im Admin-Dashboard** (`/admin-dashboard/bugs`, owner-only, alle Server). Die frühere Seite `/dashboard/bugs` samt Server-Session-Routen (`GET/PATCH/DELETE /api/bug-reports/[server_id]…`) wurde entfernt; neu sind `GET /api/bug-reports` (alle Server, owner-only) und `PATCH/DELETE /api/bug-reports/[id]` (owner-only). `POST /api/bug-report` (Mod) ist unverändert. Passagen unten, die den Posteingang im normalen Dashboard verorten, sind damit überholt.

## Ziel

Ingame-Bug-Meldungen (`/bug <text>` im Mod) landen **privat im Dashboard** des jeweiligen Servers statt als öffentliches GitHub-Issue. Kein `GITHUB_TOKEN`/`GITHUB_REPO` nötig, keine Profildaten in öffentlichen Repos. Der Server-Admin bekommt einen Posteingang im Dashboard.

## Ablauf

1. Spieler: `/bug <text>` — unverändert: Feature-Toggle `bug` (Default an), 10–1500 Zeichen, 10-Minuten-Cooldown pro Spieler (in-memory), für alle Spieler ohne Permission-Gate.
2. Mod POSTet an `/api/bug-report` (Header `x-api-key`, Scope `check`, Key an `server_id` gebunden). Payload: `server_id`, `uuid`, `player`, `text`, `mod_version`, `mc_version`, `loader`. Die `uuid` dient ausschließlich als Rate-Limit-Schlüssel und wird **nicht gespeichert**.
3. Dashboard validiert, prüft Rate-Limit, speichert in Tabelle `bug_reports` (Supabase, Service-Role).
4. Antwort `{ok:true}` (HTTP 201). Mod zeigt im Chat: „Danke! Deine Bug-Meldung ist angekommen." — ohne Issue-Link.

## Supabase

Migration `dashboard/migrations/006_bug_reports.sql` (angewendet via Supabase-Migrationstool, Projekt `ujksgdbfczbgtifiovuw`):

```sql
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
```

## API

Alle Routen unter `dashboard/app/api/bug-reports/` (Dashboard) bzw. `bug-report/` (Mod):

| Route | Methode | Auth | Zweck |
|-------|---------|------|-------|
| `/api/bug-report` | POST | Mod-API-Key (`check`, server-gebunden) | Meldung speichern. Rate-Limit `bugreport:<server>:<uuid>` 3/10 min. Erfolg 201 `{ok:true}`. Insert-Fehler → 502. Meldetext nie loggen (PII). |
| `/api/bug-reports/[server_id]` | GET | Session (`server_id` muss matchen) | Liste, neueste zuerst, `LIMIT 500`. Antwort `{reports:[{id, player, text, mod_version, mc_version, loader, resolved, created_at, resolved_at}]}`. |
| `/api/bug-reports/[server_id]/[id]` | PATCH | Session (`server_id` muss matchen) | Body `{resolved: boolean}` → `resolved` + `resolved_at` setzen. Nicht gefunden → 404. |
| `/api/bug-reports/[server_id]/[id]` | DELETE | Session (`server_id` muss matchen) | Meldung löschen (DSGVO). Nicht gefunden → 404. |

Validierung: bestehendes `BugReportSchema`; neu `BugReportUpdateSchema` (`resolved: z.boolean()`); `:id` = positive Ganzzahl.

## Dashboard-UI

- Neue Seite `app/dashboard/bugs/page.tsx` (Titel „Bug-Meldungen"), Sidebar-Eintrag nach „Spieler". Stil wie Audit-Seite (CSS-Variablen, dark/light, `apiFetch`).
- Kopfzeile: „X Meldungen · Y offen".
- Liste: Datum, Spieler, `MC / Mod / Loader`, Meldetext (voll, umgebrochen), Status-Badge offen/erledigt, Buttons „Erledigt"/„Wieder öffnen" + „Löschen" (mit Bestätigung).
- Leerer Zustand: Hinweistext.

## Mod (Common)

- `BugCommand.deliver()`: Erfolg = HTTP 2xx mit `ok` → Bestätigung ohne Issue-Zeile. Fehlerpfade (401/403, 429, 503, Netzwerk, andere HTTP) bleiben unverändert.
- Sende-Meldung: „Bug-Meldung wird gesendet..." — der heute eingefügte Zusatz „(öffentliches GitHub-Issue)" entfällt wieder.

## Cleanup (GitHub-Weg vollständig raus)

- `dashboard/lib/env.ts`: `GITHUB_TOKEN`, `GITHUB_REPO` entfernen.
- `dashboard/.env.example`: beide Zeilen entfernen.
- `dashboard/lib/response.ts`: `serviceUnavailable()` entfernen, falls nach dem Umbau ohne Aufrufer (Tot-Code-Policy); `badGateway()` bleibt (Insert-Fehler).
- `docs/dashboard-plan.md`: Env-Block (GITHUB-Zeilen) raus; API-Tabellen-Zeile auf „Ingame-Bugmeldung → Dashboard-Posteingang"; Rate-Limit-Zeile bleibt.
- `dashboard/app/datenschutz/page.tsx`: Abschnitt 3.5 umschreiben — Speicherung im Dashboard, sichtbar für Admins des Servers, nicht öffentlich; GitHub-Satz in Abschnitt 5 entfernen.
- `wiki/Commands.md`: `/bug`-Zeile ohne GitHub-Erwähnung.
- `CHANGELOG.md`: Unreleased-Eintrag auf Dashboard-Posteingang umformulieren.
- `SECURITY.md` bleibt unangetastet (dortiges `GITHUB_TOKEN` = CI-Token, anderes Thema).

## Nicht-Ziele (YAGNI)

- Kein GitHub-Issue — auch nicht optional.
- Kein Unread-Badge in der Sidebar, keine Kommentare/Antworten, keine Discord-Benachrichtigung, kein serverübergreifender Posteingang.
- Keine Änderungen an Rate-Limits, Cooldown oder Zeichenlimits.

## Testkriterien

- `:common:compileJava` grün; `npm run build` (Dashboard, `NODE_OPTIONS=--max-old-space-size=4096`) grün.
- Dev-Server: `/bug` → Eintrag in `bug_reports`, Chat-Bestätigung, kein GitHub-Aufruf.
- Dashboard: Meldung sichtbar, Erledigt-Toggle, Löschen funktioniert; fremde `server_id` → 401.
- Betrieb ohne `GITHUB_*`-Env-Vars fehlerfrei (Schema verlangt sie nicht mehr).
- Rate-Limit (3/10 min) + Mod-Cooldown (10 min) weiter wirksam.
