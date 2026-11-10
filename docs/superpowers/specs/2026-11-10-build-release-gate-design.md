# Design-Spezifikation: Release-Gate (Build-ID-Registry)

Stand: 2026-11-10
Status: freigegeben (Entwurf vom Nutzer bestätigt)

## Ziel

Jedes vom CI erzeugte Release-JAR bekommt eine ID, die in Supabase steht. Der
Mod prüft diese ID bei jedem Start:

- ID registriert -> Mod startet normal.
- ID ausdrücklich unbekannt -> Mod startet nicht (wie heute bei fehlgeschlagener
  Anti-Rebrand-Prüfung: nur `/modinfo`, keine Commands, kein Sync).
- Prüfung nicht möglich (kein Netz, Dashboard down) -> Mod startet trotzdem.
- Erfolg ist in der Konsole **stumm**, nur ein Fehlschlag wird gemeldet.
- Bei Fehlschlag erscheint eine Meldung im Dashboard mit einem Knopf, der genau
  diesen Build für genau diesen Server freischaltet.

Der Start darf nicht dauerhaft langsamer werden: die Prüfung läuft nur beim
ersten Start einer neuen Build-ID, danach entscheidet ein lokaler Cache in
Millisekunden ohne Netzwerkzugriff.

## Entscheidungen des Nutzers

1. **Blockierend + lokaler Cache.** Erster Start eines neuen Builds prüft einmal
   (einmalig ~150-500 ms, harte Obergrenze 2 s). Jeder weitere Start kostet 0 ms.
2. **Nur bei klarem "unbekannt" blockieren.** Netzwerkfehler, Timeout und 5xx
   lassen den Mod starten (Fail-open). Ein Vercel-Ausfall darf nicht alle Server
   lahmlegen.
3. **Freischaltung pro Server, nur dieser Build.** Kein globales Nachtragen, kein
   Toggle für alle unbekannten Builds.
4. **Neue Mod-Version = neue ID = neue Prüfung.** Der Cache ist an die Build-ID
   gebunden. Nur Treffer aus der Registry werden gecacht; ein nur manuell
   freigegebener Build wird bei jedem Start erneut geprüft, damit ein Zurückziehen
   der Freigabe sofort greift.

## Nicht-Ziele

- Kein zusätzliches Gate beim Sync. Der Sync prüft weiterhin nur das Attest.
- Keine globale "Build nachtragen"-Funktion im Dashboard.
- Keine Sperrlisten-Oberfläche. Ein Build verschwindet aus der Registry, wenn die
  Zeile gelöscht wird.
- Keine Änderung an Attest-Format, Signatur, Obfuskation (A4) oder `verify-jars`.
- Keine Prüfung im Client / Singleplayer. Nur Dedicated Server.

## Teil A - Registry in Supabase

### A.1 Tabelle `builds`

Die "ID pro JAR" ist die bereits existierende Build-ID
(`<version>-<loader>-<mc>-<sha8>`, z. B. `1.4.2-fabric-26.2-a1b2c3d4`). Pro
Loader/MC/Version ist sie eindeutig; eine neue Version erzeugt automatisch eine
neue ID. Es wird keine zusätzliche UUID erfunden.

| Spalte | Typ | Zweck |
|---|---|---|
| `build_id` | `text primary key` | die ID |
| `version` | `text not null` | z. B. `1.4.2` |
| `loader` | `text not null` | `fabric` / `forge` / `neoforge` / `quilt` |
| `minecraft` | `text not null` | z. B. `26.2` |
| `classes_sha256` | `text not null` | aus dem signierten Attest, nur Dokumentation |
| `resources_sha256` | `text not null` | dito |
| `key_id` | `text not null` | welcher Release-Key signiert hat |
| `registered_at` | `timestamptz not null default now()` | Zeitpunkt des CI-Uploads |

RLS wird aktiviert, ohne Policy (Projektmuster: Zugriff ausschließlich über
`service_role`).

**Verglichen wird beim Prüfen nur `build_id`, nicht die Hashes.** Die
Inhaltsintegrität garantiert bereits das lokale Attest (Signatur + Hash über alle
Entries). Ein Hash-Vergleich auf dem Server würde bei einem nicht-deterministischen
Rebuild alte, bereits verteilte JARs grundlos sperren.

### A.2 Spalten auf `servers`

| Spalte | Typ | Zweck |
|---|---|---|
| `build_check_status` | `text` | `ok` oder `unknown`; `NULL` = noch nie geprüft |
| `build_check_build_id` | `text` | welche ID zuletzt geprüft wurde |
| `build_check_at` | `timestamptz` | wann zuletzt geprüft wurde |
| `build_override_id` | `text` | manuell freigegebene Build-ID (nur diesen Server) |

`build_override_id` ist bewusst ein Einzelwert und keine Liste: pro Server läuft
genau ein Build.

### A.3 Migration `013_build_gate.sql`

Enthält Tabelle, Spalten (alle `if not exists`), Kommentare und das
`enable row level security`. Anwendung über das Supabase-Tool auf
`ujksgdbfczbgtifiovuw`, danach Verifikation der Spalten.

## Teil B - CI: Registry befüllen

### B.1 Neues Skript `scripts/ci/register-builds.mjs`

- Aufruf: `node scripts/ci/register-builds.mjs --dir dist/multiversion`
  (optional `--url` für lokale Tests, Default `https://statusmod-dashboard.vercel.app`).
- Sammelt alle `Statusmod-*.jar`, liest aus jedem JAR die Entries
  `statusmod-attest.json` und `statusmod-attest.sig`.
- Die ZIP-Lese-Logik wird aus `sign-build.mjs` in ein gemeinsames Modul
  `scripts/ci/lib/zip.mjs` gezogen (readZip/entryContent); `sign-build.mjs` und
  `register-builds.mjs` importieren es, statt den Code zu duplizieren.
- POSTet pro JAR `{ attest: <base64url der JSON-Bytes>, sig: <base64> }`.
- 3 Versuche mit Backoff (2 s, 6 s). Am Ende: Zusammenfassung
  `[registry] 24/24 JARs registriert` oder Exit 1 mit den fehlgeschlagenen IDs.
- Idempotent: ein erneuter Lauf überschreibt dieselbe Zeile.

### B.2 Dashboard-Route `POST /api/builds/register`

- Auth: `Authorization: Bearer <BUILD_REGISTRY_TOKEN>`, Vergleich in konstanter
  Zeit (`crypto.timingSafeEqual`), fehlendes/abweichendes Token -> 401.
- Prüft die Ed25519-Signatur gegen `attest_keys` (dieselbe Logik wie beim Sync,
  dafür wird `verifyAttest` in eine stringbasierte Variante
  `verifyAttestStrings(sb, attestHeader, sigHeader)` umgebaut; die bestehende
  Request-Variante ruft sie nur noch auf).
- Upsert auf `builds` mit `onConflict: "build_id"`.
- Antworten: 200 `{ ok: true, build_id }`, 400 `{ error: "invalid_attest", reason }`,
  401 `{ error: "unauthorized" }`, 503 bei DB-Fehler.
- Rate-Limit wie die anderen Schreibrouten.

### B.3 Workflow `build.yml`

Neuer Schritt **zwischen "Verify JARs" und "Upload JARs"** (also nach dem
Signieren, vor Runtime-Tests und Publish):

```yaml
- name: Register builds (Supabase)
  shell: pwsh
  env:
    STATUSMOD_BUILD_TOKEN: ${{ secrets.STATUSMOD_BUILD_TOKEN }}
  run: |
    if (-not $env:STATUSMOD_BUILD_TOKEN) { throw "STATUSMOD_BUILD_TOKEN secret is not set" }
    node scripts/ci/register-builds.mjs --dir dist/multiversion
```

Damit kann kein Build veröffentlicht werden, dessen ID nicht in der Registry
steht.

### B.4 Neue Secrets / Env

| Ort | Name | Inhalt |
|---|---|---|
| GitHub Secret | `STATUSMOD_BUILD_TOKEN` | langes Zufallstoken |
| Vercel Env (Production) | `BUILD_REGISTRY_TOKEN` | identischer Wert |

Der Supabase-Service-Role-Key bleibt aus der CI heraus: das CI-Token darf nur
Builds eintragen, nicht die Datenbank lesen.

## Teil C - Mod-Startprüfung

### C.1 Neue Klasse `common/.../attest/BuildGate.java`

Zustände: `ALLOW` (Cache-Treffer), `ALLOW_REGISTERED` (200, registriert),
`ALLOW_OVERRIDE` (200, nur manuell freigegeben), `DENY` (unbekannt), `OPEN`
(Netzfehler/Timeout/5xx), `SKIP` (nicht anwendbar).

### C.2 Entscheidungstabelle

| Situation | Ergebnis | Mod-Verhalten |
|---|---|---|
| kein verifiziertes Attest (Dev-Build) | SKIP | startet wie heute, still |
| kein Dedicated Server | SKIP | startet, still |
| `serverId` oder `apiKey` leer | SKIP | startet, still |
| Cache-Datei enthält aktuelle Build-ID | ALLOW | startet, **0 ms, still** |
| HTTP 200 `status=ok` | ALLOW_REGISTERED | startet, still, **Cache schreiben** |
| HTTP 200 `status=override` | ALLOW_OVERRIDE | startet, still, **kein Cache** |
| HTTP 403 `build_unknown` | DENY | **startet nicht**, eine Fehlerzeile |
| Timeout / IO / 5xx / 429 / anderes 4xx | OPEN | startet, eine Warnzeile |

### C.3 Cache

- Datei: `config/statusmodfleet/build-gate.txt` (neben `config.json`).
- Inhalt: die Build-ID als eine Zeile. Schreiben atomar (Temp-Datei + Move, wie
  `ModConfig.save()`), Lesen mit Größendeckel (256 Zeichen).
- Nur `ALLOW_REGISTERED` schreibt den Cache. `ALLOW_OVERRIDE`, `DENY` und `OPEN`
  schreiben nichts. So wird ein nur manuell freigegebener Build bei jedem Start
  erneut geprüft und ein Zurückziehen der Freigabe greift sofort.
- Ein Wechsel der Build-ID (neue Version, anderer Loader, andere MC-Version)
  invalidiert den Cache automatisch.

### C.4 Netzwerk

- `POST {dashboardUrl}/api/builds/check`
- Header: `x-mod-attest`, `x-mod-attest-sig` (identisch zum Sync) und
  `x-api-key` (falls vorhanden).
- Timeouts: 1,5 s Connect, 2 s Request. Keine Wiederholung (Fail-open).
- Eigener `HttpClient`, kein Teilen mit `SyncManager`.

### C.5 Ausgabe

- Erfolg (Cache, 200): **keine Ausgabe.**
- `DENY`: genau zwei Zeilen im bestehenden Stil, z. B.
  `[StatusMod] This build is not registered. Refusing to start.` und
  `[StatusMod] Reason: build_unknown - run /modinfo for details.`
- `OPEN`: eine Zeile, z. B. `[StatusMod] Build check skipped: dashboard unreachable.`
- Die bisherige Erfolgszeile `[StatusMod] Attest: verified ...` entfällt. Der
  Zustand bleibt über `/modinfo` sichtbar.

### C.6 Verdrahtung in `StatusMod.init()`

Neue Reihenfolge:

1. `IdentityCheck` (unverändert)
2. `Attestation.result()` (unverändert; `INVALID` -> `refused`)
3. `PlatformServices.getPlatform()`
4. `ModConfig.load()`
5. **`BuildGate.check(config, platform)`** -> bei `DENY` `refused = true` und
   `return` (vor jeder Registrierung)
6. bisheriger Rest (Storages, `SetupManager`, `SyncManager.start()`)

Weil die Loader-Entrypoints `StatusMod.isRefused()` vor der Registrierung von
Commands, Events und Sync abfragen, ist "startet nicht" wörtlich erfüllt - es
wird nichts registriert außer `/modinfo`.

### C.7 Dashboard-Meldung ohne zweiten Aufruf

Die Check-Anfrage trägt bereits die `x-api-key`. Das Dashboard schreibt bei
jeder Prüfung `build_check_status`, `build_check_build_id` und `build_check_at`
auf die Server-Zeile. Ein separater "Fehler melden"-Aufruf entfällt damit. Hat
der Server noch keinen API-Key (nicht gepaart), gibt es keine Dashboard-Meldung -
dann ist der Server ohnehin noch nicht eingerichtet.

## Teil D - Dashboard: Prüf-Route, Meldung, Freischaltung

### D.1 `POST /api/builds/check`

- Header: `x-mod-attest`, `x-mod-attest-sig`, optional `x-api-key`.
- Attest fehlt -> 403 `{ error: "attest_required" }`.
- Attest ungültig -> 403 `{ error: "attest_invalid", reason }`.
- `build_id` in `builds` vorhanden -> 200 `{ status: "ok" }`.
- Nicht vorhanden, aber `servers.build_override_id == build_id` -> 200
  `{ status: "override" }`.
- Sonst -> 403 `{ error: "build_unknown" }`.
- Wird ein Server über `x-api-key` erkannt, werden die drei `build_check_*`-Spalten
  geschrieben - bei `ok`, `override` **und** `build_unknown`. Ohne diesen Schreib
  bei `build_unknown` gäbe es keine Dashboard-Meldung. Bei `attest_required` /
  `attest_invalid` wird nichts geschrieben (das ist ein Attest-Fehler, kein
  Registry-Befund), und auch sonst keine anderen Spalten angefasst.
- Rate-Limit pro IP (10/min), damit die öffentliche Route nicht als Orakel dient.
  Ein 429 darf den Mod nie blockieren (siehe C.2).
- Die Route ist absichtlich öffentlich (ohne API-Key nutzbar): ein noch nicht
  gepaarter Server muss die Prüfung trotzdem durchlaufen können.

### D.2 Owner-Karte "Mod-Build" (`dashboard/app/dashboard/page.tsx`)

Neue Zeile **"Start-Prüfung"**:

| Zustand | Anzeige |
|---|---|
| `build_check_status = ok` | grün "geprüft" + Build-ID + Zeit |
| `build_check_status = unknown` | rot: "Dieser Build steht nicht in der Registry. Der Mod startet auf diesem Server nicht." + Knopf **"Diesen Build freischalten"** |
| `NULL` | neutral "noch keine Prüfung" |

Ist `build_override_id` gesetzt und gleich der geprüften ID, zeigt die Karte
"manuell freigegeben" plus **"Freigabe zurückziehen"**. Der Knopf ist nur für
`role === "owner"` sichtbar und aktiv.

### D.3 Erweiterung `PUT /api/server/[server_id]/build`

Bestehende Route, Body wird eine Union:

- `{ "allow_dev_builds": boolean }` (wie heute)
- `{ "build_override": "<build_id>" | null }` (neu: setzen / zurückziehen)

Beides nur `role === "owner"` und eigene `server_id`. Zwei Audit-Einträge:
`build_override_set`, `build_override_cleared`. Ungültige Kombination -> 400.

### D.4 Grenze (bewusst akzeptiert)

Im Fail-open-Fall (`OPEN`) kann der Mod die Prüfung nicht melden; die Karte zeigt
dann weiter den letzten bekannten Stand. Der Server läuft ja - es gibt nichts zu
entscheiden. Deshalb gibt es keinen "keine Rückmeldung"-Zustand.

## Teil E - Fehlerfälle

| Fall | Mod | Dashboard | Lösung |
|---|---|---|---|
| Build nicht in `builds` | startet nicht | rot + Knopf | Build freischalten (pro Server) oder Registry-Eintrag reparieren |
| Registry-Eintrag versehentlich gelöscht | startet nicht (nach Cache-Miss) | rot + Knopf | Freischalten oder CI-Schritt erneut laufen lassen |
| Dashboard/Netz weg | startet (Warnzeile) | letzter Stand | nichts nötig |
| Vercel-Kaltstart > 2 s | startet (Warnzeile) | letzter Stand | nichts nötig |
| Freigabe zurückgezogen | startet beim nächsten Neustart nicht mehr | rot + Knopf | erneut freischalten oder registrierten Build installieren |
| Dev-Build (unsigniert) | startet | Sync weiterhin über `allow_dev_builds` | unverändert |
| Server noch nicht gepaart | startet | keine Meldung möglich | Setup abschließen |

## Teil F - Betroffene Dateien

Neu:

- `dashboard/migrations/013_build_gate.sql`
- `dashboard/app/api/builds/register/route.ts`
- `dashboard/app/api/builds/check/route.ts`
- `scripts/ci/lib/zip.mjs`
- `scripts/ci/register-builds.mjs`
- `common/src/main/java/com/teufel/statusmod/attest/BuildGate.java`

Geändert:

- `dashboard/lib/attest.ts` (`verifyAttestStrings`, `verifyAttest` ruft sie auf)
- `dashboard/app/api/server/[server_id]/build/route.ts` (Override-Aktionen)
- `dashboard/app/dashboard/page.tsx` (Start-Prüfung + Knöpfe)
- `dashboard/lib/env.ts` (`BUILD_REGISTRY_TOKEN`)
- `.github/workflows/build.yml` (Register-Schritt)
- `common/.../StatusMod.java` (Reihenfolge + `BuildGate`)
- `common/.../command/ModInfoCommand.java` (Build-Prüfung anzeigen)
- `CHANGELOG.md`, `docs/RELEASE_CHECKLIST.md`, `AGENTS.md`

## Teil G - Tests

Lokal verifizierbar:

1. `:common:compileJava` -> Exit 0.
2. `npm run build` (mit `NODE_OPTIONS=--max-old-space-size=4096`) -> Exit 0, beide
   neuen Routen im Build-Output.
3. `lib/attest.ts`-Test (bestehender Node-Harness) um `verifyAttestStrings`
   erweitern: gültig, fehlend, manipulierte Signatur, unbekannter Key.
4. `register-builds.mjs` gegen einen lokalen Stub-Server: Payload korrekt,
   Retry bei 500, Exit 1 bei Dauerfehler.
5. Signiertes Test-JAR (Temp-Key, wie beim Attest-Test) -> Eintrag in `builds`,
   danach Check-Antwort 200; Zeile löschen -> 403 `build_unknown`. Für den Test
   wird der Temp-Public-Key kurz in `attest_keys` eingetragen und danach wieder
   entfernt (die Register-Route prüft gegen diese Tabelle).

Auf dem Testserver (nach Deploy + registriertem Build):

6. Erster Start -> Karte zeigt `ok`, Cache-Datei existiert, **keine neue
   Konsolenzeile**.
7. Zweiter Start mit blockiertem Dashboard (`dashboardUrl` auf ungültigen Host) ->
   Start in gewohnter Zeit, Cache-Treffer, keine Netzwerkabfrage.
8. Zeile aus `builds` löschen -> Start verweigert (2 Zeilen), Karte rot, Knopf
   freischalten -> Neustart läuft, Karte zeigt "manuell freigegeben".
9. Freigabe zurückziehen + Cache-Datei löschen -> Start wieder verweigert.
10. Neue Version einspielen -> Cache-Miss, eine Prüfung, danach 0 ms.

## Reihenfolge der Umsetzung

1. Migration `013` + `verifyAttestStrings` + `/api/builds/register` +
   `/api/builds/check`.
2. `register-builds.mjs` + Workflow-Schritt.
3. `BuildGate.java` + Verdrahtung + `ModInfoCommand`.
4. Dashboard-Karte + `PUT`-Erweiterung + Audit.
5. Doku (CHANGELOG, Release-Checkliste, AGENTS.md).
6. Verifikation, Commit + Push auf `development`.

## Changelog (unter `## 1.4.2`)

```markdown
### Added
- Release-Gate: Jedes CI-JAR wird mit seiner Build-ID in der Registry
  eingetragen; der Mod prüft die ID beim Start und verweigert den Start bei
  unbekannten Builds.
- Dashboard: Start-Prüfung in der Owner-Übersicht, inklusive manueller
  Freischaltung pro Server.

### Changed
- Die Attest-Erfolgsmeldung im Serverstart entfällt; Zustand steht in `/modinfo`.
```
