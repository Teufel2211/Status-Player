# Spec: Dashboard-Redesign „Klar" — komplette App einheitlich (inkl. Admin-Dashboard) + Bug-Posteingang-Umzug

- **Datum:** 2026-10-18 · **Stand 2026-10-19:** Admin-Struktur final (Screen 12), Umsetzung läuft
- **Status:** Freigegeben
- **Basis:** Brainstorming-Screens `01`–`12` in `.superpowers/brainstorm/2026-10-18-dashboard-redesign/content/` (final: `11-admin-dashboard-final.html` Optik, `12-admin-struktur.html` Admin-Struktur)
- **Ersetzt teilweise:** `2026-10-18-bug-dashboard-posteingang-design.md` — nur den Punkt „Ort des Posteingangs" (Meldungen künftig ausschließlich im Admin-Dashboard)

## Kurzfassung

- Die **komplette App** bekommt einen einheitlichen Look: **„Klar"** — ruhig, ein Akzent (Emerald), keine Effekte (kein Glow, keine Gradients, kein Blur, keine Muster).
- Das **Admin-Dashboard (Fleet)** wird keine eigene „OPS-Welt" mehr und bekommt **dieselbe Struktur wie das normale Dashboard** (Übersicht · Spieler · API-Keys · Verlauf) — mit Blick auf **alle Server**; **Bug-Meldungen** ist der einzige zusätzliche Sidebar-Eintrag.
- Der **Bug-Posteingang zieht um**: raus aus dem normalen Dashboard, rein ins Admin-Dashboard — nur der Owner sieht ihn.
- **Deutsch durchgängig**; Fachbegriffe (API-Key, UUID, Owner-Code, Token) bleiben. Beide Themes bleiben, **Standard dunkel**.
- Mod-/Server-Code und DB-Schema bleiben unangetastet — **keine Migration nötig**.

---

## 1. Ziel & Umfang

### In Scope
- `/dashboard/*`: Übersicht, Spieler (Liste + Detail), API-Keys, Verlauf
- `/admin-dashboard/*` (Fleet-Admin): gleiche Shell **und gleiche Struktur** wie das normale Dashboard (Übersicht, Spieler, API-Keys, Verlauf) + **Bug-Posteingang** als Extra
- Öffentliche Seiten: Landing (`/`), Login, Setup, Rechtliches (AGB, Datenschutz, Nutzungsbedingungen, Impressum)
- Bug-Meldungen: Seite `/dashboard/bugs` + Sidebar-Eintrag entfernen; stattdessen Owner-Sektion im Admin-Dashboard
- Deutsch durchgängig in allen UI-Texten

### Nicht in Scope
- Mod-/Server-Code (Java) — unverändert
- DB-Schema — unverändert, keine Migration
- Deploy (läuft separat nach User-Go) und restliche 1.4.2-Features (Ablaufzeit-Status, Warnstufen-Badge, Kurzzeit-Ignore, Slowmode, Warn-Eskalation)
- Fleet-Publish-/Kommunikations-Themen (Fleet bleibt intern)

### Stil-Regeln („Klar", Stufe 2)
- **Ruhige Tiefe:** flache Flächen, feine Rahmen, weicher Kartenschatten — **kein** Glow, **keine** Gradients, **kein** Backdrop-Blur, keine Grid-/Mesh-Muster
- **Ein** Akzent (Emerald); Rot/Gelb nur für Zustände (Fehler/Warnung)
- Mono (JetBrains) nur für Technisches: IDs, Zeiten, Metadaten, Kicker
- Hover = Farb-/Rahmenwechsel ≤ 200 ms; keine Positions-/Größen-Animationen, kein Stagger
- Fokus muss sichtbar bleiben (Akzent-Rahmen/-Ring), `outline: none` nie ohne Ersatz
- Deutsche Texte durchgängig

---

## 2. Design-Tokens

### Dunkel (Standard)

| Token | Wert | Verwendung |
|-------|------|------------|
| `--bg-primary` | `#0b0b0e` | Seitenhintergrund |
| `--bg-card` | `#121216` | Karten, Sidebar |
| `--bg-hover` | `#18181d` | Hover-Flächen, Avatar-Hintergrund |
| `--bg-input` | `#0f0f13` | Eingabefelder |
| `--border` | `#26262d` | Rahmen |
| `--text-primary` | `#fafafa` | Text |
| `--text-secondary` | `#94949e` | Sekundärtext |
| `--text-muted` | `#6e6e77` | Meta, Kicker |
| `--accent` | `#10b981` | Akzent-Fläche (Buttons, Badges) |
| `--accent-fg` | `#052e1f` | Text auf Akzent |
| `--accent-soft` | `rgba(16,185,129,.12)` | Akzent-Tönung |
| `--accent-line` | `rgba(16,185,129,.30)` | Akzent-Rahmen |
| `--accent-text` | `#34d399` | Akzent als Textfarbe |
| `--red` | `#f87171` | Fehler |
| `--red-soft` / `--red-line` | `rgba(248,113,113,.10)` / `rgba(248,113,113,.32)` | Fehler-Tönung/-Rahmen |
| `--amber` | `#fbbf24` | Warnung |
| `--amber-soft` / `--amber-line` | `rgba(251,191,36,.10)` / `rgba(251,191,36,.32)` | Warn-Tönung/-Rahmen |
| `--shadow` | `0 14px 30px -22px rgba(0,0,0,.95)` | Kartenschatten |

### Hell

| Token | Wert |
|-------|------|
| `--bg-primary` | `#f6f6f7` |
| `--bg-card` | `#ffffff` |
| `--bg-hover` | `#f1f1f3` |
| `--bg-input` | `#ffffff` |
| `--border` | `#e6e6ea` |
| `--text-primary` | `#18181b` |
| `--text-secondary` | `#52525b` |
| `--text-muted` | `#8b8b94` |
| `--accent` | `#059669` |
| `--accent-fg` | `#ffffff` |
| `--accent-soft` | `rgba(5,150,105,.09)` |
| `--accent-line` | `rgba(5,150,105,.28)` |
| `--accent-text` | `#047857` |
| `--red` | `#dc2626` |
| `--red-soft` / `--red-line` | `rgba(220,38,38,.07)` / `rgba(220,38,38,.28)` |
| `--amber` | `#b45309` |
| `--amber-soft` / `--amber-line` | `rgba(180,83,9,.08)` / `rgba(180,83,9,.30)` |
| `--shadow` | `0 12px 26px -20px rgba(24,24,27,.28)` |

**Entfernt:** `--cyan`, `--glow-accent`, `--glow-cyan`, `--grid-opacity`, `--mesh-a`, `--mesh-b`, `--glass-blur` (und die alten `--accent-dim`/`--accent-hover`/`--accent-border` werden durch `--accent-soft`/`--accent-line`/`--accent-text` ersetzt).

### Typografie
- Überschriften: **Bricolage Grotesque 700**, Tracking −0.01em
- Fließtext: **DM Sans**
- Technisches: **JetBrains Mono**
- Größen analog Mockup (12px-Basis ≈ ×1.3 in echter App): Kicker ≈ 11px Mono uppercase `+0.16em` **muted** (nicht mehr Akzent!), H1 ≈ 26–28px, H2 ≈ 19px, Fließtext ≈ 14px, Mono-Meta ≈ 12px, Sidebar ≈ 13px

### Radien & Form
- Karten 12px, Buttons/Inputs 9px, Badges/Pillen rund, Sidebar-Einträge 8px

---

## 3. Bausteine (Vokabular)

- **Seitenkopf:** Kicker (Mono, muted) + H1 (Bricolage); optional Statuspille rechts (z. B. „Verbunden")
- **Abschnittskopf:** H2 (Bricolage ~19px) + Sub rechts (Mono, muted)
- **Karte:** 1px Rahmen, `--bg-card`, weicher Schatten, Radius 12px — Inhalt als Zeilenliste
- **Zeile:** Avatar/Aktion · Inhalt · Meta rechts (Mono) · Aktionen; mobil stapelbar
- **Stat-Kachel:** Kicker-Label + großer Wert (Bricolage) + optional Badge
- **Badges:** `ok` (Akzent soft/line/text), `warn` (Amber), `err` (Rot), `neutral` (Rahmen/muted)
- **Buttons:** primary (Akzent-Fläche, `--accent-fg`), secondary (transparent + Rahmen), danger (Rot soft/line + Rot-Text), ghost (Akzent-Text, kein Rahmen); kleine Variante für Zeilenaktionen
- **Eingabefelder:** Label + Feld; Fokus = Akzent-Rahmen + dezenter Ring
- **Präsenzpunkt:** grün = online, grau = offline ( **ohne** Glow)
- **Avatar:** Initial-Badge (`--bg-hover`), sonst bestehender `PlayerAvatar` (mc-heads/URL-Crop) — Optik unverändert
- **Nav-Chips:** Mono, klein; aktiv = Akzent soft/line (für Admin-Abschnitte und Filter)
- **Leerzustände:** ruhiger Satz + Mono-Hinweis (keine Deko-Icons)

Alle bestehenden UI-Typen werden auf dieses Vokabular gemappt — **keine neuen Funktionen**.

---

## 4. Globale Umsetzung

### 4.1 `dashboard/app/globals.css`
- Token-Blöcke (`:root` hell / `.dark`) auf §2 ersetzen
- Komponenten-Klassen auf „Klar" umbauen: `.btn-primary` **flach** (statt Gradient, kein Glow, kein translateY), `.btn-secondary` ohne Blur, `.card` ohne Blur/Glow mit `--shadow`, `.input` (Fokus: Akzent-Rahmen + soft-Ring), `.kicker` **muted** statt Akzent, `.badge-*` flach (soft/line, ohne Glow)
- **Ersatzlos entfernen:** `hero-mesh`, `bg-grid`, `text-gradient`, `text-glow`, `term-bar`/`term-dot`/`term-window`, `fade-up` + `anim-d*` (Stagger), `card-glow`, alle `fleet-*`-Klassen (`fleet-theme`, `fleet-phosphor`, `fleet-blink`), Keyframes `rise`/`blink-caret`/`scan-drift`
- **Behalten, aber beruhigen:** `.pulse-dot` (dezente Puls-Animation **ohne** Glow-Schatten), `.skeleton` (neutrale Lade-Anzeige)

### 4.2 `app/layout.tsx`
- `lang="de"`, Metadata-Beschreibung deutsch
- Default-Theme **dunkel** (nicht mehr System-Erkennung als Default; eine gespeicherte Nutzerwahl gewinnt weiterhin)

### 4.3 Theme-Umschalter (`components/theme-provider.tsx`)
- Verhalten bleibt; Labels deutsch: „Helles Design" / „Dunkles Design"

---

## 5. Shell & Navigation

### 5.1 Sidebar (`components/sidebar.tsx`)
- **Eine Sidebar, zwei Varianten** — dieselbe Struktur, nur andere Ziele:
  - **Normal (Dashboard):** Betrieb: Übersicht (◆), Spieler (◎) · Konfiguration: API-Keys (⌨), Verlauf (◉)
  - **Admin (Admin-Dashboard):** identisch, **einziger Zusatz:** Bug-Meldungen (✉) mit offen-Zähler unter „Betrieb"
- **Kein** „Administration"-Bereich und **kein** „Admin-Dashboard"-Eintrag (User-Entscheidung 2026-10-19)
- „Bug-Meldungen" erscheint **nicht** im normalen Dashboard (Posteingang ist Owner-only)
- Logo: flaches Badge („S" auf Akzent) + „StatusMod" — kein Gradient, kein „OPS"-Untertitel
- Fuß: Design-Umschalter („Helles Design" / „Dunkles Design") + „Abmelden"
- Owner-Erkennung clientseitig über `/api/me` (`role`); Sicherheit hängt nicht daran (APIs prüfen zusätzlich)

### 5.2 Admin-Shell
- Neue Datei `app/admin-dashboard/layout.tsx` analog `app/dashboard/layout.tsx` (Sidebar in Admin-Variante + Inhalt + Footer, `ensureSession()`-Gate)
- Unterseiten: `/admin-dashboard` (Übersicht) · `/admin-dashboard/players` (Spieler) · `/admin-dashboard/keys` (API-Keys) · `/admin-dashboard/audit` (Verlauf) · `/admin-dashboard/bugs` (Bug-Meldungen)
- `components/fleet-topbar.tsx` wird **gelöscht**; „OPS_COMMAND", Blink-Cursor und die eigene Topbar entfallen ersatzlos. Die Uhr entfällt; der Verbunden-Status steht als Pille im Seitenkopf
- **Zugang nur über Owner-Login** (`/admin-dashboard`) — bewusst **kein** Sidebar-Eintrag, weder im normalen noch im Admin-Dashboard
- Das Admin-Dashboard folgt dem **App-Theme** (dunkel Standard) — keine eigene „immer dunkel"-Welt mehr

### 5.3 Footer (`components/footer.tsx`)
- Struktur unverändert; Tokens/Klassen „Klar", Texte deutsch prüfen

---

## 6. Seiten im Einzelnen

### 6.1 Öffentliche Seiten

**Landing (`app/page.tsx`)**
- Ruhiges Klar-Layout (keine Mesh/Grid/Glow/Stagger)
- Kicker-Zeile „StatusMod · Server-Ops", H1 „StatusMod"
- Deutscher Text: „Spieler-Status für deine Minecraft-Server — eine Konsole, keine Datei-Bastelei."
- Buttons: „Server einrichten" (→ /setup), „Anmelden" (→ /login), „Dashboard" (→ /dashboard)

**Login (`app/login/page.tsx`)**
- Karte statt Terminal-Fenster (`term-*` raus)
- Deutsch durchgängig:
  - Kicker „Spieler-Zugang" / „Owner-Zugang", H1 „Anmelden"
  - Hinweise: „Hol dir mit `/code` im Spiel deinen Login-Code." / „Erzeuge mit `/fleet owner-code` in der Server-Konsole deinen Owner-Code."
  - Labels „Login-Code" / „Owner-Code" / „Authenticator-Code"; Button „Anmelden"
  - Fehler: „Zu viele Versuche — bitte kurz warten.", „Ungültiger oder abgelaufener Code", „Verbindung fehlgeschlagen — bitte erneut versuchen."
  - Hinweis „Der Code läuft nach 10 Minuten ab."; Umschalter „Stattdessen Spieler-Code verwenden" / „Als Owner anmelden"

**Setup (`app/setup/page.tsx`)**
- Klar-Karte; die drei Schritte deutsch:
  - „01 — Der Server holt den API-Key automatisch (≤ 30 s). Keine config.json nötig."
  - „02 — Fallback: Key in config/statusmod/config.json eintragen."
  - „03 — /code funktioniert im Spiel sofort — kein Neustart nötig."
- Fehler-/Kopier-Texte deutsch

**Rechtliches** (`agb`, `datenschutz`, `nutzungsbedingungen`, `impressum`)
- Nur Tokens/Typografie über `components/legal-layout.tsx` auffrischen; Inhalte unverändert

### 6.2 Dashboard

**Übersicht (`app/dashboard/page.tsx`)**
- Karten/Badges „Klar"; deutsche Texte: „X online" / „Alles ruhig.", Kacheln „Server", „Datenbank", „Bekannte Spieler", „Echtzeit", Abschnitt „Spieler live", Leertext „Gerade ist niemand online — der Feed füllt sich beim Beitritt."
- Keine `card-glow`/Gradients; Live-Indikatoren mit dezentem Punkt

**Spieler (`app/dashboard/players/page.tsx`)**
- Gemäß Screen `04`: Tabelle mit Avataren, Status-Badges, Präsenzpunkten, Suche „Name oder UUID suchen…", Filter „Nur online", Kopf „X bekannt · Y online"; Zeilen-Klick → Detail

**Spieler-Detail (`app/dashboard/players/[uuid]/page.tsx`)**
- Gleiche Sprache (Karten, Formularfelder, Badges), Layout-Feinschliff; Funktionen unverändert

**API-Keys (`app/dashboard/keys/page.tsx`)**
- Key-Zeilen-Stil statt Tabelle; Badges (gültig/abgelaufen/widerrufen), Check-/Audit-Spalten; „Widerrufen" als Danger-Button; Deutsch

**Verlauf (`app/dashboard/audit/page.tsx`)**
- Zeilenliste, Mono-Meta; deutsche Zeitangaben („heute", „vor X Min.", Datum); Funktionen unverändert

**Bug-Meldungen:** Seite `/dashboard/bugs` + Sidebar-Eintrag **entfallen** (Umzug, §7)

### 6.3 Admin-Dashboard — gleiche Struktur wie das Dashboard, Blick auf alle Server

- **Kopf je Seite:** Kicker „Admin-Dashboard · <Kontext>" (z. B. „3 Server · 5 online"), H1 = Bereichsname; auf der Übersicht zusätzlich Statuspille „Verbunden"
- **Übersicht (`/admin-dashboard`):** Kacheln (Server, Spieler online, Live-Feed, Datenbank) · Warnungen & Ereignisse · **Alle Server** (Karten: Kurz-ID, „ID kopieren", Voll-UUID, online/bekannt/seit) · **Presets & Verteilung** (Preset-Zeilen „Verteilen ›", Formular, letzte Verteilung mit „Zurückrollen")
- **Spieler (`/admin-dashboard/players`):** alle Spieler **aller Server**; Suche; Tabelle Spieler (Avatar) · Server-Tag · Status (Punkt + Text) · Farbe (Chip + Name) · „Ändern" → Zeile klappt auf (Status-Feld, Farbe-Feld, Speichern/Abbrechen); Offline gedimmt, ohne Status „—"
- **API-Keys (`/admin-dashboard/keys`):** alle **aktiven** Keys aller Server (Server-Tag, Präfix, Scope, erstellt am, Badge „aktiv"); abgelaufene/widerrufene ausgeblendet
- **Verlauf (`/admin-dashboard/audit`):** Fleet-Protokoll „wer wann und wo"; jede Zeile mit Zeit (Mono) + Server-Tag + Vorgang
- **Bug-Meldungen (`/admin-dashboard/bugs`):** Posteingang (§7) — Filter-Chips, Erledigt/Wieder öffnen/Löschen
- **Funktionen unverändert:** Warnungen, Server-Liste, Presets, Verteilung/Rollback, IDs & Keys, Protokoll; neu dazu: Spieler-Status **und** -Farbe serverübergreifend ändern
- Nicht-Owner/Nicht-Angemeldet: deutscher Hinweis mit Owner-Code-Referenz (`/fleet owner-code`) — keine OPS-Versatzstücke

---

## 7. Bug-Posteingang-Umzug (funktional)

### Unverändert (Mod-Seite)
- `POST /api/bug-report` bleibt wie ist: Validierung (10–1500 Zeichen), Rate-Limit (3/10 min), 10-Minuten-Cooldown im Mod, deutsche Meldungen, kein Logging des Meldetexts

### Entfernt
- Seite `app/dashboard/bugs/` (komplett)
- Sidebar-Eintrag „Bug-Meldungen"
- Alte session-gebundene Routen (die Seite war der einzige Nutzer):
  - `GET /api/bug-reports/[server_id]`
  - `PATCH` + `DELETE /api/bug-reports/[server_id]/[id]`

### Neu (Owner-only)
- `GET /api/bug-reports` — **alle** Meldungen **aller Server**, neueste zuerst (Limit 500), inkl. `server_id`
- `PATCH /api/bug-reports/[id]` — `resolved` setzen (Wiederverwendung `BugReportUpdateSchema`), `resolved_at` pflegen wie bisher
- `DELETE /api/bug-reports/[id]` — löschen; 404 wenn nicht vorhanden
- Auth: `requireSession()` + strikt `role === "owner"` (sonst 403 `forbidden()`); keine Server-Bindung mehr
- Parität zum bisherigen Verhalten: kein Audit-Eintrag fürs Bearbeiten/Löschen, keine Schema-Änderung

### Admin-Seite „Bug-Meldungen" (UI — `/admin-dashboard/bugs`)
- Kicker: „Admin-Dashboard · X offen · Y gesamt"
- Filter-Chips: „Offen (n)" · „Alle (n)" · „Erledigt (n)"
- Pro Meldung (Zeilen-Stil der Karte): Spielername, Status-Badge (`offen`=warn / `erledigt`=ok), **Server-Kurz-ID** als Tag, relative Zeit, Meta „MC X · Mod Y · Loader", Text (whitespace erhalten), Aktionen:
  - „Erledigt" / „Wieder öffnen" (secondary, klein)
  - „Löschen" (danger, klein; Bestätigung „Diese Bug-Meldung wirklich löschen?")
- Erledigte Meldungen gedimmt; Leerzustand „Keine Bug-Meldungen — alles ruhig" + Mono-Hinweis „Meldungen über /bug landen hier automatisch"
- Bestehendes `ago()`-Format wiederverwenden (gerade eben / vor X Min./Std./Tag(en) / Datum)

### Folge-Doku
- `docs/superpowers/specs/2026-10-18-bug-dashboard-posteingang-design.md` bekommt oben einen Hinweis: Inbox-Ort durch diese Spec ersetzt (Rest bleibt gültig)

---

## 8. Verifikation

- `cd dashboard; $env:NODE_OPTIONS="--max-old-space-size=4096"; npm run build` → **EXIT 0** (Type-Check + Build)
- Grep-Check: keine Referenzen mehr auf `fleet-theme`, `fleet-topbar`, `fleet-blink`, `hero-mesh`, `bg-grid`, `term-window`, `text-gradient`, `card-glow`, `/dashboard/bugs`
- Sichtprüfung **Dunkel + Hell**: Landing, Login, Setup, Übersicht, Spieler, Spieler-Detail, API-Keys, Verlauf, Admin-Dashboard (alle 5 Seiten), Rechtliches
- Klickpfade:
  - Spieler-Login → normaler Dashboard-Start; Sidebar ohne Bug-/Admin-Einträge
  - Owner-Login → Admin-Dashboard (Übersicht, alle Server); Sidebar identisch + **Bug-Meldungen** als einziger Zusatz; **kein** „Administration"-Bereich
  - Admin-Spieler: Status + Farbe eines **fremden** Servers ändern → gespeichert (Server-Tag sichtbar)
  - Admin: Bug-Meldung „Erledigt" → „Wieder öffnen" → „Löschen"; Filter-Chips zählen korrekt
  - Nicht-Owner-Token gegen `GET /api/bug-reports` → 403
- **Kein Deploy** in diesem Arbeitsschritt (separat nach User-Go)

---

## 9. Betroffene Dateien (Richtwert)

**Dashboard-App**
- `app/globals.css`, `app/layout.tsx`, `components/theme-provider.tsx`
- `components/sidebar.tsx`, `components/footer.tsx`, `components/legal-layout.tsx` (Tokens); **löschen:** `components/fleet-topbar.tsx`
- `app/page.tsx`, `app/login/page.tsx`, `app/setup/page.tsx`, `app/{agb,datenschutz,nutzungsbedingungen,impressum}/page.tsx`
- `app/dashboard/page.tsx`, `app/dashboard/players/page.tsx`, `app/dashboard/players/[uuid]/page.tsx`, `app/dashboard/keys/page.tsx`, `app/dashboard/audit/page.tsx`; **löschen:** `app/dashboard/bugs/`
- `app/admin-dashboard/`: **neu** `layout.tsx`; **neu** `players/page.tsx`, `keys/page.tsx`, `audit/page.tsx`, `bugs/page.tsx`; `page.tsx` (Übersicht) umgebaut
- **API**: `app/api/bug-reports/` umbauen (2 neue Routen, 2 alte löschen); `app/api/bug-report/route.ts` unverändert
- Kleinkram: `--cyan`/`--glow-*`-Nutzungen beim Umbau bereinigen (Grep)

**Doku**
- Diese Spec + Hinweis in der `/bug`-Spec (§7)

---

## 10. Entscheidungen (aus dem Review)

- **Name:** Seiten-Kicker „Admin-Dashboard" (bewusst ohne „Fleet") — **kein** eigener Sidebar-Eintrag mehr (User-Entscheidung 2026-10-19, Screen 12)
- **Einheitlichkeit:** Admin-Dashboard nutzt **dieselben Kategorien und Einträge** wie das normale Dashboard — einziger Zusatz: Bug-Meldungen
- **Struktur der Admin-Seiten:** 5 Seiten wie §6.3 (Übersicht inkl. Warnungen/Presets/Verteilung; Spieler mit Status+Farbe serverübergreifend; API-Keys; Verlauf; Bug-Meldungen)
- **Zugang:** nur über Owner-Login — bewusst kein Sidebar-Eintrag im normalen Dashboard
- **Themes:** Admin folgt dem globalen Theme (dunkel Standard) — keine „immer dunkel"-Sonderwelt
- **Uhr:** entfällt; „Verbunden"-Pille genügt
- **Feinjustage beim Umsetzen frei:** exakte Schriftgrößen/Abstände (±), Icon-Glyphen (◆ ◎ ⌨ ◉ ✉ ☀ ✕)
