# Release-Checkliste 1.4.2

Abhaken der Reihe nach. Alles auf `development` vorbereiten, erst ganz am Ende nach `main` mergen (CI feuert nur dort).

**Stand 2026-11-04:** Lizenz (A1), Build-Fingerprint (A2), Anti-Rebrand-Prüfung (A3),
Sync-Code (Teil B) und Obfuskation (A4) sind implementiert. Der Sync-Code läuft komplett
intern: das Dashboard stellt ihn beim ersten Kontakt selbst aus, der Mod übernimmt ihn
still (`sync_code_setup`) — keine Befehle, keine Dashboard-Seite, kein Admin-Eingriff.
Migration `011_server_sync_codes` ist angewendet. Die 24 Release-JARs wurden am 2026-11-03
obfuskiert, gestempelt, gespiegelt und verifiziert; nach dem Sync-Umbau (2026-11-04) müssen
sie neu gebaut werden. Offen: Tokens, Modrinth-Seite, Ingame-Abnahme, Merge nach `main`.

**A4 (Obfuskation) ist am 2026-11-03 erneut gelaufen.** ProGuard 7.10.0 erzeugt für Class-Version 69
(Java 25) defekte StackMapTable-Frames (`VerifyError: Bad type on operand stack`). Deshalb
liefert ProGuard nur noch das Klassen-Mapping; `scripts/local/ObfuscateRemap.java` (ASM 9.10.1)
wendet es auf die unveränderte Original-JAR an. Damit bleiben die Original-Frames gültig.

**ZIP-Struktur: eigener Writer statt `ZipOutputStream`.** Der erste A4-Lauf schrieb die JARs mit
`java.util.zip.ZipOutputStream`. Das setzt auf jedem Eintrag das Data-Descriptor-Flag (`0x0008`)
und lässt Größe/CRC im Local Header auf 0. Forge/NeoForge lesen Mod-JARs über `SecureJar`
(ZIP-Header strikt) und brachen damit ab:
`Failed to create secure jar ... invalid entry size (expected ... but got 25 bytes)`.
`ObfuscateRemap.java` schreibt die ZIP-Struktur deshalb selbst: Local Header mit echtem CRC-32
und echten Größen (`flag 0x0000`, UTF-8-Flag `0x0800` nur bei Non-ASCII-Namen), Central Directory
und EOCD. `stamp-build.ps1` (`ZipArchive` im Update-Modus) übernimmt vorhandene Header
unverändert, das Flag bleibt also auch nach dem Stempeln `0x0000`.

## 1. Code fertig

- [ ] Alle Features/Fixes auf `development` committet, Baum sauber (`git status` leer) — vor Commit geprüft, noch offen
- [x] `version.txt` = `1.4.2` **und** `StatusMod.VERSION` (`common/.../statusmod/StatusMod.java`) auf denselben Wert gesetzt — beide müssen identisch sein (`/status version` liest die Konstante)
- [x] `StatusMod.BUILD` = `1.4.2` (kein `dev`-Tag im Release)
- [x] `CHANGELOG.md` → `## Unreleased` in `## 1.4.2 - 2026-10-27` umbenannt (kein Fleet in sichtbaren Texten!)

## 2. Builds

- [x] Release-Builds erstellt; Forge 1.21.11 wegen Speicherlimit als Einzelbuild erstellt
- [x] Build-Ausgabe **und** isoliertes Gradle-Home liegen auf `D:\Mods\StatusMod` (C: hat nur ~3 GB frei): `-OutputDir "D:\Mods\StatusMod"`
- [x] Fabric-26.x-Builds (plain javac) schreiben nach `-OutputDir` statt immer nach `dist/multiversion`; Alt-JARs im Zielordner werden vorher gelöscht (sonst gilt ein nicht neu gebautes, evtl. schon obfuskiertes JAR als `ok`)
- [x] `.\scripts\ci\verify-jars.ps1 -DistDir "D:\Mods\StatusMod"` → **24/24 OK** (2026-11-05)
- [x] 24 × `Statusmod-<version>-<loader>-<mc>.jar` unter `D:\Mods\StatusMod\<loader>\<mc>\` (CI baut weiter nach `dist/multiversion`)
- [x] Build-Tag in allen 24 JARs geprüft (`BUILD`/`VERSION` = `1.4.2`, `BUILD_ID` vorhanden)
- [x] `statusmod-build.txt` in allen 24 JARs im Format `<version>-<loader>-<mc>-<sha8>`
- [x] Lizenz in allen 4 Metadaten-Dateien = `Status Player License 1.0`, `statusmod-license.txt` im JAR
- [x] **A4 (Obfuskation) gelaufen** — `.\scripts\local\obfuscate-release.ps1 -InputDir "D:\Mods\StatusMod" -BackupDir "D:\Mods\StatusMod-a4-backup-<ts>"`, danach `stamp-build.ps1` automatisch (Obfuskation ändert die JAR-Datei, sonst passt `sha8` nicht mehr). Build-Ordner = Mirror-Ordner, also kein zweiter Kopierschritt (Lauf 2026-11-05: 24 JARs, Backup `D:\Mods\StatusMod-a4-backup-20261105-140453`)

### 2b. A4-Details (Stand 2026-11-03)
- [x] Nur `com.teufel.statusmod.**` obfuskiert (Klassennamen); MC/Mojang/Loader/Gson/Floodgate/LuckPerms unverändert
- [x] Keep-Regeln: Loader-Entrypoints, `ClickablePlayerHeadMenu`, `StatusModAPI`, `StatusMod`, `platform.**` inkl. ServiceLoader-Impls, Gson-Modelle (`ModConfig`, `PlayerSettings`, `BlockedPlayers$BlockEntry`, `WarningStore$WarnInfo`, `ServerPresets$ServerPreset`, `CustomPresets$*`)
- [x] Keine Methoden-/Feld-Umbenennung und keine String-Verschlüsselung (bewusste Entscheidung: kein Override-/Reflection-/Gson-Risiko)
- [x] Debug-Infos entfernt: 0 × `SourceFile`, 0 × `LineNumberTable`, 0 × `LocalVariableTable` in allen 24 JARs
- [x] StackMapTable in allen 24 JARs vorhanden (57–58 von 78 Klassen mit Frames) → kein `VerifyError`
- [x] 78 eigene Klassen pro JAR (keine Klasse durch Obfuskation verloren), Metadaten/Ressourcen unverändert
- [x] ZIP-Header: alle Einträge `flag 0x0000` (kein Data Descriptor) in allen 24 JARs; `META-INF/MANIFEST.MF` ist erster Eintrag
- [x] ZIP-Validierung: 24/24 JARs lesbar über `java.util.jar.JarFile` (verify=true) mit CRC-Prüfung, 0 Abweichungen
- [x] Doppel-Obfuskations-Sperre + Backup vor Verarbeitung (`D:\Mods\StatusMod-a4-backup-20261105-140453`, ausserhalb des Input-Ordners)
- [x] SHA-256 über alle 24 JARs konsistent (Build schreibt direkt in den Mirror-Ordner, kein zweiter Abgleich nötig; `verify-jars.ps1 -DistDir` prüft die gestempelten Build-Tags)
- [x] Runtime-Test Fabric 26.2 mit obfuskiertem JAR: `RESULT: PASSED`
- [x] Runtime-Test Forge 26.2 mit obfuskiertem JAR: `RESULT: PASSED`
- [x] Runtime-Test NeoForge 26.2 mit obfuskiertem JAR: `RESULT: PASSED`
- [x] CI obfuskiert ebenfalls: `scripts/ci/fetch-proguard.ps1` (SHA-256-gepinnt) + `obfuscate-release.ps1` laufen im Workflow **vor** `verify-jars.ps1` → Publish liefert obfuskierte JARs, nicht den Roh-Build

## 3. Tests

- [ ] CI-Runtime-Matrix grün (alle Loader × alle MCs, MP-only auf Push) — läuft erst nach dem Merge
- [ ] Ingame-Test (Befehle, GUI-Klicks, Inventar prüfen) — **brauchst du**
- [ ] Kill-Switch pro Server + global: `/status` verschwindet, `/modinfo` zeigt „deaktiviert", Status/Badge weg, Re-Enable binnen 15 s ohne Neustart — **brauchst du**
- [x] Dashboard-Build grün: `npm run build --prefix dashboard`

### 3b. Schutzfunktionen (1.4.2 neu)

- [ ] Anti-Rebrand: Test-JAR mit geänderter `fabric.mod.json`-Mod-ID → Start bricht ab, Logzeile `This build has been modified or rebranded. Refusing to start.`, `/modinfo` erklärt den Zustand
- [ ] Sync-Paarung (intern, ohne Befehl): Server ohne Code bekommt beim ersten Pull automatisch einen Code (`[StatusMod] Sync code adopted from dashboard.`) und synct weiter — **kein Ausfall**
- [ ] Neuer Server (auch nach `2026-11-01`): erste Anfrage ohne Code → Dashboard stellt Code aus (`sync_code_setup`), Mod übernimmt ihn still, Push läuft danach
- [ ] Kein `/status sync …` mehr vorhanden (Sync-Status steht in `/status config show` / Log)
- [ ] Dashboard hat keine Sync-Seite mehr (Sidebar ohne „Sync"), `/api/server/[server_id]/sync-code` ist weg
- [ ] Nach Reset der Server-Daten im Dashboard: Mod bekommt `403` → Log `Sync pairing lost, re-pairing automatically` → holt sich automatisch einen neuen Code
- [ ] `dashboardUrl` hat keinen Default mehr — frische Installation synct erst nach Eintrag der URL

## 4. Tokens & Secrets

- [ ] `.\scripts\ci\check-release-tokens.ps1` → Exit 0 (inkl. Modrinth-Auth via GET /user). ACHTUNG: `$env:`-Tokens gelten nur pro PowerShell-Sitzung — vor Publish neu setzen + Check erneut laufen lassen!
  - **Blockiert (2026-10-27):** `MODRINTH_TOKEN` = HTTP 401, `CURSEFORGE_API_KEY` = HTTP 403
- [ ] CI-Secrets prüfen (GitHub → Settings → Secrets → Actions): `MODRINTH_TOKEN`, `MODRINTH_PROJECT_ID`, `CURSEFORGE_TOKEN`, `CURSEFORGE_PROJECT_ID` — **brauchst du**
- [x] Keine *neuen* Secrets im Diff

## 5. Dashboard live

- [ ] `vercel deploy --prod` — **zwingend vor dem Mod-Rollout** (das neue Dashboard stellt den Sync-Code ohne Code-Anfrage aus; der alte Stand antwortet sonst `403`)
- [x] `/api/health` → `healthy`, `database: connected`, `previous_secret_active: false`
- [x] Migration `011_server_sync_codes` angewendet (6 Spalten auf `public.servers`, Bestandszeilen unverändert)
- [ ] Login + Owner-Login einmal durchspielen — **brauchst du**
- [ ] Config-Pull auf Testserver prüfen — **brauchst du**
- [ ] Sync ohne Eingriff prüfen: Testserver mit neuem JAR synct ohne Code-Befehl, Dashboard zeigt Spieler — **brauchst du**

## 6. Offenlegung (Modrinth, vor Upload!)

- [ ] Projektseite: Icon aktuell, Beschreibung aktuell — **brauchst du**
  - Body enthält noch drei alte `Teufel2211/StatusMod`-Links (Token ungültig, daher manuell ersetzen)
- [x] Disclosure **"Contains AI-generated content"** gesetzt
- [ ] Disclosure **"Contains telemetry"** gesetzt (bleibt seit 1.4.0 bestehen, trotzdem verifizieren) — **brauchst du**
- [x] README/Modrinth-Seitentext ohne "No telemetry"-Versprechen (README nennt jetzt die synchronisierten Daten)

## 7. Merge + Publish

- [ ] `development` → `main` mergen (kein Push ohne Go!)
- [ ] CI-Workflow grün (Build + Verify + Runtime-Tests)
- [ ] Publish per `force_publish`-Dispatch anstoßen (nötig, da version.txt oft unverändert bleibt)
- [ ] Modrinth: Uploads sichtbar (24 Gruppen), Version freigegeben
- [ ] CurseForge: Dateien da, Freigabe abwarten
- [ ] GitHub Release angelegt (Changelog aus CHANGELOG.md, alle 24 JARs)
- [x] Fleet NICHT im Release (`dist/multiversion` enthält 0 Fleet-JARs; Guard in `publish-all.ps1` bleibt)

**Wichtig vor dem Publish:** CI und lokaler Lauf obfuskieren jetzt identisch. Der Workflow lädt
die ProGuard-Toolchain über `scripts/ci/fetch-proguard.ps1` (SHA-256-gepinnt) und ruft
`obfuscate-release.ps1` **vor** `verify-jars.ps1` auf — Verify, Runtime-Tests und Publish sehen
also dieselben obfuskierten JARs wie der lokale D:-Lauf. Die Backup-Kopie landet unter
`$RUNNER_TEMP\a4-backup` und zählt deshalb nicht als zusätzliches Release-JAR.

## 8. Danach

- [ ] Testserver + Nitrado auf neue JARs aktualisieren + Neustart — lokal erledigt (25566 läuft `build 1.4.2`)
- [ ] Modrinth-Profile registrieren (`scripts/local/register-modrinth-content.ps1`, App vorher schließen!)
- [ ] Diese Datei fürs nächste Release zurücksetzen (Haken raus)
