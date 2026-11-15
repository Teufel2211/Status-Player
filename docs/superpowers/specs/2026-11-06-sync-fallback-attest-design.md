# Design-Spezifikation: Sync-Fallback + signiertes Build-Attest

**Datum:** 2026-11-06
**Status:** Mit Nutzer abgestimmt (Chat, 2026-11-06). Entscheidungen: Fallback = Reconnect + Offline-Puffer; Echtheit = signiertes Build-Manifest + Dashboard-Check; Verhalten = Start-Hardfail + Sync-Deny.
**Betroffene Version:** 1.4.2 (auf `development`, noch nicht released)
**Branch:** `development` — Merge nach `main` nur mit ausdrücklichem Go.
**Verwandt:** `2026-10-31-schutz-kopierschutz-und-sync-code-design.md` (A1 Lizenz, A2 Build-Fingerprint, A3 Anti-Rebrand, A4 Obfuskation, Teil B Sync-Code). Dieses Dokument baut darauf auf: A2 liefert die `BUILD_ID`, dieses Attest macht sie fälschungssicher.

## Ziel

1. **Sync-Fallback:** Ein Server, dessen Dashboard kurz nicht erreichbar ist, verliert keine Änderungen und verbindet sich selbstständig wieder. Kein Admin-Eingriff, keine Datenlöschung.
2. **Echtheitsprüfung:** Das Dashboard nimmt nur Daten von einem Build an, dessen Inhalt nachweislich von uns gebaut und signiert wurde. Veränderte JARs starten nicht mehr.

## Entscheidungen des Nutzers

| Frage | Entscheidung |
|-------|--------------|
| Fallback-Umfang | Reconnect + Offline-Puffer (kein Config-Cache) |
| Puffer-Modell | Snapshot, last-write-wins (kein Event-Log) |
| Echtheits-Stufe | Signiertes Build-Manifest (Ed25519) + Dashboard-Check, kein Server-Challenge/HMAC |
| Verhalten bei Fehlschlag | Mod startet nicht (Selfcheck), Dashboard verweigert Sync (403), Mod läuft weiter und retryt |

## Nicht-Ziele

- Kein DRM, kein Schutz gegen eine **1:1-Kopie** des Original-JARs (siehe „Grenzen" — clientseitig prinzipiell nicht möglich).
- Kein Private Key im JAR, keine Lizenzierung pro Server, kein Geräte-/Hardware-Binding.
- Keine neue Sync-UI, kein Sync-Event-Log, kein Config-Cache (Einstellungen bleiben lokal).
- Keine Änderung an Dateinamen, Loader-Metadaten oder `/status version`.

---

## Teil A — Signiertes Build-Attest

### A.1 Format (zwei neue JAR-Ressourcen)

Beide Dateien liegen im JAR-Root und werden als **letzter** Schritt nach A4-Obfuskation und `stamp-build.ps1` hinzugefügt:

```
statusmod-attest.json   kanonisches JSON (UTF-8, keine BOM, keine Whitespaces außer den literalen)
statusmod-attest.sig    Base64(Ed25519-Signatur über die exakten Bytes von statusmod-attest.json)
```

```json
{
  "schema": 1,
  "build_id": "1.4.2-fabric-26.2-a1b2c3d4",
  "version": "1.4.2",
  "loader": "fabric",
  "minecraft": "26.2",
  "classes_sha256": "<hex>",
  "resources_sha256": "<hex>",
  "key_id": "2026-11",
  "issued_at": "2026-11-06T12:00:00Z"
}
```

**Hashes (kein Selbstbezug):**

- `classes_sha256` = SHA-256 über sortierte Zeilen `"<entryName>\0<sha256(dateiBytes)>\n"` aller `.class`-Entries.
- `resources_sha256` = dasselbe über alle übrigen Entries **außer** `META-INF/MANIFEST.MF`, `statusmod-attest.json` und `statusmod-attest.sig`.
- `build_id` ist **byte-identisch** zum Inhalt von `statusmod-build.txt` (Trim). Damit hängen Attest und bestehender Fingerprint zusammen.

### A.2 Erzeugung in der CI

Neues Skript `scripts/ci/sign-build.mjs` (Node, Ed25519 nativ über `crypto.sign(null, …)`):

1. JAR öffnen, `statusmod-build.txt` lesen, Hashes berechnen.
2. JSON **kanonisch** serialisieren (feste Schlüsselreihenfolge wie oben, keine Leerzeichen).
3. Signieren mit dem Private Key aus dem GitHub-Secret `STATUSMOD_ATTEST_KEY` (Base64, PKCS#8).
4. Beide Entries anhängen: bestehende Entries werden **byte-identisch** kopiert, `META-INF/MANIFEST.MF` bleibt zuerst; Local Header mit echtem CRC/Größen, General-Purpose-Flag `0x0000` (dieselbe Schreibweise wie der ZIP-Writer in `ObfuscateRemap.java`). Kein Neuschreiben/Umkomprimieren vorhandener Entries.

Position in `.github/workflows/build.yml`: **nach** `obfuscate-release.ps1`, **vor** `verify-jars.ps1`.

Der zugehörige Public Key (`key_id` → Base64) liegt im Repo in `scripts/ci/attest-keys.json` und wird von dort in `AttestKeys.java` (Mod) und in die Dashboard-Migration übernommen — eine Quelle, zwei Kopien, per Test verglichen.

### A.3 Prüfung im Mod (Start)

Neues Paket `com.teufel.statusmod.attest` mit `Attestation`, `AttestKeys`, `AttestResult`.

- JAR-Pfad über `StatusMod.class.getResource("/statusmod-attest.json")` → `JarURLConnection` (robust gegen Loader-eigene ClassLoader). Dev-Build (Verzeichnis) → `DEV`.
- Hashes über `JarFile` neu berechnen, `build_id` gegen `StatusMod.BUILD_ID` prüfen, Signatur mit dem Public Key aus `AttestKeys` (Map `key_id` → Key, mehrere Keys für Rotation) verifizieren.

| Zustand | Verhalten |
|---|---|
| keine Attest-Dateien (Dev-Build, Klassenverzeichnis) | Start ok, Log `[StatusMod] Attest: dev build (unsigned)`, Dashboard lehnt Sync ab |
| Attest vorhanden, Signatur + Hashes + `build_id` gültig | Start ok, Log `[StatusMod] Attest: verified (key 2026-11)` |
| Attest vorhanden, aber Signatur/Hash/`build_id` falsch oder `key_id` unbekannt | **Start verweigert**, wie A3: `[StatusMod] This build failed integrity verification. Refusing to start.` → `/modinfo` erklärt den Zustand |

Reihenfolge in `StatusMod.init()`: A3 `IdentityCheck` → Attest → Rest. Beide Hardfails setzen dasselbe `refused`-Flag und lassen nur `/modinfo` zu.

### A.4 Prüfung im Dashboard (Sync)

Neue Header auf **POST und GET** von `/api/players/[server_id]/sync`:

```
x-mod-attest:     base64url(statusmod-attest.json Bytes)
x-mod-attest-sig: base64(Ed25519-Signatur)
```

Neues Modul `dashboard/lib/attest.ts`:

1. Header vorhanden? Base64 dekodieren, JSON parsen (Zod: `schema`, `build_id`, `version`, `loader`, `minecraft`, `classes_sha256`, `resources_sha256`, `key_id`, `issued_at`).
2. Public Key aus Tabelle `attest_keys` (`key_id`, `active = true`) laden, Signatur über die **exakten** Bytes prüfen.
3. `build_id`-Format plausibel (`^[0-9A-Za-z.\\-]+$`, ≤ 64 Zeichen) und `schema = 1`.
4. Ergebnis:

| Ergebnis | Antwort |
|---|---|
| gültig | Sync läuft; `servers.attest_build_id`, `attest_key_id`, `attest_verified_at` werden aktualisiert |
| Attest-Header fehlen | `403 attest_required` — **außer** `servers.allow_dev_builds = true` |
| Signatur ungültig / unbekannter `key_id` / Schema falsch | `403 attest_invalid`, es wird **nichts** geschrieben |
| `allow_dev_builds = true` und Header fehlen | Sync läuft, `attest_build_id = null` (nur für Testserver) |

Der Check läuft **vor** dem Schreiben, aber **nach** `requireApiKey` (401 bleibt 401) und **nach** dem Kill-Switch-Pfad (deaktivierter Mod schreibt ohnehin nichts). `evaluateSyncCode` bleibt unverändert davor.

Das Dashboard kann die JAR-Hashes nicht nachrechnen (es hat die JAR nicht). Es prüft: „Dieser Attest-Inhalt wurde von unserem Release-Key signiert." Das erkennt selbstgebaute Fremd-JARs und gefälschte Build-IDs und hinterlässt eine Spur, blockt aber kein Replay eines echten Attests (siehe Grenzen).

### A.5 Migration `012_attest.sql`

```sql
create table if not exists attest_keys (
  key_id      text primary key,
  public_key  text not null,          -- Base64, Roh-32-Byte-Ed25519
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table servers add column if not exists attest_build_id  text;
alter table servers add column if not exists attest_key_id    text;
alter table servers add column if not exists attest_verified_at timestamptz;
alter table servers add column if not exists allow_dev_builds boolean not null default false;
```

Die Migration legt den aktuellen Key direkt an (Wert aus `scripts/ci/attest-keys.json`). Key-Rotation: neue Zeile mit neuem `key_id`, alter Key bleibt `active` bis alle Release-JARs damit ausgelaufen sind.

Kleine UI: im Server-Config-Panel eine Zeile „Mod-Build: `1.4.2-fabric-26.2-a1b2c3d4` (verifiziert am …)" plus Owner-Toggle „Dev-Builds erlauben". Kein neuer Sidebar-Eintrag.

### A.6 Grenzen (bewusst akzeptiert)

- **1:1-Kopie:** wer das Original-JAR samt Attest weitergibt, hat weiter ein gültiges Attest. Nicht verhinderbar; der eigentliche Hebel bleibt der Sync-Code (Teil B des 31.10.-Specs) und die Lizenz.
- **Replay:** ein Angreifer kann das Attest eines echten Builds mitschicken. Erkenntnisgewinn ist dann Null, aber er hat auch keinen Vorteil.
- **Patchen:** ein entschlossener Angreifer kann den Selfcheck entfernen. Das Attest erhöht den Aufwand und macht Manipulation nachweisbar, es ist kein DRM.

---

## Teil B — Sync-Fallback

### B.1 Persistenter Sync-Zustand

Der lokale JSON-Speicher ist bereits Source of Truth. Der „Puffer" ist deshalb **kein neuer Datenspeicher**, sondern persistiertes Dirty-Marking plus Fehlerzustand:

Neue Datei `sync_state.json` im Config-Ordner (gleicher Ordner wie `config.json`):

```json
{
  "pending_since": 1762345678901,
  "last_success_at": 1762345000000,
  "consecutive_failures": 3,
  "next_attempt_at": 1762345999000,
  "last_error": "network",
  "last_attest_build_id": "1.4.2-fabric-26.2-a1b2c3d4"
}
```

- Wird nur vom Sync-Thread geschrieben (kein Lock), `null`-Werte toleriert (Gson).
- Datei fehlt/kaputt → Defaults, kein Abbruch (Muster wie die übrigen Storages).
- `pending_since` wird beim ersten fehlgeschlagenen Push gesetzt (nur wenn noch leer) und bei Erfolg gelöscht.

### B.2 Fehlerklassifizierung (`push`/`pull`)

| Situation | Reaktion |
|---|---|
| `IOException`, Timeout, DNS, `5xx` | Backoff, Status `network`; nächster Versuch laut `next_attempt_at`; kein Datenverlust, nichts löschen |
| `403 sync_not_confirmed` | wie heute `repair()` (Code verwerfen, neu paaren), Zustand `repairing` |
| `403 attest_invalid` / `403 attest_required` | **kein** Repair. Sync pausiert, eine Logzeile, Retry nach 15 min. Grund: Admin muss die Mod aktualisieren oder `allow_dev_builds` setzen |
| `401` | Sync pausiert, Log „API-Key ungültig oder entfernt", Retry nach 15 min (kein Repair — ein neuer Code hilft nicht) |
| `404` | Sync pausiert, Log „Server im Dashboard nicht mehr vorhanden", Retry nach 15 min |
| `429` | Retry nach `Retry-After` (Fallback 60 s, Deckel 5 min) |
| `2xx` | `consecutive_failures = 0`, `last_success_at = now`, `pending_since = null`, `last_error = null` |

**Backoff:** `30 s → 60 s → 120 s → 240 s → 300 s` (Deckel), ±20 % Jitter. Basis bleibt `SYNC_INTERVAL_MS = 30 s`; `PULL_INTERVAL_MS = 15 s` gilt unverändert, solange kein Fehler anliegt. Nach `repair()` sofort ein voller Push.

### B.3 Push-Dirty-Fix + voller Nachhol-Push

Heute wird `pushDirty = false` **vor** dem Push gesetzt (Zeile 213) — ein fehlgeschlagener Push verliert damit seinen Trigger und wartet bis zum 30-s-Intervall. Neu:

- `pushDirty` wird erst **nach** erfolgreichem Push gelöscht; bei Fehler bleibt es gesetzt.
- Nach `pending_since != null` (also nach einem Ausfall) wird beim ersten Erfolg ein **voller** Snapshot gepusht (kein Diff/Tombstone-Verlust), zusätzlich zum normalen Push.
- Beim Serverstart immer ein voller Push (deckt Ausfälle während der Downtime ab).

### B.4 Chunking (Teil des Fallbacks)

`MAX_PLAYERS_PER_PUSH = 200` ist heute ein **stiller Deckel** (kein Chunking); die Dashboard-Schemas erlauben ebenfalls max. 200 Einträge. Ein Server mit >200 Spielern verliert beim Nachhol-Push Einträge. Darum:

- `push()` sendet in Chunks von 200 Spielern; `muted`/`blocked` werden serverseitig auf dieselben Chunks verteilt (jeder Chunk enthält nur die Einträge seiner Spieler, Tombstones einmalig im ersten Chunk).
- Ein Chunk-Fehler bricht den Zyklus ab, `pushDirty` bleibt gesetzt; bereits übertragene Chunks gelten als erfolgreich (`lastPushed*` erst am Ende des gesamten Pushs übernehmen).
- Gilt auch für den 30-s-Normalbetrieb, nicht nur für den Nachhol-Push.

### B.5 Neue Logzeilen

```
[StatusMod] Sync offline, buffering locally (attempt 3, retry in 120s)
[StatusMod] Sync restored after 4m12s
[StatusMod] Sync stopped: attest_required - update the mod or enable dev builds in the dashboard
[StatusMod] Sync stopped: API key rejected (401)
[StatusMod] Sync stopped: server not found in dashboard (404)
```

Keine Secrets, kein Sync-Code, kein API-Key in Logs (bestehende Regel).

---

## Teil C — Betroffene Dateien

**Mod (`common`)**

| Datei | Änderung |
|---|---|
| `attest/Attestation.java` (neu) | JAR öffnen, Hashes berechnen, Signatur prüfen |
| `attest/AttestKeys.java` (neu) | `key_id` → Public Key |
| `attest/AttestResult.java` (neu) | `VERIFIED` / `DEV` / `INVALID(reason)` |
| `StatusMod.java` | Attest nach `IdentityCheck`, Hardfail-Pfad, Attest-Header-Daten bereitstellen |
| `sync/SyncManager.java` | Attest-Header, `sync_state.json`, Backoff, Fehlerklassifizierung, Dirty-Fix, Chunking, Voll-Push |
| `storage/SyncState.java` (neu) | Persistenz von `sync_state.json` (Muster der übrigen Storages) |

**Scripts / CI**

| Datei | Änderung |
|---|---|
| `scripts/ci/sign-build.mjs` (neu) | Attest erzeugen + signieren, Entries anhängen |
| `scripts/ci/attest-keys.json` (neu) | `key_id` → Public Key (Quelle für Mod + Dashboard) |
| `.github/workflows/build.yml` | Sign-Schritt nach Obfuskation, Secret `STATUSMOD_ATTEST_KEY` |
| `scripts/ci/verify-jars.ps1` | beide Attest-Entries vorhanden, `.sig` nicht leer, `build_id` == `statusmod-build.txt` |
| `scripts/local/check-a4.ps1` | Attest-Entries als erlaubte Zusatz-Entries, Ressourcen-Vergleich entsprechend ausnehmen |
| `docs/RELEASE_CHECKLIST.md` | Secret + Sign-Schritt dokumentieren |

**Dashboard**

| Datei | Änderung |
|---|---|
| `lib/attest.ts` (neu) | Header parsen, Signatur prüfen, Key-Lookup |
| `app/api/players/[server_id]/sync/route.ts` | Attest-Check in POST **und** GET, `attest_*`-Spalten schreiben |
| `migrations/012_attest.sql` (neu) | Tabelle + Spalten + aktueller Key |
| `app/api/server/[server_id]/config/route.ts` | `allow_dev_builds` lesen/schreiben (Owner) |
| `app/dashboard/config/page.tsx` | Zeile „Mod-Build" + Toggle „Dev-Builds erlauben" |

---

## Teil D — Tests

**Mod / Build**
- `:common:compileJava` grün; `npm run build` grün.
- Dev-Build (Klassenverzeichnis) startet, Log `dev build`; Selfcheck blockt nicht.
- Signiertes JAR: `Attest: verified`, `/status`/Sync normal.
- Ein Byte in einer `.class`-Datei ändern → `Attest: INVALID`, Start verweigert, `/modinfo` erklärt.
- `statusmod-attest.sig` entfernt → Start verweigert (Attest unvollständig).

**Dashboard**
- Ohne Header → `403 attest_required`; mit `allow_dev_builds = true` → `200`.
- Manipulierter JSON-Inhalt bei gültiger Signatur → `403 attest_invalid`.
- Unbekannter `key_id` → `403 attest_invalid`.
- Gültig → `200`, `servers.attest_build_id` gesetzt.

**Fallback**
- Dashboard-URL auf nicht erreichbaren Host → Log `offline, buffering locally`, `sync_state.json` mit `pending_since`; nach Rückkehr `Sync restored`, voller Push, `pending_since` leer.
- Server-Neustart während „offline" → `pending_since` bleibt, nächster Start pusht voll.
- Sync-Code in der DB löschen → `403` → `repair()` → `Sync pairing restored`.
- API-Key löschen → `401` → Sync pausiert (kein Repair-Loop).
- Server in der DB löschen → `404` → Sync pausiert.
- >200 Spieler (Testdaten) → mehrere Chunks, alle Spieler im Dashboard.

**Release**
- 24 JARs: `verify-jars.ps1` + `check-a4.ps1` grün, jedes JAR hat gültiges Attest.
- Runtime-Matrix (fabric/forge/neoforge, 26.2): `RESULT: PASSED`.

---

## Reihenfolge der Umsetzung

1. **Attest-Erzeugung** — `sign-build.mjs`, `attest-keys.json`, Schlüsselpaar (Private Key als GitHub-Secret, Public Key ins Repo), CI-Schritt.
2. **Mod-Selfcheck** — `attest/*`, `StatusMod.init()`, Test mit signiertem und manipuliertem JAR.
3. **Dashboard-Check** — Migration 012, `lib/attest.ts`, Sync-Route, Config-Toggle + Anzeige.
4. **Sync-Fallback** — `SyncState`, Backoff, Fehlerklassifizierung, Dirty-Fix, Chunking.
5. **Verifikation** — `compileJava`, `npm run build`, `verify-jars.ps1`, `check-a4.ps1`, Runtime-Matrix, 24er-Release-Lauf.

Schritt 1–3 und 4 sind unabhängig; 4 kann parallel laufen.

## Changelog (unter `## 1.4.2`)

- **Added:** Signiertes Build-Attest — veränderte Builds starten nicht mehr, das Dashboard nimmt nur verifizierte Builds an.
- **Added:** Server-Config zeigt den verifizierten Mod-Build; Owner können Dev-Builds für Testserver freigeben.
- **Improved:** Sync übersteht Dashboard-Ausfälle und sendet beim Wiederverbinden den vollständigen Stand nach.
- **Improved:** Sync unterscheidet Fehlerarten (Netz, Code, Attest, API-Key, Server gelöscht) statt bei jedem `403` neu zu paaren.
- **Improved:** Push überträgt mehr als 200 Spieler (Chunking).
