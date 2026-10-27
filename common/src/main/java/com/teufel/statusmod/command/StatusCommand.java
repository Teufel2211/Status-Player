package com.teufel.statusmod.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.storage.AuditLogger;
import com.teufel.statusmod.storage.ModConfig;
import com.teufel.statusmod.storage.PlayerSettings;
import com.teufel.statusmod.util.ColorMapper;
import com.teufel.statusmod.util.CodeGenerator;
import com.teufel.statusmod.util.CommandUtil;
import com.teufel.statusmod.util.DurationUtil;
import com.teufel.statusmod.util.FontMapper;
import com.teufel.statusmod.util.PermissionUtil;
import com.teufel.statusmod.util.StatusColorUtil;
import com.teufel.statusmod.util.StatusTeamUtil;
import com.teufel.statusmod.util.StatusTextUtil;
import com.teufel.statusmod.sync.SyncManager;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.TextColor;
import net.minecraft.server.level.ServerPlayer;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class StatusCommand {
    private static final int MAX_STATUS_LENGTH = 64;
    private static final Map<String, Preset> PRESETS = new HashMap<>();
    static {
        PRESETS.put("afk", new Preset("AFK", "yellow", "normal"));
        PRESETS.put("busy", new Preset("Busy", "red", "normal"));
        PRESETS.put("stream", new Preset("Stream", "light_purple", "smallcaps"));
        PRESETS.put("shop", new Preset("Shop", "gold", "normal"));
    }

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        LiteralArgumentBuilder<CommandSourceStack> statusTree = Commands.literal("status")
            // Kill-Switch: Befehle verschwinden komplett, solange der Server
            // im Admin-Dashboard deaktiviert ist.
            .requires(ctx -> !StatusMod.isRemoteDisabled())
            .executes(ctx -> { openSelfStatusGui(ctx.getSource()); return 1; })
            .then(Commands.literal("clear").executes(ctx -> { clearStatus(ctx.getSource()); return 1; }))
            .then(Commands.literal("list").executes(ctx -> { listOnlineStatuses(ctx.getSource()); return 1; }))
            .then(Commands.literal("preset")
                .then(Commands.literal("save").then(Commands.argument("preset_name", StringArgumentType.word()).then(Commands.argument("status", StringArgumentType.greedyString()).suggests(CommandSuggestions.STATUS_SUGGESTIONS).executes(ctx -> { saveCustomPreset(ctx.getSource(), StringArgumentType.getString(ctx, "preset_name"), StringArgumentType.getString(ctx, "status"), null); return 1; }))))
                .then(Commands.literal("remove").then(Commands.argument("preset_name", StringArgumentType.word()).suggests(CommandSuggestions.CUSTOM_PRESET_SUGGESTIONS).executes(ctx -> { removeCustomPreset(ctx.getSource(), StringArgumentType.getString(ctx, "preset_name")); return 1; })))
                .then(Commands.literal("list").executes(ctx -> { listCustomPresets(ctx.getSource()); return 1; }))
                .then(Commands.argument("name", StringArgumentType.word()).suggests(CommandSuggestions.PRESET_SUGGESTIONS).executes(ctx -> { applyPreset(ctx.getSource(), StringArgumentType.getString(ctx, "name")); return 1; })))
            .then(Commands.literal("random").then(Commands.argument("status", StringArgumentType.greedyString()).suggests(CommandSuggestions.STATUS_SUGGESTIONS).executes(ctx -> { setRandomStatus(ctx.getSource(), StringArgumentType.getString(ctx, "status")); return 1; })))
            .then(Commands.literal("timed").then(Commands.argument("minutes", IntegerArgumentType.integer(1)).then(Commands.argument("status", StringArgumentType.greedyString()).suggests(CommandSuggestions.STATUS_SUGGESTIONS).executes(ctx -> { setTimedStatus(ctx.getSource(), IntegerArgumentType.getInteger(ctx, "minutes"), StringArgumentType.getString(ctx, "status")); return 1; }))))
            .then(Commands.literal("history").executes(ctx -> { showHistory(ctx.getSource()); return 1; }))
            .then(Commands.literal("version").executes(ctx -> { showVersion(ctx.getSource()); return 1; }))
            .then(Commands.literal("world").then(Commands.literal("clear").executes(ctx -> { clearWorldStatus(ctx.getSource()); return 1; }))
                .then(Commands.argument("status", StringArgumentType.greedyString()).suggests(CommandSuggestions.STATUS_SUGGESTIONS).executes(ctx -> { setWorldStatus(ctx.getSource(), StringArgumentType.getString(ctx, "status"), null); return 1; })))
            // Greedy status argument LAST: Brigadier tries children in order,
            // so literals (version, history, list, ...) must come first —
            // otherwise "/status version" is eaten as status text "version".
            .then(Commands.argument("status", StringArgumentType.greedyString()).suggests(CommandSuggestions.STATUS_SUGGESTIONS).executes(ctx -> { setStatus(ctx.getSource(), StringArgumentType.getString(ctx, "status"), null); return 1; }));
        if (StatusMod.getConfig().enableAdminOverrides) {
            statusTree = statusTree.then(Commands.literal("admin")
                .then(Commands.literal("clear").then(Commands.argument("player", net.minecraft.commands.arguments.EntityArgument.player()).executes(ctx -> { if (!PermissionUtil.hasAdminPermission(ctx.getSource())) { ctx.getSource().sendFailure(Component.literal("Du hast nicht genügend Rechte, um andere Spieler zu verwalten.")); return 0; } ServerPlayer player = net.minecraft.commands.arguments.EntityArgument.getPlayer(ctx, "player"); adminClearStatus(ctx.getSource(), player.getScoreboardName()); return 1; })))
                .then(Commands.literal("set").then(Commands.argument("player", net.minecraft.commands.arguments.EntityArgument.player()).then(Commands.argument("status", StringArgumentType.greedyString()).suggests(CommandSuggestions.STATUS_SUGGESTIONS).executes(ctx -> { if (!PermissionUtil.hasAdminPermission(ctx.getSource())) { ctx.getSource().sendFailure(Component.literal("Du hast nicht genügend Rechte, um andere Spieler zu verwalten.")); return 0; } ServerPlayer player = net.minecraft.commands.arguments.EntityArgument.getPlayer(ctx, "player"); adminSetStatus(ctx.getSource(), player.getScoreboardName(), StringArgumentType.getString(ctx, "status"), null); return 1; }))))
                .then(Commands.literal("color").then(Commands.argument("player", net.minecraft.commands.arguments.EntityArgument.player()).then(Commands.argument("color", StringArgumentType.word()).suggests(CommandSuggestions.COLOR_SUGGESTIONS).executes(ctx -> { if (!PermissionUtil.hasAdminPermission(ctx.getSource())) { ctx.getSource().sendFailure(Component.literal("Du hast nicht genügend Rechte, um andere Spieler zu verwalten.")); return 0; } ServerPlayer target = net.minecraft.commands.arguments.EntityArgument.getPlayer(ctx, "player"); adminSetColor(ctx.getSource(), target.getScoreboardName(), StringArgumentType.getString(ctx, "color")); return 1; }))))
                .then(Commands.literal("mute").then(Commands.argument("player", net.minecraft.commands.arguments.EntityArgument.player()).then(Commands.argument("minutes", IntegerArgumentType.integer(1, 1440)).executes(ctx -> { if (!PermissionUtil.hasAdminPermission(ctx.getSource())) { ctx.getSource().sendFailure(Component.literal("Du hast nicht genügend Rechte.")); return 0; } ServerPlayer target = net.minecraft.commands.arguments.EntityArgument.getPlayer(ctx, "player"); int mins = IntegerArgumentType.getInteger(ctx, "minutes"); mutePlayer(ctx.getSource(), target, mins); return 1; }))))
                .then(Commands.literal("unmute").then(Commands.argument("player", net.minecraft.commands.arguments.EntityArgument.player()).executes(ctx -> { if (!PermissionUtil.hasAdminPermission(ctx.getSource())) { ctx.getSource().sendFailure(Component.literal("Du hast nicht genügend Rechte.")); return 0; } ServerPlayer target = net.minecraft.commands.arguments.EntityArgument.getPlayer(ctx, "player"); unmutePlayer(ctx.getSource(), target); return 1; })))
                .then(Commands.literal("audit").executes(ctx -> { if (!PermissionUtil.hasAdminPermission(ctx.getSource())) { ctx.getSource().sendFailure(Component.literal("Du hast nicht genügend Rechte.")); return 0; } showAuditLog(ctx.getSource()); return 1; }))
            );
            statusTree = statusTree.then(Commands.literal("badge")
                .then(Commands.literal("clear").then(Commands.argument("player", net.minecraft.commands.arguments.EntityArgument.player()).executes(ctx -> { if (!PermissionUtil.hasAdminPermission(ctx.getSource())) { ctx.getSource().sendFailure(Component.literal("Du hast nicht genügend Rechte.")); return 0; } ServerPlayer target = net.minecraft.commands.arguments.EntityArgument.getPlayer(ctx, "player"); clearPlayerBadge(ctx.getSource(), target); return 1; })))
                .then(Commands.argument("player", net.minecraft.commands.arguments.EntityArgument.player())
        .executes(ctx -> { if (!PermissionUtil.hasAdminPermission(ctx.getSource())) { ctx.getSource().sendFailure(Component.literal("Du hast nicht genügend Rechte.")); return 0; } ServerPlayer target = net.minecraft.commands.arguments.EntityArgument.getPlayer(ctx, "player"); showPlayerBadge(ctx.getSource(), target); return 1; })
        .then(Commands.argument("badge", StringArgumentType.greedyString()).executes(ctx -> { if (!PermissionUtil.hasAdminPermission(ctx.getSource())) { ctx.getSource().sendFailure(Component.literal("Du hast nicht genügend Rechte.")); return 0; } ServerPlayer target = net.minecraft.commands.arguments.EntityArgument.getPlayer(ctx, "player"); setPlayerBadge(ctx.getSource(), target, StringArgumentType.getString(ctx, "badge")); return 1; })))

            );

        statusTree = statusTree.then(Commands.literal("avatar")
        .then(Commands.argument("args", StringArgumentType.greedyString()).suggests((ctx, builder) -> net.minecraft.commands.SharedSuggestionProvider.suggest(new String[]{"off"}, builder)).executes(ctx -> { setAvatar(ctx.getSource(), StringArgumentType.getString(ctx, "args")); return 1; })));
        statusTree = statusTree.then(Commands.literal("sidebar")
        .then(Commands.argument("value", StringArgumentType.word()).suggests((ctx, builder) -> net.minecraft.commands.SharedSuggestionProvider.suggest(new String[]{"on", "off", "an", "aus"}, builder)).executes(ctx -> { return setSidebar(ctx.getSource(), StringArgumentType.getString(ctx, "value")); })));
        statusTree = statusTree.then(Commands.literal("topbar")
        .then(Commands.argument("value", StringArgumentType.word()).suggests((ctx, builder) -> net.minecraft.commands.SharedSuggestionProvider.suggest(new String[]{"on", "off", "an", "aus"}, builder)).executes(ctx -> { return setTopbar(ctx.getSource(), StringArgumentType.getString(ctx, "value")); })));
        statusTree = statusTree.then(Commands.literal("apikey")
        .then(Commands.argument("key", StringArgumentType.greedyString()).executes(ctx -> { return setApiKey(ctx.getSource(), StringArgumentType.getString(ctx, "key")); })));
        statusTree = statusTree.then(Commands.literal("transfer")
        .then(Commands.argument("server", StringArgumentType.word())
        .then(Commands.argument("key", StringArgumentType.word()).executes(ctx -> { return transferFrom(ctx.getSource(), StringArgumentType.getString(ctx, "server"), StringArgumentType.getString(ctx, "key")); }))));
        statusTree = statusTree.then(Commands.literal("sync")
        .executes(ctx -> { showSyncStatus(ctx.getSource()); return 1; }));
        statusTree = statusTree.then(Commands.literal("apikey")
        .then(Commands.argument("key", StringArgumentType.greedyString()).executes(ctx -> { return setApiKey(ctx.getSource(), StringArgumentType.getString(ctx, "key")); })));
        statusTree = statusTree.then(Commands.literal("transfer")
        .then(Commands.argument("server", StringArgumentType.word())
        .then(Commands.argument("key", StringArgumentType.word()).executes(ctx -> { return transferFrom(ctx.getSource(), StringArgumentType.getString(ctx, "server"), StringArgumentType.getString(ctx, "key")); }))));
        statusTree = statusTree.then(Commands.literal("setup-secret")
        .then(Commands.argument("secret", StringArgumentType.greedyString()).executes(ctx -> { return setSetupSecret(ctx.getSource(), StringArgumentType.getString(ctx, "secret")); })));
        }
        statusTree = statusTree.then(Commands.literal("config").then(Commands.literal("reload").executes(ctx -> { if (!PermissionUtil.hasAdminPermission(ctx.getSource())) { ctx.getSource().sendFailure(Component.literal("Du hast nicht genügend Rechte, um diese Aktion auszuführen.")); return 0; } StatusMod.config = ModConfig.load(); CommandUtil.sendSuccess(ctx.getSource(), Component.literal("StatusMod configuration reloaded."), false); return 1; }))            .then(Commands.literal("show").executes(ctx -> { if (!PermissionUtil.hasAdminPermission(ctx.getSource())) { ctx.getSource().sendFailure(Component.literal("Du hast nicht genügend Rechte, um diese Aktion auszuführen.")); return 0; } ModConfig c = StatusMod.getConfig(); CommandUtil.sendSuccess(ctx.getSource(), Component.literal("StatusMod configuration:"), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" adminOpLevel = " + c.adminOpLevel), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" statusPermissionNode = " + c.statusPermissionNode), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" adminPermissionNode = " + c.adminPermissionNode), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" enableAdminOverrides = " + c.enableAdminOverrides), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" defaultColor = " + c.defaultColor), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" statusReapplyTicks = " + c.statusReapplyTicks), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" statusCooldownSeconds = " + c.statusCooldownSeconds), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" statusHistorySize = " + c.statusHistorySize), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" enableStaffBadge = " + c.enableStaffBadge), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" staffBadgeText = " + c.staffBadgeText), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" staffBadgeColor = " + c.staffBadgeColor), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" staffBadgeBrackets = " + c.staffBadgeBrackets), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" staffBadges (Overrides) = " + (c.staffBadges == null ? 0 : c.staffBadges.size())), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" enableAutoAfk = " + c.enableAutoAfk), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" afkTimeoutSeconds = " + c.afkTimeoutSeconds), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" restoreStatusOnJoin = " + c.restoreStatusOnJoin), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" restoreAfkOnJoin = " + c.restoreAfkOnJoin), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" restoreTimedOnJoin = " + c.restoreTimedOnJoin), false); CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" Features:"), false); for (Map.Entry<String, Boolean> fe : c.features.entrySet()) { CommandUtil.sendSuccess(ctx.getSource(), Component.literal("   " + fe.getKey() + " = " + fe.getValue()), false); } return 1; })));
        statusTree = statusTree.then(Commands.literal("feature").then(Commands.literal("list").executes(ctx -> { if (!PermissionUtil.hasAdminPermission(ctx.getSource())) { ctx.getSource().sendFailure(Component.literal("Du hast nicht genügend Rechte.")); return 0; } ModConfig c = StatusMod.getConfig(); CommandUtil.sendSuccess(ctx.getSource(), Component.literal("Features:"), false); for (Map.Entry<String, Boolean> fe : c.features.entrySet()) { CommandUtil.sendSuccess(ctx.getSource(), Component.literal(" " + fe.getKey() + " = " + fe.getValue()), false); } return 1; }))
            .then(Commands.argument("key", StringArgumentType.word()).then(Commands.argument("value", StringArgumentType.word()).suggests((ctx, builder) -> net.minecraft.commands.SharedSuggestionProvider.suggest(new String[]{"on","off","true","false","an","aus"}, builder)).executes(ctx -> { if (!PermissionUtil.hasAdminPermission(ctx.getSource())) { ctx.getSource().sendFailure(Component.literal("Du hast nicht genügend Rechte.")); return 0; } return setFeature(ctx.getSource(), StringArgumentType.getString(ctx, "key"), StringArgumentType.getString(ctx, "value")); }))));
        StatusGuiCommand.register(dispatcher);
        dispatcher.register(statusTree);
    }

    /** Built-in presets in stable GUI order. */
    public static final java.util.List<String> BUILTIN_PRESET_ORDER =
        java.util.List.of("afk", "busy", "stream", "shop");

    /** Own custom presets of a player: {name, status, color}, sorted by name. */
    public static java.util.List<String[]> getOwnCustomEntries(ServerPlayer player) {
        java.util.List<String[]> out = new java.util.ArrayList<>();
        try {
            if (player == null) return out;
            String uuid = player.getUUID().toString();
            for (java.util.Map.Entry<String, com.teufel.statusmod.storage.CustomPresets.CustomPreset> e
                    : StatusMod.getCustomPresets().getAll().entrySet()) {
                if (e.getValue() != null && uuid.equals(e.getValue().creator)) {
                    out.add(new String[]{e.getKey(),
                        e.getValue().status == null ? "" : e.getValue().status,
                        e.getValue().color == null ? "reset" : e.getValue().color});
                }
            }
            out.sort((a, b) -> a[0].compareToIgnoreCase(b[0]));
        } catch (Exception ignored) {}
        return out;
    }

    /** Current raw status text of the command source player ("" if none). */
    public static String getOwnStatusText(CommandSourceStack src) {
        try {
            ServerPlayer player = src.getPlayer();
            if (player == null) return "";
            PlayerSettings s = StatusMod.getStorage().forPlayer(player.getUUID().toString());
            return (s == null || s.status == null) ? "" : s.status;
        } catch (Exception ignored) {
            return "";
        }
    }

    /** Expiry timestamp of the current timed status, 0 if none. */
    public static long getOwnStatusExpiresAt(CommandSourceStack src) {
        try {
            ServerPlayer player = src.getPlayer();
            if (player == null) return 0L;
            PlayerSettings s = StatusMod.getStorage().forPlayer(player.getUUID().toString());
            return s == null ? 0L : s.statusExpiresAtMs;
        } catch (Exception ignored) {
            return 0L;
        }
    }

    /** Current status color of the command source player (may be null). */
    public static net.minecraft.network.chat.TextColor getOwnStatusColor(CommandSourceStack src) {
        try {
            ServerPlayer player = src.getPlayer();
            if (player == null) return null;
            PlayerSettings s = StatusMod.getStorage().forPlayer(player.getUUID().toString());
            if (s == null) return null;
            return ColorMapper.parseDirectColor(s.color);
        } catch (Exception ignored) {
            return null;
        }
    }

    /** Opens the beginner-friendly self-status GUI (bare /status). */
    public static void openSelfStatusGui(CommandSourceStack src) {
        try {
            if (StatusMod.getConfig() == null || !StatusMod.getConfig().isEnabled("status")) {
                src.sendFailure(Component.literal("Das Status-Feature ist auf diesem Server deaktiviert."));
                return;
            }
            ServerPlayer player;
            try {
                player = src.getPlayer();
            } catch (Exception e) {
                player = null;
            }
            if (player == null) {
                src.sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen."));
                return;
            }
            if (!PermissionUtil.hasStatusPermission(src)) {
                src.sendFailure(Component.literal("Du hast keine Berechtigung, den Status-Mod zu nutzen."));
                return;
            }
            final ServerPlayer fPlayer = player;
            final CommandSourceStack fSource = src;
            final java.util.List<com.teufel.statusmod.gui.SelfStatusMenu.Entry> entries = new java.util.ArrayList<>();
            for (String key : BUILTIN_PRESET_ORDER) {
                Preset p = PRESETS.get(key);
                if (p != null) entries.add(new com.teufel.statusmod.gui.SelfStatusMenu.Entry(key, p.status, p.color));
            }
            java.util.Set<String> usedKeys = new java.util.HashSet<>();
            for (String key : BUILTIN_PRESET_ORDER) usedKeys.add(key.toLowerCase(java.util.Locale.ROOT));
            for (String[] c : getOwnCustomEntries(player)) {
                String key = c[0].toLowerCase(java.util.Locale.ROOT);
                if (usedKeys.contains(key)) continue;
                usedKeys.add(key);
                entries.add(new com.teufel.statusmod.gui.SelfStatusMenu.Entry(c[0], c[1], c[2]));
            }
            if (StatusMod.getServerPresets() != null) {
                java.util.Map<String, com.teufel.statusmod.storage.ServerPresets.ServerPreset> serverPresets =
                    StatusMod.getServerPresets().getAll();
                java.util.List<String> names = new java.util.ArrayList<>(serverPresets.keySet());
                java.util.Collections.sort(names);
                for (String name : names) {
                    String key = name.toLowerCase(java.util.Locale.ROOT);
                    if (usedKeys.contains(key)) continue;
                    com.teufel.statusmod.storage.ServerPresets.ServerPreset p = serverPresets.get(key);
                    if (p == null || p.status == null || p.status.isEmpty()) continue;
                    usedKeys.add(key);
                    entries.add(new com.teufel.statusmod.gui.SelfStatusMenu.Entry(name, p.status, p.color));
                }
            }
            net.minecraft.world.MenuProvider provider = new net.minecraft.world.MenuProvider() {
                @Override
                public Component getDisplayName() {
                    return Component.literal("Dein Status");
                }

                @Override
                public net.minecraft.world.inventory.AbstractContainerMenu createMenu(int syncId,
                        net.minecraft.world.entity.player.Inventory playerInv,
                        net.minecraft.world.entity.player.Player p) {
                    return new com.teufel.statusmod.gui.SelfStatusMenu(syncId, playerInv, fPlayer, fSource, entries);
                }
            };
            player.openMenu(provider);
        } catch (Exception e) {
            try {
                src.sendFailure(Component.literal("Menü konnte nicht geöffnet werden."));
            } catch (Exception ignore) {}
            e.printStackTrace();
        }
    }

    /** GUI entry point: apply a preset by key (built-in or own custom). */
    public static void guiApplyPreset(CommandSourceStack src, String key) {
        applyPreset(src, key);
    }

    /** GUI entry point: clear own status. */
    public static void guiClearStatus(CommandSourceStack src) {
        clearStatus(src);
    }

    /** GUI entry point: apply the next preset after the current status (wraps). */
    public static void guiCyclePreset(CommandSourceStack src) {
        try {
            ServerPlayer player = src.getPlayer();
            if (player == null) {
                src.sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen."));
                return;
            }
            java.util.List<String> keys = new java.util.ArrayList<>(BUILTIN_PRESET_ORDER);
            java.util.Map<String, String> statusByKey = new java.util.HashMap<>();
            for (String k : BUILTIN_PRESET_ORDER) {
                Preset p = PRESETS.get(k);
                if (p != null) statusByKey.put(k, p.status);
            }
            for (String[] c : getOwnCustomEntries(player)) {
                keys.add(c[0]);
                statusByKey.put(c[0], c[1]);
            }
            if (StatusMod.getServerPresets() != null) {
                java.util.List<String> names = new java.util.ArrayList<>(StatusMod.getServerPresets().getAll().keySet());
                java.util.Collections.sort(names);
                for (String name : names) {
                    com.teufel.statusmod.storage.ServerPresets.ServerPreset p = StatusMod.getServerPresets().get(name);
                    if (p == null || p.status == null || p.status.isEmpty()) continue;
                    boolean duplicate = keys.stream().anyMatch(k -> k.equalsIgnoreCase(name));
                    if (duplicate) continue;
                    keys.add(name);
                    statusByKey.put(name, p.status);
                }
            }
            keys.removeIf(k -> !statusByKey.containsKey(k));
            if (keys.isEmpty()) {
                src.sendFailure(Component.literal("Keine Presets verfügbar."));
                return;
            }
            String current = getOwnStatusText(src).trim();
            int idx = -1;
            for (int i = 0; i < keys.size(); i++) {
                String st = statusByKey.get(keys.get(i));
                if (st != null && st.equalsIgnoreCase(current)) {
                    idx = i;
                    break;
                }
            }
            applyPreset(src, keys.get((idx + 1) % keys.size()));
        } catch (Exception e) {
            try {
                src.sendFailure(Component.literal("Fehler beim Wechseln des Presets."));
            } catch (Exception ignore) {}
            e.printStackTrace();
        }
    }

    private static int setFeature(CommandSourceStack src, String key, String value) {
        try {
            ModConfig c = StatusMod.getConfig();
            if (c == null) { src.sendFailure(Component.literal("Keine Konfiguration geladen.")); return 0; }
            if (!c.features.containsKey(key)) {
                src.sendFailure(Component.literal("Unbekanntes Feature: " + key + " (verfügbar: " + String.join(", ", c.features.keySet()) + ")"));
                return 0;
            }
            boolean on = value != null && (value.equalsIgnoreCase("on") || value.equalsIgnoreCase("true") || value.equalsIgnoreCase("an") || value.equalsIgnoreCase("ein"));
            boolean off = value != null && (value.equalsIgnoreCase("off") || value.equalsIgnoreCase("false") || value.equalsIgnoreCase("aus"));
            if (!on && !off) {
                src.sendFailure(Component.literal("Ungültiger Wert. Nutze on/off/true/false."));
                return 0;
            }
            c.setFeature(key, on);
            c.save();
            CommandUtil.sendSuccess(src, Component.literal("Feature '" + key + "' ist jetzt " + (on ? "AN" : "AUS") + "."), false);
            return 1;
        } catch (Exception e) { e.printStackTrace(); return 0; }
    }

    private static void setStatus(CommandSourceStack src, String status, String colorKey) {
        try {
            if (!StatusMod.getConfig().isEnabled("status")) { src.sendFailure(Component.literal("Das Status-Feature ist auf diesem Server deaktiviert.")); return; }
            ServerPlayer player = src.getPlayer();
            if (player == null) { src.sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen.")); return; }
            if (!PermissionUtil.hasStatusPermission(src)) { src.sendFailure(Component.literal("Du hast keine Berechtigung, den Status-Mod zu nutzen.")); return; }
            String uuid = player.getUUID().toString();
            if (checkBlockedOrMuted(src, uuid)) return;
            PlayerSettings settings = StatusMod.getStorage().forPlayer(uuid);
            if (!checkCooldown(src, settings)) return;
            StatusUpdate update = parseStatusInput(status, colorKey, settings);
            if (!update.ok) { src.sendFailure(Component.literal(update.error)); return; }
            Long expiresAt = update.durationMs == null ? null : System.currentTimeMillis() + update.durationMs;
            applyStatusUpdate(src, player, settings, update, false, expiresAt, false);
            AuditLogger.logSet(player.getScoreboardName(), player.getScoreboardName(), update.status, update.color);
            String msg = "Status gesetzt: " + update.status + " (" + update.color + ")";
            if (update.durationMs != null) msg += " - läuft in " + DurationUtil.formatDuration(update.durationMs) + " ab.";
            CommandUtil.sendSuccess(src, Component.literal(msg), false);
        } catch (Exception e) { try { src.sendFailure(Component.literal("Fehler beim Setzen des Status.")); } catch(Exception ignore){} e.printStackTrace(); }
    }

    private static void clearStatus(CommandSourceStack src) { try { ServerPlayer player = src.getPlayer(); if (player == null) { src.sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen.")); return; } if (!PermissionUtil.hasStatusPermission(src)) { src.sendFailure(Component.literal("Du hast keine Berechtigung.")); return; } String uuid = player.getUUID().toString(); if (checkBlockedOrMuted(src, uuid)) return; PlayerSettings settings = StatusMod.getStorage().forPlayer(uuid); if (!checkCooldown(src, settings)) return; settings.autoAfk = false; settings.preAfkStatus = ""; settings.preAfkColor = "reset"; settings.lastActivityAtMs = System.currentTimeMillis(); SyncManager.requestPush(); settings.status=""; settings.color="reset"; settings.statusExpiresAtMs=0L; settings.timedPrevStatus=""; settings.timedPrevColor="reset"; StatusMod.getStorage().put(uuid, settings); StatusTeamUtil.applyStatus(src.getServer().getScoreboard(), player, settings, "", "reset", PermissionUtil.hasAdminPermission(player)); AuditLogger.logClear(player.getScoreboardName(), player.getScoreboardName()); CommandUtil.sendSuccess(src, Component.literal("Status gelöscht."), false);} catch (Exception e){try{src.sendFailure(Component.literal("Fehler beim Löschen des Status."));}catch(Exception ignore){} e.printStackTrace();}}

    /**
     * Chat-based online overview (Bedrock-compatible: the Bedrock player list
     * cannot show team prefix/suffix, so this is the readable alternative).
     */
    private static void listOnlineStatuses(CommandSourceStack src) {
        try {
            if (StatusMod.getConfig() == null || !StatusMod.getConfig().isEnabled("status")) {
                src.sendFailure(Component.literal("Das Status-Feature ist auf diesem Server deaktiviert."));
                return;
            }
            if (!PermissionUtil.hasStatusPermission(src)) {
                src.sendFailure(Component.literal("Du hast keine Berechtigung, den Status-Mod zu nutzen."));
                return;
            }
            net.minecraft.server.MinecraftServer server = src.getServer();
            if (server == null) {
                src.sendFailure(Component.literal("Server nicht gefunden."));
                return;
            }
            java.util.List<ServerPlayer> players = new java.util.ArrayList<>(server.getPlayerList().getPlayers());
            players.sort((a, b) -> a.getScoreboardName().compareToIgnoreCase(b.getScoreboardName()));
            CommandUtil.sendSuccess(src, Component.literal("Online (" + players.size() + "):"), false);
            com.teufel.statusmod.storage.ModConfig cfg = StatusMod.getConfig();
            for (ServerPlayer p : players) {
                String uuid = p.getUUID().toString();
                PlayerSettings s = StatusMod.getStorage().forPlayer(uuid);
                String st = StatusTextUtil.resolveStatusForPlayer(s, p);
                String ck = StatusTextUtil.resolveColorForPlayer(s, p);
                boolean admin = PermissionUtil.hasAdminPermission(p);
                Component suffix = com.teufel.statusmod.util.StatusTeamUtil.buildDisplaySuffix(s, st, ck, uuid, admin, cfg);
                MutableComponent line = Component.literal("\u2022 " + p.getScoreboardName());
                if (suffix != null && !suffix.getString().isEmpty()) {
                    if (s != null && s.beforeName) {
                        line = (MutableComponent) suffix.copy().append(Component.literal(" ")).append(line);
                    } else {
                        line.append(Component.literal(" ")).append(suffix);
                    }
                } else {
                    line.append(Component.literal(" -").withStyle(ChatFormatting.GRAY));
                }
                CommandUtil.sendSuccess(src, line, false);
            }
        } catch (Exception e) {
            try {
                src.sendFailure(Component.literal("Fehler beim Auflisten der Stati."));
            } catch (Exception ignore) {}
            e.printStackTrace();
        }
    }

    private static int setTopbar(CommandSourceStack src, String value) {
        try {
            if (!PermissionUtil.hasAdminPermission(src)) {
                src.sendFailure(Component.literal("Du hast nicht genügend Rechte."));
                return 0;
            }
            boolean on = value != null && (value.equalsIgnoreCase("on") || value.equalsIgnoreCase("true") || value.equalsIgnoreCase("an") || value.equalsIgnoreCase("ein"));
            boolean off = value != null && (value.equalsIgnoreCase("off") || value.equalsIgnoreCase("false") || value.equalsIgnoreCase("aus"));
            if (!on && !off) {
                src.sendFailure(Component.literal("Ungültiger Wert. Nutze on/off."));
                return 0;
            }
            ModConfig c = StatusMod.getConfig();
            if (c == null) {
                src.sendFailure(Component.literal("Keine Konfiguration geladen."));
                return 0;
            }
            c.bossbarListEnabled = on;
            c.save();
            CommandUtil.sendSuccess(src, Component.literal("Top-Bar ist jetzt " + (on ? "AN" : "AUS") + "."), false);
            return 1;
        } catch (Exception e) {
            e.printStackTrace();
            return 0;
        }
    }

    private static final HttpClient TRANSFER_HTTP = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .version(HttpClient.Version.HTTP_1_1)
        .build();

    /**
     * Stores the dashboard API key ingame (admin only, persisted).
     * NOTE: typed commands land in the server log - prefer console.
     */
    private static int setApiKey(CommandSourceStack src, String key) {
        try {
            if (!PermissionUtil.hasAdminPermission(src)) {
                src.sendFailure(Component.literal("Du hast nicht genügend Rechte."));
                return 0;
            }
            String v = key == null ? "" : key.trim();
            // Pasted keys sometimes carry quotes/whitespace (breaks server-side
            // matching with 401) - strip them, keep the inner value.
            while (v.length() >= 2 && ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'")))) {
                v = v.substring(1, v.length() - 1).trim();
            }
            if (v.isEmpty()) {
                src.sendFailure(Component.literal("Kein Key angegeben."));
                return 0;
            }
            ModConfig c = StatusMod.getConfig();
            if (c == null) {
                src.sendFailure(Component.literal("Keine Konfiguration geladen."));
                return 0;
            }
            c.apiKey = v;
            c.save();
            SyncManager.start();
            if (!v.startsWith("sm_")) {
                CommandUtil.sendSuccess(src, Component.literal("API-Key gespeichert (Hinweis: beginnt normalerweise mit sm_). Sync startet bei konfiguriertem Dashboard, sonst nach Neustart."), false);
            } else {
                CommandUtil.sendSuccess(src, Component.literal("API-Key gespeichert. Sync startet bei konfiguriertem Dashboard, sonst nach Neustart."), false);
            }
            return 1;
        } catch (Exception e) {
            e.printStackTrace();
            return 0;
        }
    }

    /**
     * Stores the dashboard setup secret ingame (admin only, persisted).
     * Used for secret rotation without file access. Takes effect on restart
     * (setup runs at boot). NOTE: typed commands land in the server log -
     * prefer console or direct config edit for maximum secrecy. The secret is
     * never echoed back.
     */
    private static int setSetupSecret(CommandSourceStack src, String secret) {
        try {
            if (!PermissionUtil.hasAdminPermission(src)) {
                src.sendFailure(Component.literal("Du hast nicht genügend Rechte."));
                return 0;
            }
            String v = secret == null ? "" : secret.trim();
            while (v.length() >= 2 && ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'")))) {
                v = v.substring(1, v.length() - 1).trim();
            }
            if (v.isEmpty()) {
                src.sendFailure(Component.literal("Kein Secret angegeben."));
                return 0;
            }
            if (v.contains(" ")) {
                src.sendFailure(Component.literal("Ungültiges Secret (keine Leerzeichen erlaubt)."));
                return 0;
            }
            ModConfig c = StatusMod.getConfig();
            if (c == null) {
                src.sendFailure(Component.literal("Keine Konfiguration geladen."));
                return 0;
            }
            c.setupSecret = v;
            c.save();
            CommandUtil.sendSuccess(src, Component.literal("Setup-Secret gespeichert. Server neu starten, damit es aktiv wird."), false);
            return 1;
        } catch (Exception e) {
            e.printStackTrace();
            return 0;
        }
    }

    /**
     * Transfers player statuses from another server on the same dashboard
     * backend (needs that server's id + api key). Merges status/color/avatar/
     * username into local storage; online players refresh live. Mutes, blocks
     * and presets stay local. Runs in a background thread (network IO).
     */
    private static int transferFrom(CommandSourceStack src, String serverId, String key) {
        try {
            if (!PermissionUtil.hasAdminPermission(src)) {
                src.sendFailure(Component.literal("Du hast nicht genügend Rechte."));
                return 0;
            }
            String sid = serverId == null ? "" : serverId.trim();
            String k = key == null ? "" : key.trim();
            try {
                UUID.fromString(sid);
            } catch (Exception e) {
                src.sendFailure(Component.literal("Ungültige Server-ID (UUID erwartet)."));
                return 0;
            }
            if (k.isEmpty()) {
                src.sendFailure(Component.literal("Kein API-Key angegeben."));
                return 0;
            }
            ModConfig c = StatusMod.getConfig();
            if (c == null || c.effectiveDashboardUrl().isEmpty()) {
                src.sendFailure(Component.literal("Keine Dashboard-URL konfiguriert."));
                return 0;
            }
            String base = c.effectiveDashboardUrl();
            while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
            if (!CodeGenerator.isSecureHttpUrl(base)) {
                src.sendFailure(Component.literal("Dashboard-URL muss HTTPS oder Loopback sein (API-Key-Schutz)."));
                return 0;
            }
            final String endpoint = base + "/api/players/" + sid;
            final net.minecraft.server.MinecraftServer server = src.getServer();
            // Online-Spieler hier snapshotten (Befehlsthread): getPlayerList
            // ist nicht threadsicher und darf nicht im Worker laufen.
            final java.util.Map<String, ServerPlayer> onlineSnapshot = new java.util.HashMap<>();
            if (server != null) {
                try {
                    for (ServerPlayer p : server.getPlayerList().getPlayers()) {
                        onlineSnapshot.put(p.getUUID().toString(), p);
                    }
                } catch (Throwable ignored) {}
            }
            CommandUtil.sendSuccess(src, Component.literal("Transfer gestartet (Hintergrund)..."), false);
            Thread t = new Thread(() -> {
                try {
                    HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(endpoint))
                        .timeout(Duration.ofSeconds(20))
                        .header("x-api-key", k)
                        .GET()
                        .build();
                    HttpResponse<java.io.InputStream> response = TRANSFER_HTTP.send(request, HttpResponse.BodyHandlers.ofInputStream());
                    if (response.statusCode() < 200 || response.statusCode() >= 300) {
                        try { response.body().close(); } catch (Exception ignored) {}
                        reply(src, server, false, "Transfer fehlgeschlagen (HTTP " + response.statusCode() + "). ID/Key prüfen.");
                        return;
                    }
                    String transferBody;
                    try (java.io.InputStream in = response.body()) {
                        transferBody = CodeGenerator.readCapped(in, CodeGenerator.MAX_BODY_BYTES);
                    }
                    com.google.gson.JsonElement parsed;
                    try {
                        parsed = com.google.gson.JsonParser.parseString(transferBody);
                    } catch (Exception e) {
                        reply(src, server, false, "Transfer fehlgeschlagen (ungültige Antwort).");
                        return;
                    }
                    if (!parsed.isJsonArray()) {
                        reply(src, server, false, "Transfer fehlgeschlagen (unerwartetes Format).");
                        return;
                    }
                    int count = 0;
                    // Scoreboard-Änderungen dürfen nur im Server-Thread
                    // passieren -> hier sammeln, unten via server.execute().
                    java.util.List<Runnable> applies = new java.util.ArrayList<>();
                    for (com.google.gson.JsonElement el : parsed.getAsJsonArray()) {
                        if (count >= 5000) break;
                        if (!el.isJsonObject()) continue;
                        com.google.gson.JsonObject o = el.getAsJsonObject();
                        if (!o.has("uuid")) continue;
                        String uuid;
                        try {
                            uuid = o.get("uuid").getAsString();
                            UUID.fromString(uuid);
                        } catch (Exception e) {
                            continue;
                        }
                        try {
                            PlayerSettings s = StatusMod.getStorage().forPlayer(uuid);
                            if (o.has("username") && !o.get("username").isJsonNull()) {
                                String un = StatusTextUtil.sanitizePlayerText(o.get("username").getAsString(), 16);
                                if (!un.isEmpty()) s.lastKnownName = un;
                            }
                            if (o.has("status") && !o.get("status").isJsonNull()) {
                                s.status = StatusTextUtil.sanitizePlayerText(o.get("status").getAsString(), 64);
                            }
                            if (o.has("color") && !o.get("color").isJsonNull()) {
                                String rc = o.get("color").getAsString();
                                s.color = (rc != null && ColorMapper.isValidColorInput(rc)
                                    && rc.length() <= 32) ? rc : "reset";
                            }
                            if (o.has("avatar") && !o.get("avatar").isJsonNull()) {
                                s.avatar = StatusTextUtil.sanitizePlayerText(o.get("avatar").getAsString(), 160);
                            }
                            StatusMod.getStorage().put(uuid, s);
                            ServerPlayer online = onlineSnapshot.get(uuid);
                            if (online != null) {
                                final PlayerSettings fs = s;
                                final ServerPlayer fo = online;
                                final net.minecraft.server.MinecraftServer fserver = server;
                                applies.add(() -> {
                                    try {
                                        String st = StatusTextUtil.resolveStatusForPlayer(fs, fo);
                                        String ck = StatusTextUtil.resolveColorForPlayer(fs, fo);
                                        StatusTeamUtil.applyStatus(fserver.getScoreboard(), fo, fs, st, ck,
                                            PermissionUtil.hasAdminPermission(fo));
                                    } catch (Throwable ignored) {}
                                });
                            }
                            count++;
                        } catch (Throwable ignored) {}
                    }
                    if (server != null && !applies.isEmpty()) {
                        try {
                            server.execute(() -> {
                                for (Runnable r : applies) {
                                    try { r.run(); } catch (Throwable ignored) {}
                                }
                            });
                        } catch (Throwable ignored) {}
                    }
                    reply(src, server, true, count + " Spieler von " + sid + " übertragen.");
                } catch (Throwable e) {
                    reply(src, server, false, "Transfer fehlgeschlagen (" + e.getMessage() + ").");
                }
            }, "statusmod-transfer");
            t.setDaemon(true);
            t.start();
            return 1;
        } catch (Exception e) {
            e.printStackTrace();
            return 0;
        }
    }

    private static void reply(CommandSourceStack src, net.minecraft.server.MinecraftServer server, boolean ok, String msg) {
        Runnable r = () -> {
            try {
                if (ok) {
                    CommandUtil.sendSuccess(src, Component.literal(msg), false);
                } else {
                    src.sendFailure(Component.literal(msg));
                }
            } catch (Throwable ignored) {}
        };
        try {
            if (server != null) {
                server.execute(r);
            } else {
                r.run();
            }
        } catch (Throwable ignored) {}
    }

    /**
     * Shows sync wiring + last results (admin only; key only as prefix).
     * Helps diagnosing 401s (wrong key/server) without touching files.
     */
    private static void showVersion(CommandSourceStack src) {
        // Checked in the executor on purpose: a .requires gate on the literal
        // would let non-admins fall through to the greedy /status <text>
        // argument and set a status named "version" instead.
        if (!PermissionUtil.hasAdminPermission(src)) {
            src.sendFailure(Component.literal("Du hast nicht genügend Rechte."));
            return;
        }
        CommandUtil.sendSuccess(src, Component.literal("Status Player " + StatusMod.VERSION + " (build " + StatusMod.BUILD + ")"), false);
    }

    private static void showSyncStatus(CommandSourceStack src) {
        try {
            if (!PermissionUtil.hasAdminPermission(src)) {
                src.sendFailure(Component.literal("Du hast nicht genügend Rechte."));
                return;
            }
            ModConfig c = StatusMod.getConfig();
            if (c == null) {
                src.sendFailure(Component.literal("Keine Konfiguration geladen."));
                return;
            }
            String url = c.effectiveDashboardUrl();
            String sid = c.serverId == null ? "" : c.serverId.trim();
            String key = c.apiKey == null ? "" : c.apiKey.trim();
            String keyInfo = key.isEmpty() ? "nein" : "ja (" + key.substring(0, Math.min(6, key.length())) + "…)";
            CommandUtil.sendSuccess(src, Component.literal("Sync-Status:"), false);
            CommandUtil.sendSuccess(src, Component.literal(" dashboard: " + (url.isEmpty() ? "-" : url)), false);
            CommandUtil.sendSuccess(src, Component.literal(" serverId: " + (sid.isEmpty() ? "-" : sid)), false);
            CommandUtil.sendSuccess(src, Component.literal(" apiKey: " + keyInfo), false);
            CommandUtil.sendSuccess(src, Component.literal(" letzter Push: " + SyncManager.lastPushInfo), false);
            CommandUtil.sendSuccess(src, Component.literal(" letzter Pull: " + SyncManager.lastPullInfo), false);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private static int setSidebar(CommandSourceStack src, String value) {
        try {
            if (!PermissionUtil.hasAdminPermission(src)) {
                src.sendFailure(Component.literal("Du hast nicht genügend Rechte."));
                return 0;
            }
            boolean on = value != null && (value.equalsIgnoreCase("on") || value.equalsIgnoreCase("true") || value.equalsIgnoreCase("an") || value.equalsIgnoreCase("ein"));
            boolean off = value != null && (value.equalsIgnoreCase("off") || value.equalsIgnoreCase("false") || value.equalsIgnoreCase("aus"));
            if (!on && !off) {
                src.sendFailure(Component.literal("Ungültiger Wert. Nutze on/off."));
                return 0;
            }
            ModConfig c = StatusMod.getConfig();
            if (c == null) {
                src.sendFailure(Component.literal("Keine Konfiguration geladen."));
                return 0;
            }
            c.sidebarListEnabled = on;
            c.save();
            CommandUtil.sendSuccess(src, Component.literal("Sidebar ist jetzt " + (on ? "AN" : "AUS") + "."), false);
            return 1;
        } catch (Exception e) {
            e.printStackTrace();
            return 0;
        }
    }

    private static void setAvatar(CommandSourceStack src, String rawArgs) { try { if (!StatusMod.getConfig().isEnabled("status")) { src.sendFailure(Component.literal("Das Status-Feature ist auf diesem Server deaktiviert.")); return; } String v = rawArgs == null ? "" : rawArgs.trim(); ServerPlayer actor = src.getPlayer(); if (v.contains(" ")) { String[] parts = v.split("\\s+", 2); if (!PermissionUtil.hasAdminPermission(src)) { src.sendFailure(Component.literal("Du hast nicht genügend Rechte, um andere Spieler zu verwalten.")); return; } ServerPlayer target = src.getServer().getPlayerList().getPlayerByName(parts[0]); if (target == null) { src.sendFailure(Component.literal("Spieler '" + parts[0] + "' ist nicht online.")); return; } applyAvatar(src, target, parts[1].trim()); return; } if (actor == null) { src.sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen.")); return; } applyAvatar(src, actor, v); } catch (Exception e) { try { src.sendFailure(Component.literal("Fehler beim Setzen des Avatars.")); } catch (Exception ignore) {} e.printStackTrace(); } }
private static void applyAvatar(CommandSourceStack src, ServerPlayer target, String value) { try { String v = value == null ? "" : value.trim(); boolean clear = v.equalsIgnoreCase("off") || v.equalsIgnoreCase("clear") || v.equalsIgnoreCase("reset"); if (!clear) { if (v.isEmpty()) { src.sendFailure(Component.literal("Nutze einen Spielernamen oder eine https:// Bild-URL (oder 'off' zum Entfernen).")); return; } if (v.length() > 160) { src.sendFailure(Component.literal("Zu lang (max. 160 Zeichen).")); return; } if (v.startsWith("https://")) { if (v.contains(" ") || !v.equals(StatusTextUtil.sanitizePlayerText(v, 160))) { src.sendFailure(Component.literal("Die URL enthält ungültige Zeichen.")); return; } } else if (!v.matches("[A-Za-z0-9_]{1,16}")) { src.sendFailure(Component.literal("Ungültig: Nutze einen Spielernamen (A-Z, 0-9, _) oder eine https:// URL zu einer Skin-PNG (http ist aus Sicherheitsgründen nicht erlaubt).")); return; } } String uuid = target.getUUID().toString(); PlayerSettings settings = StatusMod.getStorage().forPlayer(uuid); settings.avatar = clear ? "" : v; StatusMod.getStorage().put(uuid, settings); SyncManager.requestPush(); if (clear) { CommandUtil.sendSuccess(src, Component.literal("Avatar entfernt - das Dashboard zeigt wieder den Standard-Kopf."), false); } else { CommandUtil.sendSuccess(src, Component.literal("Avatar gesetzt: " + v + " (im Dashboard in ca. 30s sichtbar)"), false); } } catch (Exception e) { try { src.sendFailure(Component.literal("Fehler beim Setzen des Avatars.")); } catch (Exception ignore) {} e.printStackTrace(); } }

private static void adminSetStatus(CommandSourceStack src, String targetName, String status, String colorKey) { try { ServerPlayer target = src.getServer().getPlayerList().getPlayerByName(targetName); if (target == null) { src.sendFailure(Component.literal("Spieler '" + targetName + "' ist nicht online.")); return; } PlayerSettings settings = StatusMod.getStorage().forPlayer(target.getUUID().toString()); StatusUpdate update = parseStatusInput(status, colorKey, settings); if (!update.ok) { src.sendFailure(Component.literal(update.error)); return; } applyStatusUpdate(src, target, settings, update, false, update.durationMs == null ? null : System.currentTimeMillis() + update.durationMs, false); String who = src.getTextName(); AuditLogger.logSet(who, targetName, update.status, update.color); CommandUtil.sendSuccess(src, Component.literal("Status von " + targetName + " gesetzt: " + update.status + " (" + update.color + ")" + (update.durationMs != null ? " - läuft in " + DurationUtil.formatDuration(update.durationMs) + " ab." : "")), false); target.sendSystemMessage(Component.literal("Dein Status wurde von einem Administrator gesetzt."));} catch (Exception e){try{src.sendFailure(Component.literal("Fehler beim Setzen des Status für '" + targetName + "'."));}catch(Exception ignore){} e.printStackTrace();}}
    private static void adminSetColor(CommandSourceStack src, String targetName, String colorInput) { try { if (!StatusMod.getConfig().isEnabled("status")) { src.sendFailure(Component.literal("Das Status-Feature ist auf diesem Server deaktiviert.")); return; } ServerPlayer target = src.getServer().getPlayerList().getPlayerByName(targetName); if (target == null) { src.sendFailure(Component.literal("Spieler '" + targetName + "' ist nicht online.")); return; } String color = colorInput == null ? "" : colorInput.trim(); if (!ColorMapper.isValidColorInput(color)) { src.sendFailure(Component.literal("Ungültige Farbe: " + color)); return; } String uuid = target.getUUID().toString(); PlayerSettings settings = StatusMod.getStorage().forPlayer(uuid); settings.color = color; StatusMod.getStorage().put(uuid, settings); SyncManager.requestPush(); StatusTeamUtil.applyStatus(src.getServer().getScoreboard(), target, settings, StatusTextUtil.resolveStatusForPlayer(settings, target), StatusTextUtil.resolveColorForPlayer(settings, target), PermissionUtil.hasAdminPermission(target)); AuditLogger.logSet(src.getTextName(), targetName, "", color); CommandUtil.sendSuccess(src, Component.literal("Farbe von " + targetName + " gesetzt: " + color), false); target.sendSystemMessage(Component.literal("Deine Status-Farbe wurde von einem Administrator gesetzt."));} catch (Exception e){try{src.sendFailure(Component.literal("Fehler beim Setzen der Farbe für '" + targetName + "'."));}catch(Exception ignore){} e.printStackTrace();}}
    private static void adminClearStatus(CommandSourceStack src, String targetName) { try { ServerPlayer target = src.getServer().getPlayerList().getPlayerByName(targetName); if (target == null) { src.sendFailure(Component.literal("Spieler '" + targetName + "' ist nicht online.")); return; } PlayerSettings settings = StatusMod.getStorage().forPlayer(target.getUUID().toString()); settings.status=""; settings.color="reset"; settings.statusExpiresAtMs=0L; settings.timedPrevStatus=""; settings.timedPrevColor="reset"; StatusMod.getStorage().put(target.getUUID().toString(), settings); SyncManager.requestPush(); StatusTeamUtil.applyStatus(src.getServer().getScoreboard(), target, settings, "", "reset", PermissionUtil.hasAdminPermission(target)); String who = src.getTextName(); AuditLogger.logClear(who, targetName); CommandUtil.sendSuccess(src, Component.literal("Status von " + targetName + " gelöscht."), false); target.sendSystemMessage(Component.literal("Dein Status wurde von einem Administrator gelöscht."));} catch (Exception e){try{src.sendFailure(Component.literal("Fehler beim Löschen des Status für '" + targetName + "'."));}catch(Exception ignore){} e.printStackTrace();}}
    private static void applyPreset(CommandSourceStack src, String name) {
        try {
            if (!StatusMod.getConfig().isEnabled("presets")) { src.sendFailure(Component.literal("Das Preset-Feature ist auf diesem Server deaktiviert.")); return; }
            if (!PermissionUtil.hasStatusPermission(src)) { src.sendFailure(Component.literal("Du hast keine Berechtigung.")); return; }
            String key = (name == null ? "" : name).toLowerCase(java.util.Locale.ROOT);
            Preset preset = PRESETS.get(key);
            if (preset == null) {
                var custom = StatusMod.getCustomPresets().get(name);
                if (custom != null) {
                    ServerPlayer player = src.getPlayer();
                    if (player == null) { src.sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen.")); return; }
                    if (checkBlockedOrMuted(src, player.getUUID().toString())) return;
                    PlayerSettings settings = StatusMod.getStorage().forPlayer(player.getUUID().toString());
                    if (!checkCooldown(src, settings)) return;
                    StatusUpdate update = new StatusUpdate(custom.status, custom.color, settings.fontStyle, true, null);
                    applyStatusUpdate(src, player, settings, update, false, null, false);
                    AuditLogger.logSet(player.getScoreboardName(), player.getScoreboardName(), custom.status, custom.color);
                    CommandUtil.sendSuccess(src, Component.literal("Preset '" + name + "' gesetzt: " + custom.status + " (" + custom.color + ")"), false);
                    return;
                }
                var serverPreset = StatusMod.getServerPresets() == null ? null : StatusMod.getServerPresets().get(name);
                if (serverPreset != null) {
                    ServerPlayer player = src.getPlayer();
                    if (player == null) { src.sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen.")); return; }
                    if (checkBlockedOrMuted(src, player.getUUID().toString())) return;
                    PlayerSettings settings = StatusMod.getStorage().forPlayer(player.getUUID().toString());
                    if (!checkCooldown(src, settings)) return;
                    String presetStatus = StatusTextUtil.sanitizePlayerText(serverPreset.status, MAX_STATUS_LENGTH);
                    String presetColor = ColorMapper.isValidColorInput(serverPreset.color) ? serverPreset.color : "reset";
                    StatusUpdate update = new StatusUpdate(presetStatus, presetColor, settings.fontStyle, true, null);
                    applyStatusUpdate(src, player, settings, update, false, null, false);
                    AuditLogger.logSet(player.getScoreboardName(), player.getScoreboardName(), presetStatus, presetColor);
                    CommandUtil.sendSuccess(src, Component.literal("Server-Preset '" + name + "' gesetzt: " + presetStatus + " (" + presetColor + ")"), false);
                    return;
                }
                src.sendFailure(Component.literal("Unbekanntes Preset: " + name));
                return;
            }
            ServerPlayer player = src.getPlayer();
            if (player == null) { src.sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen.")); return; }
            if (checkBlockedOrMuted(src, player.getUUID().toString())) return;
            PlayerSettings settings = StatusMod.getStorage().forPlayer(player.getUUID().toString());
            if (!checkCooldown(src, settings)) return;
            StatusUpdate update = new StatusUpdate(preset.status, preset.color, preset.font, true, null);
            applyStatusUpdate(src, player, settings, update, false, null, false);
            AuditLogger.logSet(player.getScoreboardName(), player.getScoreboardName(), preset.status, preset.color);
            CommandUtil.sendSuccess(src, Component.literal("Preset gesetzt: " + preset.status + " (" + preset.color + ")"), false);
        } catch (Exception e){try{src.sendFailure(Component.literal("Fehler beim Setzen des Presets."));}catch(Exception ignore){} e.printStackTrace();}
    }
    private static void setRandomStatus(CommandSourceStack src, String statusInput) { try { ServerPlayer player = src.getPlayer(); if (player == null) { src.sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen.")); return; } if (!PermissionUtil.hasStatusPermission(src)) { src.sendFailure(Component.literal("Du hast keine Berechtigung.")); return; } if (checkBlockedOrMuted(src, player.getUUID().toString())) return; PlayerSettings settings = StatusMod.getStorage().forPlayer(player.getUUID().toString()); if (!checkCooldown(src, settings)) return; StatusUpdate update = parseStatusInput(statusInput, null, settings); if (!update.ok) { src.sendFailure(Component.literal(update.error)); return; } update.color = pickStableRandomColor(player.getUUID().toString()); Long expiresAt = update.durationMs == null ? null : System.currentTimeMillis() + update.durationMs; applyStatusUpdate(src, player, settings, update, false, expiresAt, false); AuditLogger.logSet(player.getScoreboardName(), player.getScoreboardName(), update.status, update.color); CommandUtil.sendSuccess(src, Component.literal("Status gesetzt (random): " + update.status + " (" + update.color + ")" + (update.durationMs != null ? " - läuft in " + DurationUtil.formatDuration(update.durationMs) + " ab." : "")), false);} catch (Exception e){try{src.sendFailure(Component.literal("Fehler beim Setzen des random Status."));}catch(Exception ignore){} e.printStackTrace();}}
    private static void setTimedStatus(CommandSourceStack src, int minutes, String statusInput) { try { ServerPlayer player = src.getPlayer(); if (player == null) { src.sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen.")); return; } if (!PermissionUtil.hasStatusPermission(src)) { src.sendFailure(Component.literal("Du hast keine Berechtigung.")); return; } if (checkBlockedOrMuted(src, player.getUUID().toString())) return; PlayerSettings settings = StatusMod.getStorage().forPlayer(player.getUUID().toString()); if (!checkCooldown(src, settings)) return; StatusUpdate update = parseStatusInput(statusInput, null, settings); if (!update.ok) { src.sendFailure(Component.literal(update.error)); return; } applyStatusUpdate(src, player, settings, update, false, System.currentTimeMillis() + (minutes * 60L * 1000L), false); AuditLogger.logSet(player.getScoreboardName(), player.getScoreboardName(), update.status, update.color); CommandUtil.sendSuccess(src, Component.literal("Status gesetzt für " + DurationUtil.formatDuration(minutes * 60L * 1000L) + "."), false);} catch (Exception e){try{src.sendFailure(Component.literal("Fehler beim Setzen des Timed-Status."));}catch(Exception ignore){} e.printStackTrace();}}
    private static void setWorldStatus(CommandSourceStack src, String statusInput, String colorKey) { try { ServerPlayer player = src.getPlayer(); if (player == null) { src.sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen.")); return; } if (!PermissionUtil.hasStatusPermission(src)) { src.sendFailure(Component.literal("Du hast keine Berechtigung.")); return; } if (checkBlockedOrMuted(src, player.getUUID().toString())) return; PlayerSettings settings = StatusMod.getStorage().forPlayer(player.getUUID().toString()); if (!checkCooldown(src, settings)) return; StatusUpdate update = parseStatusInput(statusInput, colorKey, settings); if (!update.ok) { src.sendFailure(Component.literal(update.error)); return; } applyStatusUpdate(src, player, settings, update, true, null, false); AuditLogger.logSet(player.getScoreboardName(), player.getScoreboardName(), update.status, update.color); CommandUtil.sendSuccess(src, Component.literal("World-Status gesetzt."), false);} catch (Exception e){try{src.sendFailure(Component.literal("Fehler beim Setzen des World-Status."));}catch(Exception ignore){} e.printStackTrace();}}
    private static void clearWorldStatus(CommandSourceStack src) { try { ServerPlayer player = src.getPlayer(); if (player == null) { src.sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen.")); return; } if (!PermissionUtil.hasStatusPermission(src)) { src.sendFailure(Component.literal("Du hast keine Berechtigung.")); return; } if (checkBlockedOrMuted(src, player.getUUID().toString())) return; PlayerSettings settings = StatusMod.getStorage().forPlayer(player.getUUID().toString()); if (!checkCooldown(src, settings)) return; String key = com.teufel.statusmod.util.CompatUtil.getWorldKey(player); if (key != null) { if (settings.statusByWorld != null) settings.statusByWorld.remove(key); if (settings.colorByWorld != null) settings.colorByWorld.remove(key); StatusMod.getStorage().put(player.getUUID().toString(), settings); StatusTeamUtil.applyStatus(src.getServer().getScoreboard(), player, settings, StatusTextUtil.resolveStatusForPlayer(settings, player), StatusTextUtil.resolveColorForPlayer(settings, player), PermissionUtil.hasAdminPermission(player)); } AuditLogger.logClear(player.getScoreboardName(), player.getScoreboardName()); CommandUtil.sendSuccess(src, Component.literal("World-Status gelöscht."), false);} catch (Exception e){try{src.sendFailure(Component.literal("Fehler beim Löschen des World-Status."));}catch(Exception ignore){} e.printStackTrace();}}
    private static void showHistory(CommandSourceStack src) { try { ServerPlayer player = src.getPlayer(); if (player == null) { src.sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen.")); return; } if (!PermissionUtil.hasStatusPermission(src)) { src.sendFailure(Component.literal("Du hast keine Berechtigung.")); return; } if (checkBlockedOrMuted(src, player.getUUID().toString())) return; PlayerSettings settings = StatusMod.getStorage().forPlayer(player.getUUID().toString()); CommandUtil.sendSuccess(src, Component.literal("Status-Verlauf:"), false); if (settings.statusHistory == null || settings.statusHistory.isEmpty()) { CommandUtil.sendSuccess(src, Component.literal("- (leer)"), false); return; } for (String h : settings.statusHistory) { if (h == null || h.isBlank()) continue; net.minecraft.network.chat.MutableComponent text = Component.literal(h); text = makeClickable(text, "/status " + h, "Klicken zum Nachsetzen"); Component entry = Component.literal("- ").append(text); CommandUtil.sendSuccess(src, entry, false); } } catch (Exception e){try{src.sendFailure(Component.literal("Fehler beim Anzeigen des Verlaufs."));}catch(Exception ignore){} e.printStackTrace();}}

    private static net.minecraft.network.chat.MutableComponent makeClickable(net.minecraft.network.chat.MutableComponent text, String command, String hoverText) {
        try {
            text = text.withStyle(net.minecraft.network.chat.Style.EMPTY.withClickEvent(
                new net.minecraft.network.chat.ClickEvent.RunCommand(command)));
        } catch (Throwable ignored) {}
        try {
            text = text.withStyle(net.minecraft.network.chat.Style.EMPTY.withHoverEvent(
                new net.minecraft.network.chat.HoverEvent.ShowText(Component.literal(hoverText))));
        } catch (Throwable ignored) {}
        return text;
    }

    private static void saveCustomPreset(CommandSourceStack src, String name, String status, String colorKey) {
        try {
            if (!StatusMod.getConfig().isEnabled("presets")) { src.sendFailure(Component.literal("Das Preset-Feature ist auf diesem Server deaktiviert.")); return; }
            if (!PermissionUtil.hasStatusPermission(src)) { src.sendFailure(Component.literal("Du hast keine Berechtigung.")); return; }
            ServerPlayer player = src.getPlayer();
            if (player == null) { src.sendFailure(Component.literal("Nur Spieler können Presets speichern.")); return; }
            if (PRESETS.containsKey(name.toLowerCase(java.util.Locale.ROOT))) { src.sendFailure(Component.literal("Ein eingebautes Preset mit dem Namen '" + name + "' existiert bereits.")); return; }
            if (StatusMod.getServerPresets() != null && StatusMod.getServerPresets().get(name) != null) { src.sendFailure(Component.literal("Ein Server-Preset mit dem Namen '" + name + "' existiert bereits (bitte im Dashboard bearbeiten).")); return; }
            String resolvedColor = (colorKey != null && !colorKey.isEmpty()) ? colorKey : "reset";
            if (!ColorMapper.isValidColorInput(resolvedColor)) { src.sendFailure(Component.literal("Ungültige Farbe: " + resolvedColor)); return; }
            if (StatusMod.getCustomPresets().add(name, status, resolvedColor, player.getUUID().toString())) {
                CommandUtil.sendSuccess(src, Component.literal("Preset '" + name + "' gespeichert: " + status + " (" + resolvedColor + ")"), true);
            } else {
                src.sendFailure(Component.literal("Ein Preset mit dem Namen '" + name + "' existiert bereits."));
            }
        } catch (Exception e) { try { src.sendFailure(Component.literal("Fehler beim Speichern des Presets.")); } catch(Exception ignore){} e.printStackTrace(); }
    }

    private static void removeCustomPreset(CommandSourceStack src, String name) {
        try {
            ServerPlayer player = src.getPlayer();
            String uuid = player != null ? player.getUUID().toString() : null;
            boolean isAdmin = PermissionUtil.hasAdminPermission(src);
            String who = src.getTextName();
            if (isAdmin || uuid != null) {
                if (isAdmin ? StatusMod.getCustomPresets().adminRemove(name) : StatusMod.getCustomPresets().remove(name, uuid)) {
                    CommandUtil.sendSuccess(src, Component.literal("Preset '" + name + "' entfernt."), true);
                } else {
                    src.sendFailure(Component.literal("Konnte Preset '" + name + "' nicht entfernen (nicht gefunden oder keine Berechtigung)."));
                }
            } else {
                src.sendFailure(Component.literal("Keine Berechtigung."));
            }
        } catch (Exception e) { try { src.sendFailure(Component.literal("Fehler beim Entfernen des Presets.")); } catch(Exception ignore){} e.printStackTrace(); }
    }

    private static void listCustomPresets(CommandSourceStack src) {
        try {
            var presets = StatusMod.getCustomPresets().getAll();
            CommandUtil.sendSuccess(src, Component.literal("Verfügbare Presets:"), false);
            for (var e : PRESETS.entrySet()) {
                CommandUtil.sendSuccess(src, Component.literal("§e" + e.getKey() + "§r → " + e.getValue().status + " (" + e.getValue().color + ") §7[built-in]"), false);
            }
            if (presets.isEmpty()) {
                CommandUtil.sendSuccess(src, Component.literal("- (keine benutzerdefinierten Presets)"), false);
            } else {
                for (var e : presets.entrySet()) {
                    CommandUtil.sendSuccess(src, Component.literal("§a" + e.getKey() + "§r → " + e.getValue().status + " (" + e.getValue().color + ")"), false);
                }
            }
            var serverPresets = StatusMod.getServerPresets() == null ? java.util.Map.<String, com.teufel.statusmod.storage.ServerPresets.ServerPreset>of() : StatusMod.getServerPresets().getAll();
            if (!serverPresets.isEmpty()) {
                CommandUtil.sendSuccess(src, Component.literal("Server-Presets (Dashboard):"), false);
                java.util.List<String> names = new java.util.ArrayList<>(serverPresets.keySet());
                java.util.Collections.sort(names);
                for (String name : names) {
                    var p = serverPresets.get(name);
                    if (p == null) continue;
                    CommandUtil.sendSuccess(src, Component.literal("§b" + name + "§r → " + p.status + " (" + p.color + ") §7[server]"), false);
                }
            }
        } catch (Exception e) { try { src.sendFailure(Component.literal("Fehler beim Anzeigen der Presets.")); } catch(Exception ignore){} e.printStackTrace(); }
    }

    private static void mutePlayer(CommandSourceStack src, ServerPlayer target, int minutes) {
        try {
            if (!StatusMod.getConfig().isEnabled("mute")) { src.sendFailure(Component.literal("Das Mute-Feature ist auf diesem Server deaktiviert.")); return; }
            String uuid = target.getUUID().toString();
            StatusMod.getMutedPlayers().mute(uuid, minutes);
            SyncManager.requestPush();
            String who = src.getTextName();
            AuditLogger.logMute(who, target.getScoreboardName(), minutes);
            CommandUtil.sendSuccess(src, Component.literal(target.getScoreboardName() + " wurde für " + minutes + " Minuten gestummt."), true);
            target.sendSystemMessage(Component.literal("Du wurdest für " + minutes + " Minuten vom Status-Mod gestummt."));
        } catch (Exception e) { try { src.sendFailure(Component.literal("Fehler beim Muten.")); } catch(Exception ignore){} e.printStackTrace(); }
    }

    private static void unmutePlayer(CommandSourceStack src, ServerPlayer target) {
        try {
            if (!StatusMod.getConfig().isEnabled("mute")) { src.sendFailure(Component.literal("Das Mute-Feature ist auf diesem Server deaktiviert.")); return; }
            String uuid = target.getUUID().toString();
            StatusMod.getMutedPlayers().unmute(uuid);
            SyncManager.requestPush();
            String who = src.getTextName();
            AuditLogger.logUnmute(who, target.getScoreboardName());
            CommandUtil.sendSuccess(src, Component.literal(target.getScoreboardName() + " wurde entstummt."), true);
            target.sendSystemMessage(Component.literal("Du wurdest vom Status-Mod entstummt."));
        } catch (Exception e) { try { src.sendFailure(Component.literal("Fehler beim Entmuten.")); } catch(Exception ignore){} e.printStackTrace(); }
    }

    private static void showAuditLog(CommandSourceStack src) {
        try {
            java.nio.file.Path path = Paths.get("config/statusmod/audit.log");
            if (!Files.exists(path)) {
                CommandUtil.sendSuccess(src, Component.literal("Audit-Log ist leer."), false);
                return;
            }
            java.util.Deque<String> tail = new java.util.ArrayDeque<>();
            try (java.util.stream.Stream<String> s = Files.lines(path)) {
                s.forEach(line -> { tail.addLast(line); if (tail.size() > 25) tail.removeFirst(); });
            }
            CommandUtil.sendSuccess(src, Component.literal("--- Letzte Einträge (max 25) ---"), false);
            for (String line : tail) {
                CommandUtil.sendSuccess(src, Component.literal(line), false);
            }
        } catch (IOException e) {
            src.sendFailure(Component.literal("Fehler beim Lesen des Audit-Logs."));
        }
    }

    private static void setPlayerBadge(CommandSourceStack src, ServerPlayer target, String input) {
        try {
            if (!StatusMod.getConfig().isEnabled("badge")) { src.sendFailure(Component.literal("Das Badge-Feature ist auf diesem Server deaktiviert.")); return; }
            String[] tokens = input == null ? new String[0] : input.trim().split("\\s+");
            if (tokens.length == 0) {
                src.sendFailure(Component.literal("Verwendung: /status badge <Spieler> <Text> [Farbe] [brackets:off|square|angle]"));
                return;
            }
            String text = tokens[0];
            String color = null;
            int brackets = 1;
            boolean bracketsSet = false;

            for (String t : tokens) {
                String lower = t.toLowerCase(java.util.Locale.ROOT);
                if (lower.startsWith("brackets:")) {
                    String val = lower.substring(9);
                    brackets = switch (val) {
                        case "square", "on", "true" -> 1;
                        case "angle", "<>", "<" -> 2;
                        default -> 0;
                    };
                    bracketsSet = true;
                    break;
                }
                if (lower.equals("true") || lower.equals("false")) {
                    brackets = lower.equals("true") ? 1 : 0;
                    bracketsSet = true;
                    break;
                }
            }

            for (String t : tokens) {
                if (ColorMapper.isValidColorInput(t)) {
                    color = t;
                    break;
                }
            }

            if (color == null) color = "red";

            if (text.codePointCount(0, text.length()) > 32) {
                src.sendFailure(Component.literal("Badge-Text darf maximal 32 Zeichen lang sein."));
                return;
            }
            text = StatusTextUtil.sanitizePlayerText(text, 32);
            if (text.isEmpty()) {
                src.sendFailure(Component.literal("Badge-Text ist nach Bereinigung leer."));
                return;
            }

            ModConfig cfg = StatusMod.getConfig();
            if (cfg.staffBadges == null) cfg.staffBadges = new HashMap<>();
            ModConfig.StaffBadge existing = cfg.staffBadges.get(target.getUUID().toString());
            if (existing == null) existing = new ModConfig.StaffBadge();
            existing.text = text;
            existing.color = color;
            if (bracketsSet) existing.brackets = brackets;
            cfg.staffBadges.put(target.getUUID().toString(), existing);
            cfg.save();

            String rendered = StatusTextUtil.wrapBrackets(existing.text, existing.brackets);
            CommandUtil.sendSuccess(src, Component.literal("Staff-Badge für " + target.getScoreboardName() + " gesetzt: " + rendered + " (" + existing.color + ")"), true);
            target.sendSystemMessage(Component.literal("Dein Staff-Badge wurde geändert: " + rendered));

            refreshBadgeDisplay(src, target);
        } catch (Exception e) {
            try { src.sendFailure(Component.literal("Fehler beim Setzen des Staff-Badges.")); } catch(Exception ignore){} e.printStackTrace();
        }
    }

    private static void clearPlayerBadge(CommandSourceStack src, ServerPlayer target) {
        try {
            if (!StatusMod.getConfig().isEnabled("badge")) { src.sendFailure(Component.literal("Das Badge-Feature ist auf diesem Server deaktiviert.")); return; }
            ModConfig cfg = StatusMod.getConfig();
            if (cfg.staffBadges != null && cfg.staffBadges.remove(target.getUUID().toString()) != null) {
                cfg.save();
                CommandUtil.sendSuccess(src, Component.literal("Staff-Badge für " + target.getScoreboardName() + " entfernt. Globaler Fallback gilt wieder."), true);
                target.sendSystemMessage(Component.literal("Dein Staff-Badge wurde entfernt."));
            } else {
                CommandUtil.sendSuccess(src, Component.literal("Kein eigener Staff-Badge für " + target.getScoreboardName() + " gesetzt."), false);
            }
            refreshBadgeDisplay(src, target);
        } catch (Exception e) {
            try { src.sendFailure(Component.literal("Fehler beim Entfernen des Staff-Badges.")); } catch(Exception ignore){} e.printStackTrace();
        }
    }

    private static void showPlayerBadge(CommandSourceStack src, ServerPlayer target) {
        try {
            if (!StatusMod.getConfig().isEnabled("badge")) { src.sendFailure(Component.literal("Das Badge-Feature ist auf diesem Server deaktiviert.")); return; }
            ModConfig cfg = StatusMod.getConfig();
            ModConfig.StaffBadge b = cfg.staffBadges == null ? null : cfg.staffBadges.get(target.getUUID().toString());
            String who = target.getScoreboardName();
            if (b != null) {
                String rendered = StatusTextUtil.wrapBrackets(b.text, b.brackets);
                String styleName = switch (b.brackets) { case 1 -> "[]"; case 2 -> "<>"; default -> "off"; };
                CommandUtil.sendSuccess(src, Component.literal("Staff-Badge von " + who + ": " + rendered + " (" + b.color + ", brackets=" + styleName + ")"), false);
            } else {
                String fallback = (cfg.staffBadgeText == null || cfg.staffBadgeText.isEmpty()) ? "STAFF" : cfg.staffBadgeText;
                fallback = StatusTextUtil.wrapBrackets(fallback, cfg.staffBadgeBrackets);
                CommandUtil.sendSuccess(src, Component.literal("Staff-Badge von " + who + ": (global) " + fallback + " (" + cfg.staffBadgeColor + ")"), false);
            }
        } catch (Exception e) {
            try { src.sendFailure(Component.literal("Fehler beim Anzeigen des Staff-Badges.")); } catch(Exception ignore){} e.printStackTrace();
        }
    }

    private static void refreshBadgeDisplay(CommandSourceStack src, ServerPlayer target) {
        try {
            if (target == null || src.getServer() == null) return;
            PlayerSettings settings = StatusMod.getStorage().forPlayer(target.getUUID().toString());
            StatusTeamUtil.applyStatus(src.getServer().getScoreboard(), target, settings,
                StatusTextUtil.resolveStatusForPlayer(settings, target),
                StatusTextUtil.resolveColorForPlayer(settings, target),
                PermissionUtil.hasAdminPermission(target));
        } catch (Exception ignored) {}
    }

    private static boolean checkBlockedOrMuted(CommandSourceStack src, String uuid) {
        if (StatusMod.getBlockedPlayers().isBlocked(uuid)) {
            var entry = StatusMod.getBlockedPlayers().getEntry(uuid);
            if (entry != null && entry.until > 0L) {
                src.sendFailure(Component.literal("Du bist noch " + DurationUtil.formatRemaining(entry.until) + " ignoriert."));
            } else {
                src.sendFailure(Component.literal("Du wurdest vom Status-Mod blockiert."));
            }
            return true;
        }
        if (StatusMod.getMutedPlayers().isMuted(uuid)) {
            long until = StatusMod.getMutedPlayers().getMutedUntil(uuid);
            long remaining = Math.max(1, (until - System.currentTimeMillis()) / 1000L);
            src.sendFailure(Component.literal("Du bist noch " + remaining + "s vom Status-Mod gestummt."));
            return true;
        }
        return false;
    }

    static boolean checkCooldown(CommandSourceStack src, PlayerSettings settings) { try { int cooldown = StatusMod.getConfig() == null ? 0 : StatusMod.getConfig().statusCooldownSeconds; if (cooldown <= 0) return true; if (PermissionUtil.hasAdminPermission(src)) return true; long remaining = (settings.lastStatusChangeAtMs + (cooldown * 1000L)) - System.currentTimeMillis(); if (remaining > 0) { src.sendFailure(Component.literal("Bitte warte " + Math.max(1, remaining / 1000L) + "s bevor du den Status erneut änderst.")); return false; } } catch (Exception ignored) { return false; } return true; }
    private static void applyStatusUpdate(CommandSourceStack src, ServerPlayer player, PlayerSettings settings, StatusUpdate update, boolean perWorld, Long expiresAtMs, boolean keepFont) {
        if (player == null || settings == null || update == null) return;
        SyncManager.requestPush();
        settings.autoAfk = false;
        settings.preAfkStatus = "";
        settings.preAfkColor = "reset";
        settings.lastActivityAtMs = System.currentTimeMillis();
        if (!keepFont && update.font != null && !update.font.isEmpty()) settings.fontStyle = FontMapper.normalizeStyle(update.font);
        if (perWorld) {
            String key = com.teufel.statusmod.util.CompatUtil.getWorldKey(player);
            if (key != null) {
                if (settings.statusByWorld != null) settings.statusByWorld.put(key, update.status);
                if (settings.colorByWorld != null) settings.colorByWorld.put(key, update.color);
            }
        } else {
            long now = System.currentTimeMillis();
            boolean timed = expiresAtMs != null && expiresAtMs > now;
            if (timed) {
                // Stash the currently visible status only when no timed status is active,
                // so chaining timed statuses still restores the original one.
                if (settings.statusExpiresAtMs <= now) {
                    settings.timedPrevStatus = settings.status == null ? "" : settings.status;
                    settings.timedPrevColor = settings.color == null || settings.color.isEmpty() ? "reset" : settings.color;
                }
                settings.statusExpiresAtMs = expiresAtMs;
            } else {
                settings.statusExpiresAtMs = 0L;
                settings.timedPrevStatus = "";
                settings.timedPrevColor = "reset";
            }
            settings.status = update.status;
            settings.color = update.color;
        }
        settings.lastStatusChangeAtMs = System.currentTimeMillis();
        addHistory(settings, update.status);
        StatusMod.getStorage().put(player.getUUID().toString(), settings);
        var server = src.getServer();
        StatusTeamUtil.applyStatus(server.getScoreboard(), player, settings, StatusTextUtil.resolveStatusForPlayer(settings, player), StatusTextUtil.resolveColorForPlayer(settings, player), PermissionUtil.hasAdminPermission(player));
    }
    private static void addHistory(PlayerSettings settings, String status) { if (settings == null || status == null || status.isBlank()) return; if (settings.statusHistory == null) settings.statusHistory = new java.util.ArrayList<>(); settings.statusHistory.remove(status); settings.statusHistory.add(status); int max = StatusMod.getConfig() == null ? 5 : StatusMod.getConfig().statusHistorySize; while (settings.statusHistory.size() > max && max > 0) settings.statusHistory.remove(0); if (max <= 0) settings.statusHistory.clear(); }
    private static StatusUpdate parseStatusInput(String statusInput, String colorKey, PlayerSettings settings) {
        if (settings == null) return StatusUpdate.error("Fehler: Keine Einstellungen.");
        int n = settings.statusWords <= 0 ? 1 : settings.statusWords;
        String[] tokens = statusInput == null ? new String[0] : statusInput.trim().split("\\s+");
        if (tokens.length < n) return StatusUpdate.error("Bitte mindestens " + n + " Wörter für den Status angeben.");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(' ');
            sb.append(tokens[i]);
        }
        String status = StatusTextUtil.sanitizePlayerText(sb.toString(), MAX_STATUS_LENGTH);
        String resolvedColor = null;
        Long durationMs = null;
        boolean explicitColor = colorKey != null && !colorKey.isEmpty();
        if (explicitColor) {
            resolvedColor = colorKey.trim();
        }
        for (int i = n; i < tokens.length; i++) {
            String token = tokens[i];
            long parsed = DurationUtil.parseMillis(token);
            if (parsed > 0L) {
                if (durationMs != null) return StatusUpdate.error("Bitte nur eine Dauer angeben.");
                durationMs = parsed;
                continue;
            }
            if (explicitColor) continue;
            if (resolvedColor == null && ColorMapper.isValidColorInput(token)) {
                resolvedColor = token;
                continue;
            }
            return StatusUpdate.error("Ungültige Farbe oder Dauer: " + token);
        }
        if (resolvedColor == null) {
            resolvedColor = StatusMod.getConfig() != null && StatusMod.getConfig().defaultColor != null
                && !StatusMod.getConfig().defaultColor.isEmpty() ? StatusMod.getConfig().defaultColor : "reset";
        }
        if (!ColorMapper.isValidColorInput(resolvedColor)) return StatusUpdate.error("Ungültige Farbe: " + resolvedColor);
        StatusUpdate update = new StatusUpdate(status, resolvedColor, settings.fontStyle, true, null);
        update.durationMs = durationMs;
        return update;
    }
    private static String pickStableRandomColor(String uuid) { List<TextColor> palette = ColorMapper.rainbowPalette(); if (palette.isEmpty()) return "reset";         return ColorMapper.toHex(palette.get((uuid.hashCode() & Integer.MAX_VALUE) % palette.size())); }
    private static class Preset { final String status; final String color; final String font; Preset(String status, String color, String font) { this.status = status; this.color = color; this.font = font; } }
    private static class StatusUpdate { String status; String color; String font; boolean ok; String error; Long durationMs; StatusUpdate(String status, String color, String font, boolean ok, String error) { this.status = status; this.color = color; this.font = font; this.ok = ok; this.error = error; } static StatusUpdate error(String msg) { return new StatusUpdate("", "reset", "normal", false, msg); } }
}
