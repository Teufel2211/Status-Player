# Design-Spezifikation: Bilder für `/bug` (Screenshots anhängen)

**Datum:** 2026-10-19
**Status:** Mit Nutzer abgestimmt (Chat, 2026-10-19 — Design vorgestellt, Nutzer: „JAja"). Zwei Wege bestätigt: Browser-Upload (alle Spieler) + Im-Spiel-Auswahl (Client-Mod). Umfang: komplett in 1.4.2.
**Betroffene Version:** 1.4.2 (auf `development`)
**Verwandt:** `2026-10-18-bug-dashboard-posteingang-design.md` (Grundfeature `/bug`), `2026-10-19-statusmenu-keybind-design.md` (baut auf demselben neuen Client-Gerüst auf)

## Ziel

Spieler können zu einer `/bug`-Meldung Screenshots anhängen:
- **(a) Browser-Weg** — funktioniert für alle Spieler (Vanilla, Geyser/Bedrock, jeder Launcher): der Chat gibt einen Link + Code aus, die Bilder werden über eine öffentliche Dashboard-Seite hochgeladen.
- **(b) Im-Spiel-Weg** — nur wenn die Mod zusätzlich auf dem Spieler-Client läuft: Screenshot-Liste direkt im Chat, Upload ohne Browser.

Bilder landen privat bei der Meldung im Owner-Posteingang des Admin-Dashboards; sie sind nirgendwo öffentlich.

## Kernidee (kein Mod-eigenes Netzwerkprotokoll)

Die `/bug`-Antwort im Chat enthält zwei klickbare Buttons mit den kompletten Upload-Zielen inkl. Code:

- **[Im Browser öffnen]** → `OpenUrl` auf `https://<dashboard>/upload?c=<CODE>`
- **[Im Spiel anhängen]** → `RunCommand` auf `/bugbild https://<dashboard>/api/bug-report/image?c=<CODE>`

Mit Client-Mod fängt der Client `/bugbild` **lokal** ab (Client-Command, wie üblich bei Fabric/Forge/NeoForge-Client-Befehlen) und öffnet die Screenshot-Liste. Ohne Mod landet der Befehl beim Server, der nur einen freundlichen Hinweis ausgibt („Dafür brauchst du die Mod auf deinem Client — nutze stattdessen den Browser-Link").

**Warum das wichtig ist:** Wir brauchen dadurch **keine Custom-Payloads, keinen Handshake und keinen Server-Client-Netzwerkcode** — das wäre über 4 Loader × 20 Versionskombinationen der größte Aufwand und das größte Risiko gewesen. Es werden nur Standard-Chat-Buttons (Muster existiert bereits) und client-lokale Befehle gebraucht.

## Ablauf

1. `/bug <text>` — unverändert (Toggle `bug`, 10–1500 Zeichen, 10-Minuten-Cooldown).
2. `POST /api/bug-report` legt die Meldung an und erzeugt dabei den Upload-Code (30 Min gültig). Neue Antwort:
   `{ok:true, upload:{code:"K7M2P9QX", page_url:"…/upload?c=…", api_url:"…/api/bug-report/image?c=…", expires_at:"…"}}`
   (Basis-URLs werden aus dem Request-Host gebaut — funktioniert für die Vercel-Prod-Alias und für Self-Hosting.)
3. Chat-Ausgabe (neu, zweite Zeile; entfällt bei alten Dashboards ohne `upload`-Feld):
   „Danke! Deine Bug-Meldung ist angekommen." / „Screenshots anhängen: [Im Browser öffnen] [Im Spiel anhängen] · Code: K7M2P9QX (30 Min gültig)" — der Code-Text ist klickbar zum Kopieren, wo die MC-Version es hergibt.
4. **Browser-Weg:** Seite öffnen → Bilder wählen (Drag&Drop, mehrfach) → Verkleinerung im Browser (Canvas) → sequentieller Upload → Fertig-Zustand.
5. **Im-Spiel-Weg:** `/bugbild <api_url>` → lokale Liste der neuesten Screenshots (max. 6, neueste zuerst) als klickbare Chat-Zeilen mit [Senden] → Hintergrund-Thread: laden, verkleinern, HTTPS-POST → Chat-Feedback („✅ Screenshot gesendet (1/3).", Fehler deutsch).
6. Im Admin-Posteingang zeigen die Meldungen „📎 n Bilder"; Aufklappen lädt Miniaturen, Klick öffnet groß.

## Limits (Konstanten, keine Server-Konfiguration)

- max. **3 Bilder** pro Meldung; Code **30 Minuten** gültig.
- max. **3 MB** je Bild *nach* Verkleinerung (Vercel-Body-Limit 4,5 MB wird eingehalten).
- Typen JPEG/PNG/WebP; Prüfung per **Magic-Bytes** (nicht nur Content-Type).
- Es wird **immer** neu als JPEG kodiert (Stufe 0.85, längste Kante max. 1920 px): entfernt Metadaten/EXIF, PNG-Alpha wird weiß, Ergebnis typisch 200–600 KB. Gilt für Browser (Canvas) **und** Client-Mod (ImageIO).
- Ratenlimits: pro Code (z. B. 12/h) und pro IP-Hash (z. B. 20/10 min) zusätzlich zum harten 3er-Deckel.

## Supabase

Migration `007_bug_report_images.sql` (via Supabase-Migrationstool anwenden, Projekt `ujksgdbfczbgtifiovuw`):

- `bug_reports` + `upload_code_hash text NULL`, `upload_code_expires_at timestamptz NULL`; Unique-Index auf `upload_code_hash`.
- Neue Tabelle `bug_report_images` (`id` Identity PK, `report_id` FK → `bug_reports(id) ON DELETE CASCADE`, `storage_path text`, `mime text`, `size_bytes int`, `created_at timestamptz DEFAULT now()`), Index auf `report_id`, RLS an.
- Storage-Bucket `bug-images` (privat) per `insert into storage.buckets … on conflict do nothing` (Service-Role umgeht RLS; keine Public-Policies).
- Der Code wird **nur als SHA-256-Hash** gespeichert (deckt sich mit Datenschutz-Text §4: „Tokens … als Hash").

## API (Dashboard)

| Route | Methode | Auth | Zweck |
|---|---|---|---|
| `/api/bug-report` | POST | Mod-API-Key (`check`) | Meldung + Upload-Code erzeugen; Antwort enthält `upload{code, page_url, api_url, expires_at}`. |
| `/api/bug-report/image?c=` | GET | Code | Status: gültig? `remaining`, `expires_at`. |
| `/api/bug-report/image?c=` | POST | Code | Roher Bild-Body (`image/jpeg\|png\|webp`) → Bucket + Tabellenzeile; Antwort `{ok, remaining, count}`. Fehler: 400/410 (Code), 413 (zu groß), 415 (Typ), 429 (Limit). |
| `/api/bug-reports` | GET | Owner-Session | Liste zusätzlich mit Bild-Anzahl (`bug_report_images(count)`). |
| `/api/bug-reports/[id]/images` | GET | Owner-Session | Liste mit kurzlebigen signierten URLs (300 s). |
| `/api/bug-reports/[id]` | DELETE | Owner-Session | Erst Storage-Objekte des Reports löschen, dann Meldung (Bilder-Zeilen per CASCADE). |

Fehlertexte deutsch. Validierung: bestehende Schemas + neues Code-Schema (`^[A-Za-z0-9]{8}$`, ohne mehrdeutige Zeichen erzeugt).

## Dashboard-UI

- Neue öffentliche Seite `app/upload/page.tsx` (kein Login, `noindex`, Klar-Design, deutsch, mobiltauglich — auch für Bedrock-Spieler am Handy):
  Code aus Query `?c=` oder Eingabefeld; Statuskarte (gültig bis, „n/3 Bilder"); Drag&Drop + Dateiauswahl (mehrfach); Vorschauen; clientseitige Verkleinerung; sequentieller Upload mit Fortschritt je Datei; klare Zustände (lädt/ok/Fehler) und Fertig-Ansicht.
- Admin-Posteingang (`app/admin-dashboard/bugs/page.tsx`): Chip „📎 n Bilder" je Meldung; Aufklappen lädt die Bilder (signierte URLs) als Miniatur-Grid; Klick öffnet groß in neuem Tab. Neue API `GET /api/bug-reports/[id]/images`.

## Mod — Server (klein)

- `BugCommand`: Antwort-Body lesen (bisher `BodyHandlers.discarding()`), `upload` auswerten; zweite Chat-Zeile mit Buttons nur wenn vorhanden.
- Neuer Helper `util/ChatLinks` (RunCommand / OpenUrl / CopyToClipboard, 3-Stufen-Reflection wie die bestehenden Muster in `StatusCommand`/`ClickablePlayerHeadMenu`); bestehende Stellen werden **nicht** umgebaut.
- Neuer Server-Command `/bugbild [argumente…]` (greedy, Argumente werden ignoriert): Hinweis für Vanilla-Klicker. Feature-Toggle `bug` berücksichtigen.
- Keine neuen Configs/Secrets; Basis-URLs kommen aus der POST-Antwort.

## Mod — Client (neu, der große Teil)

- Erstes Client-Gerüst der Mod:
  - Fabric/Quilt: `fabric.mod.json` bekommt `"client"`-Entrypoint (`ClientModInitializer`); Quilt erbt fabric.
  - Forge/NeoForge: Client-Setup-Klasse + Client-Command-Registrierung (je API-Stand; ältere Stände ggf. per Reflection wie bestehende Muster).
- Client-Command `/bugbild <url> [send <index>]`:
  - ohne Index: Liste der neuesten Screenshots aus `screenshots/` (mtime-sortiert, max. 6) als klickbare Chat-Zeilen, darunter Hinweis „F2 nimmt einen neuen Screenshot auf."; leerer Ordner → Hinweistext.
  - mit `send <index>`: Hintergrund-Thread lädt die Datei, verkleinert (ImageIO + Graphics2D, JPEG q0.85, max. 1920 px), POSTet an die URL, meldet Ergebnis im Chat.
- Game-Dir-Zugriff per Loader-Glue (Fabric: `FabricLoader#getGameDir`, Forge/NeoForge: `FMLPaths.GAMEDIR`); Logik in `common`.
- **Server-Boot-Sicherheit:** Client-Klassen werden ausschließlich über Client-Entrypoints geladen — der Dedicated-Server fasst sie nie an (CI-Runtime-MP-Test bleibt Sicherheitsnetz). Kein `StatusMod.init()` im Client-Pfad nötig (URL kommt als Command-Argument).
- Fabric-Clients brauchen weiterhin Fabric API (wie auf Servern üblich).

## Datenschutz / Doku

- `app/datenschutz/page.tsx` §3.5 erweitern: Screenshots optional/freiwillig, nur zur Fehleranalyse, privater Speicher (nur Owner sichtbar), Löschung zusammen mit der Meldung; Re-Encoding entfernt Metadaten.
- `docs/dashboard-plan.md`: neue Routen + Bucket dokumentieren.
- `CHANGELOG.md` (Unreleased) und `wiki/Commands.md` bei Umsetzung ergänzen.

## Nicht-Ziele (YAGNI)

- Keine Bild-Vorschau-GUI im Spiel in v1 (Chat-Liste bewusst — kein Client-GUI-Code über 20 Versionskombinationen; grafischer Picker wäre späterer Ausbau).
- Nur der klassische `screenshots/`-Ordner (kein Windows Game Bar/andere Pfade), keine Videos, kein Verlauf/Galerie für Spieler.
- Keine automatische Aufräum-Frist in v1 (Bilder leben mit der Meldung; Löschen über den Posteingang), keine Server-Konfiguration der Limits, kein externer Bildhoster.

## Risiken / Testkriterien

- `:common:compileJava` grün; Multiversion-Build 20/20 grün; CI-Runtime-MP grün (Server bootet sauber trotz Client-Code im JAR); CI-SP-Boot grün.
- Dashboard `npm run build` grün; Migration angewendet; Bucket vorhanden; `POST /api/bug-report` liefert `upload`.
- Dev-Tests: Upload per curl (korrektes Bild, falscher Typ, zu groß, abgelaufener Code, 4. Bild → Limit); Bilder im Posteingang sichtbar; DELETE entfernt Storage-Objekte.
- In-Game (User): Browser-Weg mit Vanilla-Client; Im-Spiel-Weg mit Client-Mod (Liste, Senden, Zähler, Fehlerfälle).
