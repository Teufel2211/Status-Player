# Design-Spezifikation: Statusmenü-Taste (Keybind)

**Datum:** 2026-10-19
**Status:** Vom Nutzer angefragt (Chat, 2026-10-19: „mache es auch so, damit man mit U auch das /status menü öffnen kann und die taste auch ändern kann in den minecraft einstellungen"). Ausführung wie hier beschrieben; Bestätigung des Nutzers vor Umsetzung vorgesehen.
**Betroffene Version:** 1.4.2 (auf `development`)
**Grundgerüst:** baut auf dem Client-Teil aus `2026-10-19-bug-bilder-design.md` auf (erste Client-Entrypoints der Mod). Wird im selben Zug mit umgesetzt.

## Ziel

Eine Taste (Standard **U**) öffnet das bekannte Statusmenü (`SelfStatusMenu`, heute über `/status` ohne Argumente) — ohne etwas zu tippen. Die Taste erscheint automatisch in den **Minecraft-Steuerungseinstellungen** und ist dort jederzeit änderbar.

## Verhalten

- KeyMapping **„Statusmenü öffnen"**, Kategorie **„StatusMod"**, Standard **U** (in Vanilla unbelegt). Doppelbelegungen mit anderen Mods löst der Spieler per Umbelegung — Standard-MC-Verhalten, keine eigene Mod-Config.
- Drücken (nur im Spiel — nicht in GUIs, Chat oder Menüs, wie bei allen MC-Tasten): Client sendet exakt den Befehl `status` an den Server — identisch zu getipptem `/status`. Der Server öffnet das bestehende `SelfStatusMenu`; alle Prüfungen (Feature-Toggle `status`, Permission) bleiben **unverändert serverseitig**.
- Es gibt **kein Custom-Payload** und keine neue Server-Logik; funktioniert auch im Singleplayer (integrierter Server), sofern die Mod installiert ist.
- Voraussetzung: Mod auf dem Client (gleiche Voraussetzung wie der Im-Spiel-Weg der /bug-Bilder). Ohne Client-Mod existiert die Taste nicht — Vanilla-Limit, kein Fehlerfall.

## Umsetzung (Glue)

- **Fabric/Quilt:** `ClientModInitializer` + `KeyBindingHelper.registerKeyBinding` (Fabric API) + Tick-Poll (`ClientTickEvents.END_CLIENT_TICK`, `consumeClick`).
- **Forge/NeoForge:** Client-Setup + KeyMapping-Registrierung je API-Stand (`RegisterKeyMappingsEvent`; ältere Stände ggf. per Reflection wie die bestehenden Muster); Tick-Poll analog.
- **Senden:** `ClientPacketListener#sendCommand("status")` (Mojang-Mappings; falls versionsabhängig anders benannt, im Client-Glue kapseln).
- Kein Spieler/Screen vorhanden → nichts tun. Server nicht erreichbar → Vanilla-Fehlerverhalten des Befehls.

## Nicht-Ziele (YAGNI)

- Keine weiteren Hotkeys in v1 (z. B. Admin-GUI) — später möglich.
- Keine Umbelegung außerhalb der MC-Steuerung (keine Mod-eigene Tastatur-Config).
- Keine Änderungen am `SelfStatusMenu` selbst.

## Testkriterien

- Client bootet sauber (CI-SP-Boot-Test); Server unverändert (CI-Runtime-MP).
- In-Game (User): Eintrag unter Optionen → Steuerung → Kategorie „StatusMod" (Taste U); Drücken öffnet das Menü; Umbelegen wirkt sofort; bei deaktiviertem `status`-Feature kommt die normale Servermeldung.
