# Design-Spezifikation: Kopierschutz + Sync-Bestätigungscode

**Datum:** 2026-10-31
**Status:** Vom Nutzer angefragt (Chat, 2026-10-31: „baue 2 sachen ein … die eine ist ein kopierschutz und reverse engineering schutz und das 2 ist eine bestätigungs code bei supabase sync so damit nicht jeder das einfach benutzen kann"). Entscheidungen im Chat bestätigt.
**Betroffene Version:** 1.4.2 (auf `development`, noch nicht released)
**Branch:** `development` — Merge nach `main` nur mit ausdrücklichem Go.

## Ziel

1. **Kopierschutz / Reverse-Engineering-Schutz:** verhindern, dass jemand das JAR nimmt und als eigenes Mod neu veröffentlicht — rechtlich über eine eigene Lizenz (A1), technisch über Fingerprint, Anti-Rebrand-Prüfung und Obfuskation. Kein „unhackbarer" Schutz, aber Aufwand + Nachweisbarkeit.
2. **Sync-Bestätigungscode:** eine kopierte Mod-Installation darf nicht einfach an die Supabase/Dashboard-API andocken.

## Entscheidungen des Nutzers

| Frage | Entscheidung |
|-------|--------------|
| Was soll Kopierschutz verhindern? | Weiterveröffentlichung als eigenes Mod |
| Woher kommt der Sync-Code? | Vom Dashboard (lokal generierter Code wäre wertlos, weil sich eine Kopie ihn selbst ausstellen könnte) |
| Bestehende Server | Automatische Migration (Dashboard erzeugt Code, Mod übernimmt ihn beim nächsten Pull) |
| MIT-Lizenz ersetzen? | **Ja, eigene Lizenz.** Rebranding verboten, Fork erst nach 12 Monaten ohne Update. Siehe A1 |
| Name beim erlaubten Fork | Eigener Name erlaubt, aber Pflicht-Hinweis „basiert auf Status Player" + Link zum Original |
| Build-Fingerprint | Nur **innerhalb** des JAR, niemals im Dateinamen |

## Nicht-Ziele

- Kein Geräte-/Hardware-Binding (fragil bei Server-Umzug, Container-Rebuild, Neuinstallation).
- Keine Verschlüsselung der Kommunikation über HTTPS hinaus.
- Keine Änderung an Dateinamen, `/status version`, GUI oder Metadaten-Schema.
- Kein Kopierschutz für die Dashboard-Web-App (nur Mod-JARs).

## Teil A — Kopierschutz / Anti-Republikation

### A1 — Eigene Lizenz („Status Player License 1.0")

MIT erlaubt ausdrücklich Veränderung und Weiterverbreitung und damit auch Rebranding. Die gewünschten Regeln sind mit MIT nicht darstellbar, deshalb wird ab 1.4.2 eine eigene Lizenz verwendet. Das ist der einzige Teil des Schutzes, der rechtlich wirklich gegen Re-Upload wirkt.

**Regeln der Lizenz:**

| Erlaubt | Verboten |
|---------|----------|
| Nutzung auf eigenen Servern, auch monetarisiert | Rebranding (Name, Mod-ID, Credits entfernen/ändern/verschleiern) |
| Kopien für Privatnutzung, Backups, eigene Server/Clients | Veröffentlichung veränderter Versionen (außer Abschnitt 4) |
| Veränderung für **private** Nutzung | Entfernen von Copyright-, Lizenz- oder Build-Hinweisen |
| Weitergabe **unveränderter, vollständiger** Kopien mit Name + Credits | Eindruck erwecken, der Autor unterstütze die eigene Version |

**Ausnahme — Fortführung nach Stillstand (Abschnitt 4):**

- Wenn das Originalprojekt **12 Monate in Folge kein Release** hatte (gemessen am letzten Release auf Modrinth, CurseForge oder GitHub Releases), darf eine veränderte Version veröffentlicht werden.
- Eine solche Fortführung darf einen **eigenen Namen** tragen.
- Pflicht: sichtbarer Hinweis „basiert auf Status Player" **in der Projektbeschreibung und in den In-Game-Metadaten** + Link zum Originalprojekt.
- Kein Anspruch auf die ursprüngliche Arbeit, kein Eindruck von Unterstützung durch den Autor.
- Die Lizenz gilt für alle geerbten Teile weiter; eigene Ergänzungen dürfen anders lizenziert werden, solange die hier gewährten Rechte nicht eingeschränkt werden.

**Altversionen:** 1.4.1 und älter bleiben MIT. Der alte Text bleibt als `LICENSE-MIT-legacy.txt` im Repo, damit die Lizenz der veröffentlichten Versionen nachvollziehbar bleibt.

**Umzustellende Stellen:**

| Datei | Änderung |
|-------|----------|
| `LICENSE` | neuer Lizenztext (Status Player License 1.0) |
| `LICENSE-MIT-legacy.txt` | alter MIT-Text + Hinweis „gilt bis 1.4.1" |
| `fabric/src/main/resources/fabric.mod.json` | `"license": "Status Player License 1.0"` |
| `forge/src/main/resources/META-INF/mods.toml` | `license="Status Player License 1.0"` |
| `Loader/forge26.1/src/main/resources/META-INF/mods.toml` | dito |
| `neoforge/src/main/resources/META-INF/neoforge.mods.toml` | dito |
| `quilt/src/main/resources/quilt.mod.json` | dito |
| `common/src/main/resources/statusmod-license.txt` | Kurzfassung der Lizenz **im JAR** (landet in allen 24 Builds, geprüft: `common`-Ressourcen sind in allen Loadern enthalten) |
| `README.md` | Lizenzabschnitt neu |
| Modrinth + CurseForge | Lizenzfeld auf „Custom" + Link auf die Lizenzdatei |

**Verhältnis zu A3:** A3 verhindert, dass ein **fertiges JAR** mit geändertem Branding startet. Eine erlaubte Fortführung nach 12 Monaten baut aus dem Quellcode und entfernt die Prüfung dabei ohnehin — A3 trifft sie also nicht. A3 ist eine Hürde gegen JAR-Patching, keine Lizenzdurchsetzung.

### A2 — Build-Fingerprint (intern)

Jeder der 24 Builds erhält eine deterministische Kennung:

```
BUILD_ID = "<version>-<loader>-<mc>-<sha8>"
Beispiel: 1.4.2-fabric-26.2-0587c1dd
```

- `<sha8>` = erste 8 Zeichen des SHA-256 über die fertige JAR-Datei (also build-spezifisch, nicht reproduzierbar ohne identische Umgebung — genau das ist gewollt).
- Ablage **ausschließlich im JAR**:
  1. Konstante `StatusMod.BUILD_ID` (per `javap` prüfbar, nicht in `/status version` sichtbar)
  2. Ressource `statusmod-build.txt` im JAR-Root (Loader-unabhängig, einzeilig)
- **Nicht** im Dateinamen, **nicht** in `fabric.mod.json`/`mods.toml`/`neoforge.mods.toml`/`quilt.mod.json`, **nicht** in GUI/Chat.
- `verify-jars.ps1` bleibt funktional unverändert und wird um eine Prüfung ergänzt: `statusmod-build.txt` vorhanden und nicht leer.

Zweck: eine irgendwo gefundene Kopie ist eindeutig einem Build zuordenbar.

### A3 — Anti-Rebrand-Prüfung zur Laufzeit

Beim Init prüft der Mod seine eigene Identität:

- `MOD_ID` ist exakt `statusmod`
- Branding-Konstanten (`StatusMod.VERSION`, Anzeigename) sind nicht leer
- Die zum Loader passende Metadaten-Ressource deklariert `statusmod` als Mod-ID

Bei Abweichung: Mod startet **nicht** (kein Command-Registrieren, kein Sync, kein Lifecycle), Logzeile:

```
[StatusMod] This build has been modified or rebranded. Refusing to start.
```

`/modinfo` bleibt erreichbar und erklärt den Zustand, damit ein Server-Admin nicht im Dunkeln steht.

Grenze: Ein Fork kann die Prüfung entfernen. Sie ist eine Hürde.

### A4 — Obfuskation der eigenen Klassen (ProGuard)

- Nur `com.teufel.statusmod.**` wird umbenannt. `net.minecraft.**`, `com.mojang.**`, Loader-APIs, Gson, Floodgate, LuckPerms bleiben unangetastet.
- Debug-Informationen (LocalVariableTable, SourceFile, LineNumberTable) raus.
- String-Verschlüsselung für interne Klassennamen-Strings.
- Keep-Regeln (sonst bricht die Mod):
  - **Entrypoints:** `com.teufel.statusmod.fabric.StatusModFabric`, `StatusModFabricClient`, Forge-/NeoForge-Entrypoints (per Metadaten referenziert)
  - **`com.teufel.statusmod.gui.ClickablePlayerHeadMenu`** — wird per `Class.forName` geladen (`StatusGuiCommand:153`)
  - **Alle Gson-Modellfelder** (Feldnamen werden per Reflection gelesen/geschrieben): `ModConfig` (+ `StaffBadge`), `PlayerSettings`, `BlockedPlayers.BlockEntry`, `WarningStore.WarnInfo`, `ServerPresets.ServerPreset`, `CustomPresets`-Einträge
  - Reflection-Ziele außerhalb unseres Pakets sind unkritisch (nicht obfuskiert)
- Anwendung als **separater Release-Schritt** auf die 24 fertigen JARs (eigenes Skript `scripts/local/obfuscate-release.ps1`), nicht im normalen Dev-Build.
- Absicherung: erweiterte `verify-jars.ps1` (Entrypoint-Klassen vorhanden, Metadaten intakt, `statusmod-build.txt` da) + Runtime-Matrix.

Reihenfolge: A4 kommt **zuletzt**, nach Teil B und A2/A3, weil es das größte Risiko für die 24 Builds trägt.

## Teil B — Sync-Bestätigungscode

### Ausgangslage (das eigentliche Loch)

`ModConfig.dashboardUrl` hat den hardcoded Default `https://statusmod-dashboard.vercel.app`. Jede frisch installierte Mod-Kopie zeigt damit auf das Dashboard des Autors. Das wird entfernt: Default ist leer, der Server-Admin muss die URL selbst eintragen.

### Mod-Seite

| Änderung | Datei |
|----------|-------|
| Neues Feld `syncCode` (leer = nicht bestätigt) + Normalisierung | `storage/ModConfig.java` |
| `start()` startet nur, wenn `syncCode` gesetzt ist; sonst Log mit Anleitung | `sync/SyncManager.java` |
| Header `x-sync-code` bei Push und Pull | `sync/SyncManager.java` |
| Neuer Befehl `/status sync status\|confirm <code>\|reset` (admin-only, Audit-Log) | `command/StatusCommand.java` |
| Default `dashboardUrl` entfernen | `storage/ModConfig.java` |

Verhalten von `/status sync`:

- `status` — zeigt: Feature an/aus, URL gesetzt?, Server-ID gesetzt?, API-Key gesetzt?, Code bestätigt ja/nein, letzter Push/Pull
- `confirm <code>` — validiert Format (8 Zeichen, `A-Za-z0-9`), speichert in `config.syncCode`, startet Sync sofort (`SyncManager.retryStart()`), Audit-Eintrag
- `reset` — löscht `config.syncCode`, stoppt den Sync-Loop

Ohne bestätigten Code schreibt der Mod beim Start genau eine Zeile:

```
[StatusMod] Sync is not confirmed. Get a code from your dashboard and run: /status sync confirm <code>
```

### Dashboard-Seite

**Migration** (`007_server_sync_codes.sql`):

```
servers.sync_code_hash      text        -- Argon2id, wie api_keys
servers.sync_code_created_at timestamptz
servers.sync_confirmed_at    timestamptz
```

**Routen:**

| Route | Methode | Auth | Zweck |
|-------|---------|------|-------|
| `/api/server/[server_id]/sync-code` | POST | Session, owner, eigene `server_id` | Neuen Code erzeugen; Klartext wird **einmalig** zurückgegeben |
| `/api/server/[server_id]/sync-code` | DELETE | Session, owner | Zurücksetzen (Hash löschen, `sync_confirmed_at` null) |
| `/api/server/[server_id]/sync-code/status` | GET | Session, owner | `{configured: bool, confirmed: bool, created_at}` |

**Prüfung in den Sync-Routen** (`/api/players/[server_id]/sync`, GET + POST):

- `x-sync-code` fehlt oder passt nicht zum Hash → `403 {error: "sync_not_confirmed"}`
- Kein Hash gesetzt (Server noch nie migriert) → automatische Migration, siehe unten

**UI:** Karte „Sync" auf der Config-Seite — Code anzeigen (einmalig, mit Copy-Button), Status „bestätigt seit …", Button „Sync zurücksetzen".

### Migration bestehender Server (automatisch)

Beim ersten Pull/Push eines Servers ohne `sync_code_hash`:

1. Dashboard erzeugt einen Code, speichert den Hash, merkt den Klartext für **eine** Antwort
2. Antwort enthält zusätzlich `sync_code_setup: "<code>"` und `sync_code_setup_once: true`
3. Mod speichert den Code in `config.syncCode` (Reload-Merge wie beim API-Key, nie fremde Änderungen überschreiben)
4. Ab dem nächsten Request gilt die normale Prüfung

Neue Server (registriert **nach** dem Update) bekommen **keinen** automatischen Code — die müssen paaren. Erkennungsmerkmal: `servers.created_at` nach dem Migrationszeitpunkt.

### Rücksetzer (der eigentliche Hebel)

„Sync zurücksetzen" im Dashboard löscht den Hash. Jede Installation — auch eine kopierte mit gültiger `config.json` — bekommt ab dem nächsten Request `403 sync_not_confirmed` und stellt den Sync ein. Der Server-Admin muss einen neuen Code holen und ingame bestätigen.

### Grenzen (bewusst akzeptiert)

- Wer JAR **und** `config.json` kopiert, hat gültige Zugangsdaten, bis der Code im Dashboard zurückgesetzt wird.
- Ohne Default-URL hat eine frische Kopie ohne Config kein Ziel und keinen Code — das ist der Hauptgewinn.
- Die automatische Migration für Alt-Server ist bewusst schwach (Vertrauen beim ersten Kontakt), weil der Nutzer keinen Ausfall wollte.

## Fehlerbehandlung

- Dashboard nicht erreichbar → Sync pausiert, nächster Zyklus, keine Datenlöschung (bestehendes Verhalten).
- Code falsch → `403`, Mod loggt `Sync rejected: code not confirmed` und pausiert bis zum nächsten `/status sync confirm`.
- Config-Reload während Code-Übernahme → Reload-Merge-Muster wie in `SetupManager.pollPendingKey` (frisch laden, nur das eine Feld setzen, speichern, Static ersetzen).
- Kein Secret in Logs: Code wird **nie** geloggt (weder Mod noch Dashboard), nur „bestätigt/nicht bestätigt".

## Tests

**Dashboard**
- `npm run build` grün
- Code erzeugen → Klartext genau einmal
- Sync mit falschem/fehlendem Code → `403`
- Sync mit richtigem Code → `200`
- Zurücksetzen → alter Code `403`
- Migration: Server ohne Hash bekommt beim ersten Pull `sync_code_setup`

**Mod**
- `:common:compileJava` grün
- Sync startet ohne Code nicht, mit Code sofort
- `/status sync` admin-only (nicht-Admin → „Du hast nicht genügend Rechte.")
- `x-sync-code` im Request nachweisbar (Testserver-Log / Dashboard-Audit)

**Release**
- 24er-Build + `verify-jars.ps1` (inkl. neuer `statusmod-build.txt`-Prüfung)
- `javap`-Check: `BUILD_ID` in allen 24 JARs gesetzt
- Testserver 25566: Start ohne Rebrand-Abbruch
- Nach A4: kompletter 24er-Lauf + Runtime-Matrix

**Lizenz (A1)**
- `LICENSE`, `LICENSE-MIT-legacy.txt`, `statusmod-license.txt` vorhanden und konsistent
- alle 4 Metadaten-Dateien deklarieren `Status Player License 1.0`
- `statusmod-license.txt` in allen 24 JARs vorhanden (Stichprobe je Loader)
- README-Lizenzabschnitt passt zu `LICENSE`
- Modrinth + CurseForge Lizenzfeld umgestellt (User-Aktion, vor Release)

## Reihenfolge der Umsetzung

0. **A1** — Lizenz (Dateien, Metadaten, README, Plattform-Felder). Kein Build-Risiko, kann sofort.
1. **Teil B** — Mod + Dashboard + Migration + UI (funktionaler Schutz)
2. **A2 + A3** — Fingerprint + Anti-Rebrand (klein, kein Build-Risiko)
3. **A4** — ProGuard auf die 24 Release-JARs, separat, mit voller Verifikation

## Changelog

Unter `## 1.4.2`:
- **Added:** Sync-Bestätigungscode (`/status sync confirm`), Dashboard-Karte „Sync"
- **Added:** Build-Fingerprint im JAR, Schutz gegen Re-Branding
- **Changed:** Dashboard-URL hat keinen Default mehr — muss eingetragen werden
- **Changed:** Lizenz ab 1.4.2 ist die „Status Player License 1.0" (Rebranding verboten, Fortführung erst nach 12 Monaten ohne Release)
- **Removed:** MIT-Lizenz gilt nicht mehr für neue Versionen (1.4.1 und älter bleiben MIT)
