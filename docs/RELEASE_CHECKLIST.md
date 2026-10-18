# Release-Checkliste 1.4.1

Abhaken der Reihe nach. Alles auf `development` vorbereiten, erst ganz am Ende nach `main` mergen (CI feuert nur dort).

## 1. Code fertig

- [ ] Alle Features/Fixes auf `development` committet, Baum sauber (`git status` leer)
- [ ] `version.txt` = `1.4.1` **und** `StatusMod.VERSION` (`common/.../statusmod/StatusMod.java`) auf denselben Wert gesetzt — beide müssen identisch sein (`/status version` liest die Konstante)
- [ ] `CHANGELOG.md` → `## Unreleased` in `## 1.4.1` umbenannt (kein Fleet in sichtbaren Texten!)

## 2. Builds

- [ ] `.\scripts\local\build-multiversion.ps1 -Loaders fabric,forge,neoforge,quilt -ContinueOnError:$false`
- [ ] `.\scripts\ci\verify-jars.ps1` → 24/24 OK
- [ ] `dist/multiversion` enthält 24 × `Statusmod-<version>-<loader>-<mc>.jar`

## 3. Tests

- [ ] CI-Runtime-Matrix grün (alle Loader × alle MCs, MP-only auf Push)
- [ ] Ingame-Test (Befehle, GUI-Klicks, Inventar prüfen) — **brauchst du**
- [ ] Dashboard-Build grün: `npm run build --prefix dashboard`

## 4. Tokens & Secrets

- [ ] `.\scripts\ci\check-release-tokens.ps1` → Exit 0 (inkl. Modrinth-Auth via GET /user). ACHTUNG: `$env:`-Tokens gelten nur pro PowerShell-Sitzung — vor Publish neu setzen + Check erneut laufen lassen!
- [ ] CI-Secrets prüfen (GitHub → Settings → Secrets → Actions): `MODRINTH_TOKEN`, `MODRINTH_PROJECT_ID`, `CURSEFORGE_TOKEN`, `CURSEFORGE_PROJECT_ID` — **brauchst du**
- [ ] Keine *neuen* Secrets im Diff

## 5. Dashboard live

- [ ] `vercel deploy --prod` — **brauchst du** (CLI nicht eingeloggt)
- [ ] `/api/health` → `healthy`, `previous_secret_active: false` — nach Deploy prüfen
- [ ] Login + Owner-Login einmal durchspielen — **brauchst du**
- [ ] Config-Pull auf Testserver prüfen — **brauchst du**

## 6. Offenlegung (Modrinth, vor Upload!)

- [ ] Projektseite: Icon aktuell, Beschreibung aktuell — **brauchst du**
- [ ] Disclosure **"Contains AI-generated content"** gesetzt — **brauchst du**
- [ ] Disclosure **"Contains telemetry"** gesetzt (bleibt seit 1.4.0 bestehen, trotzdem verifizieren)
- [ ] README/Modrinth-Seitentext ohne "No telemetry"-Versprechen — **brauchst du**

## 7. Merge + Publish

- [ ] `development` → `main` mergen (kein Push ohne Go!)
- [ ] CI-Workflow grün (Build + Verify + Runtime-Tests)
- [ ] Publish per `force_publish`-Dispatch anstoßen (nötig, da version.txt oft unverändert bleibt)
- [ ] Modrinth: Uploads sichtbar (15 Gruppen), Version freigegeben
- [ ] CurseForge: Dateien da, Freigabe abwarten
- [ ] GitHub Release angelegt (Changelog aus CHANGELOG.md, alle 24 JARs)
- [ ] Fleet NICHT im Release (Guard in `publish-all.ps1` bricht bei Fleetmod-JARs unter `dist/multiversion` ab)

## 8. Danach

- [ ] Testserver + Nitrado auf neue JARs aktualisieren + Neustart
- [ ] Modrinth-Profile registrieren (`scripts/local/register-modrinth-content.ps1`, App vorher schließen!)
- [ ] Diese Datei fürs nächste Release zurücksetzen (Haken raus)
