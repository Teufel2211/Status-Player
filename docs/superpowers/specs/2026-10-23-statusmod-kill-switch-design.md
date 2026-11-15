# StatusMod Kill-Switch (pro Server + global)

Stand: 2026-10-23 · Status: freigegeben

## Ziel

Der Fleet-Owner kann StatusMod im Admin-Dashboard manuell stilllegen:

- **Pro Server:** einzelner Schalter auf der Serverkarte.
- **Global:** ein Schalter, der StatusMod auf **allen** Servern der Flotte deaktiviert.

„Deaktiviert“ heißt: Status-Anzeige, Auto-AFK, Moderation/Slowmode, Sync-Push,
Dashboard-Übernahme und alle Mod-Befehle sind aus. Der Mod pollt weiter alle
15 Sekunden, damit ein Re-Enable ohne Serverneustart greift.

## Datenmodell

Migration `010_statusmod_kill_switch.sql`:

| Tabelle | Spalte | Default | Bedeutung |
|---------|--------|---------|-----------|
| `servers` | `mod_enabled` | `true` | Server-Ebene |
| `fleet_config` | `mod_enabled` | `true` | globale Ebene (Zeile `id = 1`) |

Effektiv aktiv ist StatusMod nur, wenn **beide** Flags `true` sind.
Neue Server erben damit automatisch den globalen Zustand.

## Dashboard-API

### `GET /api/servers`

Antwort wird zu:

```json
{
  "servers": [{ "id": "...", "created_at": "...", "known": 12, "online": 3, "mod_enabled": true }],
  "global_mod_enabled": true
}
```

Nur Owner; unverändert auf `owner_uuid` der Session gefiltert.

### `PATCH /api/admin/servers/[server_id]`

Body: `{ "mod_enabled": boolean }`

- Owner-only.
- Server muss dem Owner gehören, sonst 404.
- Audit: `mod_disable` / `mod_enable`.

### `PATCH /api/admin/servers`

Body: `{ "mod_enabled": boolean }`

- Owner-only.
- Setzt `fleet_config.mod_enabled` (globale Ebene).
- Audit: `mod_global_disable` / `mod_global_enable`.

## Mod-Sync

### `GET /api/players/[server_id]/sync`

Liefert immer `mod_enabled` (effektiv aus Server- und globalem Flag).
Ist der Effektivwert `false`, antwortet die Route nur mit
`{ "mod_enabled": false, "mod_disabled_scope": "server" | "global", "server_time": "..." }`.
`global` gewinnt, sobald `fleet_config.mod_enabled = false`; sonst ist der
Scope `server`. Der Mod verarbeitet dann keine Spieldaten und lässt den
Sync-Watermark unangetastet; nach dem Re-Enable wird der Rückstand nachgezogen.

### `POST /api/players/[server_id]/sync`

Ist der Effektivwert `false`, werden keine Schreibvorgänge ausgeführt:
`{ "synced": 0, "mod_enabled": false, "mod_disabled_scope": "server" | "global" }`.
Schützt vor einem Mod, der das Flag noch nicht geholt hat.

## Mod-Verhalten

- `ModConfig.remoteDisabled` wird persistiert, damit ein Neustart nicht für
  bis zu 15 Sekunden wieder aktiv ist.
- `ModConfig.remoteDisabledScope` wird ebenfalls persistiert (`server` oder
  `global`), damit die Chat-Meldung nach einem Neustart sofort stimmt.
- Chat-Hinweis bei Deaktivierung: Beim Join sowie sofort für alle Online-
  Spieler beim Umschalten (auch bei einem Scope-Wechsel) erscheint eine rote
  `[StatusMod]`-Meldung:
  - pro Server: „Dieser Server wurde vom Owner der Status Player Mod
    deaktiviert. Kontaktieren Sie den Owner, um den Grund zu erfahren und die
    Mod wieder zu aktivieren.“
  - global: „Die Status Player Mod wurde auf allen Servern deaktiviert.
    Bitte schauen Sie im Discord nach dem Grund.“
- Beim Ausschalten: Status-Teams aller Online-Spieler entfernen, Bossbar und
  Sidebar ausblenden, ein Logeintrag.
- Beim Einschalten: Status/Badges aller Online-Spieler sofort neu anwenden,
  ein Logeintrag.
- Deaktiviert: `StatusLifecycle` beendet den Tick-Pass nach dem Online-Namen-
  Update; `SyncManager.push` schreibt nicht; Pull übernimmt nur das Flag.
- Befehle `/status`, `/settings`, `/color`, `/code`, `/bug`, `/block`,
  `/ignore` und deren Gegenstücke sind über Brigadier-`requires` ausgeblendet.
  `/modinfo` bleibt lesbar und zeigt den Zustand an.
- `ChatGuard`, `StatusModAPI` und `StatusTeamUtil` prüfen den Zustand defensiv.

## UI

Admin-Übersicht, Abschnitt „Alle Server“:

- Kopfzeile mit globalem Schalter und Zustand („Alle aktiv“, „Global
  deaktiviert“, „Gemischt“).
- Jede Serverkarte bekommt eine Zeile „StatusMod“ mit Schalter und Badge.
- Ausschalten fragt nach (`confirm`), Einschalten nicht.
- Hinweis: „Greift nach maximal 15 Sekunden. Der Server muss Sync aktiviert
  haben.“

## Nicht im Scope

- Kein automatisches Deaktivieren bei Fehlern oder Offline-Zeiten.
- Keine Änderung am normalen Server-Dashboard.
- Keine rückwirkende Löschung lokaler Statusdaten.
