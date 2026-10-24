# Configuration

StatusMod stores its local settings in:

`config/statusmod/config.json`

The file is created with defaults on first start and pretty-printed (one setting per line). Reload with `/status config reload` (re-reads the file; manual edits are merged, not clobbered).

## Dashboard & identity fields

| Field | Meaning |
|-------|---------|
| `dashboardUrl` | Dashboard URL (default `https://statusmod-dashboard.vercel.app`). Empty = no sync. Must be HTTPS (or localhost for dev). |
| `setupSecret` | Shared secret for server setup/claim. Set via `/status setup-secret` (prefer console) or file edit + restart. |
| `serverId` | This server's UUID (auto-set during claim). |
| `apiKey` | This server's API key (`sm_…`, auto-fetched after claim, or `/status apikey`). |
| `lastSyncAtMs` | Sync watermark (managed automatically). |

When the dashboard values change centrally, update `dashboardUrl`/`setupSecret` on each server (file edit + restart, or `/status setup-secret`). `serverId`/`apiKey` always stay per-server.

## Gameplay fields

| Field | Default | Meaning |
|-------|---------|---------|
| `adminOpLevel` | `2` | OP level required for admin commands (1–4). |
| `statusPermissionNode` | `statusmod.use` | LuckyPerms node for normal use. |
| `adminPermissionNode` | `statusmod.admin` | LuckyPerms node for admin commands. |
| `enableAdminOverrides` | `true` | Master switch for `/status admin …` + badge commands. |
| `defaultColor` | `reset` | Fallback status color. |
| `statusReapplyTicks` | `100` | Re-apply display every N ticks (20–6000). |
| `statusCooldownSeconds` | `2` | Cooldown between status changes (0–300, admins exempt). |
| `statusHistorySize` | `5` | Entries kept for `/status history` (0–20). |
| `features` | all `true` | Per-feature toggles: `status badge afk block mute presets code sync bug warn slowmode` (see `/status feature`). |
| `enableAutoAfk` / `afkTimeoutSeconds` / `afkStatusText` / `afkColor` | `true` / `300` / `AFK` / `gray` | Auto-AFK after inactivity (30–3600s). Restores previous status on return. |
| `bossbarListEnabled` / `sidebarListEnabled` | `false` | Status list channels (Bedrock-visible). |
| `bossbarColor` / `bossbarOverlay` / `bossbarShowHeader` / `bossbarMode` | `WHITE` / `PROGRESS` / `false` / `BAR` | Boss-bar rendering (`BAR` or `ACTIONBAR`). |
| `restoreStatusOnJoin` / `restoreAfkOnJoin` / `restoreTimedOnJoin` | `true` / `false` / `true` | What survives rejoin. |
| `enableStaffBadge` / `staffBadgeText` / `staffBadgeColor` / `staffBadges` | `false` / `STAFF` / `red` / `{}` | Staff badges (per-player map). |

## Storage files

- `config/statusmod/config.json` — settings (this page)
- `config/statusmod/players.json` — per-player settings
- `config/statusmod/blocked_players.json` — blocked UUIDs
- `config/statusmod/muted_players.json` — mutes with expiry
- `config/statusmod/custom_presets.json` — custom presets (max 500)
- `config/statusmod/statuses.json` — generated overview (uuid/name/status/color/online, rewritten on change)
- `config/statusmod/audit.log` — local audit trail (who/when/what)

## Behavior

- Atomic file writes (temp + move) reduce corruption risk.
- Malformed JSON is backed up (`statusmod_backup/`) so the mod keeps running.
- Invalid input is sanitized (length caps, control-char stripping, color validation).
- Player names/UUIDs in logs are the only PII written locally; nothing leaves the server unless sync is configured (opt-in, HTTPS).
