# Dashboard

The optional web dashboard connects your server(s) for live sync, player management and API keys. Everything works locally without it — the dashboard is opt-in.

## Setup (claim your server)

1. Start the server with StatusMod. If `dashboardUrl` + `setupSecret` are set and no `serverId` exists, the console prints a **setup code** (valid 24h).
2. Open the dashboard `/setup` page, enter the code → the server is claimed.
3. The mod fetches its API key automatically (≤ 30s, no restart). Fallback: copy the shown key into `config/statusmod/config.json` as `apiKey`.

## Sync

- Two-way, every ~30s (push) / ~15s (pull) over HTTPS: status, color, avatar, settings, mutes, blocks, warnings, chat slowmode, server presets, online presence.
- Toggle with `/status feature … sync`; inspect with `/status sync` (key shown as prefix only).
- Local JSON stays source of truth — sync is best-effort and never deletes local data.
- Transfer statuses between servers on the same dashboard: `/status transfer <server-id> <key>`.
- Admin dashboard: the owner can disable StatusMod per server or for all servers. While disabled, status display, AFK, moderation, commands and push sync are off; the mod keeps polling so re-enabling applies within 15 seconds without a restart. `/modinfo` stays available and reports the state.

## Pages (after login via `/code` in-game)

- **Overview** — system status, live players, shortcuts.
- **Players** — roster with search + online filter; detail pages to set status/color live, manage warnings (levels 1–3), temporary ignore and per-player chat slowmode.
- **Presets** — server-wide presets (name, status, color) that appear in-game at `/status` for all players.
- **Moderation** — warning expiry (default 14 days) and opt-in for the auto-mute suggestion after 3 active warnings (never applied automatically).
- **Config** — edit server JSON (validated on save).
- **API Keys** — create/revoke mod keys (owner only, max 2 active).
- **Audit Log** — who changed what, when.
- **Bug reports** — inbox for `/bug` messages (owner-only), including attached screenshots; mark as done or delete (deleting a report also removes its images).

Players with warnings show a `[!1]`–`[!3]` badge in the tab list (yellow → gold → red). The dashboard is the only place warnings are assigned; they expire automatically and only active warnings count.

Sessions persist via HttpOnly cookie (7 days, silent refresh). The dashboard never sees your Minecraft password — login is always a one-time code.

## Privacy

Per-server data (UUID, username, status, color, settings, mute/block state) is sent to the dashboard backend (Supabase, HTTPS) only when sync is configured. Player self-service: profile anonymization on request. See Modrinth page → disclosures before enabling sync on a public server.
