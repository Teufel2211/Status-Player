# Release-Checkliste 1.4.2

Abhaken der Reihe nach. Alles auf `development` vorbereiten, erst ganz am Ende nach `main` mergen (CI feuert nur dort).

**Stand 2026-11-01:** Lizenz (A1), Build-Fingerprint (A2), Anti-Rebrand-PrÃ¼fung (A3)
und Sync-BestÃ¤tigungscode (Teil B) sind implementiert; Dashboard inkl. `/dashboard/sync`
ist live, Migration `011_server_sync_codes` ist angewendet. Alle 24 Release-JARs sind
gebaut, nach `D:\Mods\StatusMod` gespiegelt und verifiziert.
Offen: Tokens, Modrinth-Seite, Ingame-Abnahme, Merge nach `main`.

**A4 (ProGuard-Obfuskation) ist bewusst auf â€žnach dem Release" verschoben** â€” eigener
Schritt mit `scripts/local/obfuscate-release.ps1`, sobald der Nutzer das Go gibt.

## 1. Code fertig

- [ ] Alle Features/Fixes auf `development` committet, Baum sauber (`git status` leer) â€” vor Commit geprÃ¼ft, noch offen
- [x] `version.txt` = `1.4.2` **und** `StatusMod.VERSION` (`common/.../statusmod/StatusMod.java`) auf denselben Wert gesetzt â€” beide mÃ¼ssen identisch sein (`/status version` liest die Konstante)
- [x] `StatusMod.BUILD` = `1.4.2` (kein `dev`-Tag im Release)
- [x] `CHANGELOG.md` â†’ `## Unreleased` in `## 1.4.2 - 2026-10-27` umbenannt (kein Fleet in sichtbaren Texten!)

## 2. Builds

- [x] Release-Builds erstellt; Forge 1.21.11 wegen Speicherlimit als Einzelbuild erstellt
- [x] `./scripts/ci/verify-jars.ps1` -> **24/24 OK**
- [x] `dist/multiversion` enth?lt 24 ? `Statusmod-<version>-<loader>-<mc>.jar`
- [x] Build-Tag in allen 24 JARs gepr?ft (`BUILD`/`VERSION` = `1.4.2`, `BUILD_ID` vorhanden)
- [x] `statusmod-build.txt` in allen 24 JARs im Format `<version>-<loader>-<mc>-<sha8>`
- [x] Lizenz in allen 4 Metadaten-Dateien = `Status Player License 1.0`, `statusmod-license.txt` im JAR
- [ ] **A4 (ProGuard) nur nach ausdrÃ¼cklichem Go** â€” danach `stamp-build.ps1` erneut laufen lassen (Obfuskation Ã¤ndert die JAR-Datei, sonst passt `sha8` nicht mehr)

## 3. Tests

- [ ] CI-Runtime-Matrix grÃ¼n (alle Loader Ã— alle MCs, MP-only auf Push) â€” lÃ¤uft erst nach dem Merge
- [ ] Ingame-Test (Befehle, GUI-Klicks, Inventar prÃ¼fen) â€” **brauchst du**
- [ ] Kill-Switch pro Server + global: `/status` verschwindet, `/modinfo` zeigt â€ždeaktiviert", Status/Badge weg, Re-Enable binnen 15 s ohne Neustart â€” **brauchst du**
- [x] Dashboard-Build grÃ¼n: `npm run build --prefix dashboard`

### 3b. Schutzfunktionen (1.4.2 neu)

- [ ] Anti-Rebrand: Test-JAR mit geÃ¤nderter `fabric.mod.json`-Mod-ID â†’ Start bricht ab, Logzeile `This build has been modified or rebranded. Refusing to start.`, `/modinfo` erklÃ¤rt den Zustand
- [ ] Sync-Code: Alt-Server (vor `2026-11-01`) bekommt beim ersten Pull automatisch einen Code (`[StatusMod] Sync code adopted from dashboard.`) und synct weiter â€” **kein Ausfall**
- [ ] Sync-Code: neuer Server ohne Code â†’ `403`, Log `Sync is not confirmed. â€¦ /status sync confirm <code>`, kein Push
- [ ] `/status sync status` zeigt Code-Status; `/status sync confirm <code>` aktiviert den Sync sofort
- [ ] Dashboard `/dashboard/sync`: Code erzeugen (einmalige Anzeige), Copy, Reset mit Sicherheitsabfrage
- [ ] Nach Reset: Mod bekommt `403` und stoppt; Server wird **nicht** automatisch neu migriert
- [ ] `dashboardUrl` hat keinen Default mehr â€” frische Installation synct erst nach Eintrag der URL

## 4. Tokens & Secrets

- [ ] `.\scripts\ci\check-release-tokens.ps1` â†’ Exit 0 (inkl. Modrinth-Auth via GET /user). ACHTUNG: `$env:`-Tokens gelten nur pro PowerShell-Sitzung â€” vor Publish neu setzen + Check erneut laufen lassen!
  - **Blockiert (2026-10-27):** `MODRINTH_TOKEN` = HTTP 401, `CURSEFORGE_API_KEY` = HTTP 403
- [ ] CI-Secrets prÃ¼fen (GitHub â†’ Settings â†’ Secrets â†’ Actions): `MODRINTH_TOKEN`, `MODRINTH_PROJECT_ID`, `CURSEFORGE_TOKEN`, `CURSEFORGE_PROJECT_ID` â€” **brauchst du**
- [x] Keine *neuen* Secrets im Diff

## 5. Dashboard live

- [x] `vercel deploy --prod` â€” deployt am 2026-11-01 inkl. `/dashboard/sync` + `/api/server/[server_id]/sync-code`
- [x] `/api/health` â†’ `healthy`, `database: connected`, `previous_secret_active: false`
- [x] Migration `011_server_sync_codes` angewendet (6 Spalten auf `public.servers`, Bestandszeilen unverÃ¤ndert)
- [ ] Login + Owner-Login einmal durchspielen â€” **brauchst du**
- [ ] Config-Pull auf Testserver prÃ¼fen â€” **brauchst du**
- [ ] Sync-Seite einmal als Owner durchklicken (Code erzeugen â†’ ingame bestÃ¤tigen â†’ Reset) â€” **brauchst du**

## 6. Offenlegung (Modrinth, vor Upload!)

- [ ] Projektseite: Icon aktuell, Beschreibung aktuell â€” **brauchst du**
  - Body enthÃ¤lt noch drei alte `Teufel2211/StatusMod`-Links (Token ungÃ¼ltig, daher manuell ersetzen)
- [x] Disclosure **"Contains AI-generated content"** gesetzt
- [ ] Disclosure **"Contains telemetry"** gesetzt (bleibt seit 1.4.0 bestehen, trotzdem verifizieren) â€” **brauchst du**
- [x] README/Modrinth-Seitentext ohne "No telemetry"-Versprechen (README nennt jetzt die synchronisierten Daten)

## 7. Merge + Publish

- [ ] `development` â†’ `main` mergen (kein Push ohne Go!)
- [ ] CI-Workflow grÃ¼n (Build + Verify + Runtime-Tests)
- [ ] Publish per `force_publish`-Dispatch anstoÃŸen (nÃ¶tig, da version.txt oft unverÃ¤ndert bleibt)
- [ ] Modrinth: Uploads sichtbar (24 Gruppen), Version freigegeben
- [ ] CurseForge: Dateien da, Freigabe abwarten
- [ ] GitHub Release angelegt (Changelog aus CHANGELOG.md, alle 24 JARs)
- [x] Fleet NICHT im Release (`dist/multiversion` enthÃ¤lt 0 Fleet-JARs; Guard in `publish-all.ps1` bleibt)

## 8. Danach

- [ ] Testserver + Nitrado auf neue JARs aktualisieren + Neustart â€” lokal erledigt (25566 lÃ¤uft `build 1.4.2`)
- [ ] Modrinth-Profile registrieren (`scripts/local/register-modrinth-content.ps1`, App vorher schlieÃŸen!)
- [ ] Diese Datei fÃ¼rs nÃ¤chste Release zurÃ¼cksetzen (Haken raus)
