package com.teufel.statusmod.display;

import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.storage.PlayerSettings;
import com.teufel.statusmod.util.BedrockUtil;
import com.teufel.statusmod.util.StatusTextUtil;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerBossEvent;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.BossEvent;

import java.util.ArrayList;
import java.util.List;

/**
 * Optional status ticker as boss bar (config: bossbarListEnabled, default OFF).
 * Reason: the Bedrock pause-menu player list cannot show team prefix/suffix
 * (Bedrock protocol has no per-entry formatting, Geyser only forwards raw
 * usernames - verified in Geyser source). The boss bar IS translated by Geyser,
 * so this is the only persistent on-screen channel that reaches Bedrock.
 * Synced from the server tick (max ~5s stale), hidden when disabled.
 */
public final class StatusBossBar {
    private static final int MAX_TEXT_LENGTH = 160;
    private static ServerBossEvent bar;
    private static String activeColor = "";
    private static String activeOverlay = "";
    private static boolean unavailableLogged = false;

    private StatusBossBar() {}

    private static synchronized ServerBossEvent bar() {
        com.teufel.statusmod.storage.ModConfig cfg = StatusMod.getConfig();
        String wantColor = cfg == null || cfg.bossbarColor == null ? "WHITE" : cfg.bossbarColor.trim().toUpperCase();
        String wantOverlay = cfg == null || cfg.bossbarOverlay == null ? "PROGRESS" : cfg.bossbarOverlay.trim().toUpperCase();
        if (bar != null && (!wantColor.equals(activeColor) || !wantOverlay.equals(activeOverlay))) {
            try {
                bar.removeAllPlayers();
            } catch (Throwable ignored) {}
            bar = null;
        }
        if (bar == null) {
            bar = createBar(wantColor, wantOverlay);
            if (bar == null) {
                if (!unavailableLogged) {
                    unavailableLogged = true;
                    System.err.println("[StatusMod] BossBar unavailable on this version.");
                }
                return null;
            }
            activeColor = wantColor;
            activeOverlay = wantOverlay;
            try {
                bar.setProgress(1.0F);
            } catch (Throwable ignored) {}
        }
        return bar;
    }

    /**
     * 26.x constructors take a UUID first, older ones don't - tried in order.
     * Unknown color/overlay names fall back to WHITE/PROGRESS.
     */
    private static ServerBossEvent createBar(String colorName, String overlayName) {
        BossEvent.BossBarColor color;
        try {
            color = BossEvent.BossBarColor.valueOf(colorName);
        } catch (Throwable ignored) {
            color = BossEvent.BossBarColor.WHITE;
        }
        BossEvent.BossBarOverlay overlay;
        try {
            overlay = BossEvent.BossBarOverlay.valueOf(overlayName);
        } catch (Throwable ignored) {
            overlay = BossEvent.BossBarOverlay.PROGRESS;
        }
        try {
            java.lang.reflect.Constructor<ServerBossEvent> c4 = ServerBossEvent.class.getConstructor(
                java.util.UUID.class, Component.class,
                BossEvent.BossBarColor.class, BossEvent.BossBarOverlay.class);
            return c4.newInstance(java.util.UUID.randomUUID(), Component.literal("Status"), color, overlay);
        } catch (Throwable ignored) {}
        try {
            java.lang.reflect.Constructor<ServerBossEvent> c3 = ServerBossEvent.class.getConstructor(
                Component.class, BossEvent.BossBarColor.class, BossEvent.BossBarOverlay.class);
            return c3.newInstance(Component.literal("Status"), color, overlay);
        } catch (Throwable ignored) {}
        return null;
    }

    public static void sync(MinecraftServer server) {
        if (server == null || StatusMod.storage == null) return;
        boolean enabled = StatusMod.getConfig() != null && StatusMod.getConfig().bossbarListEnabled;
        String mode = StatusMod.getConfig() == null || StatusMod.getConfig().bossbarMode == null
            ? "BAR" : StatusMod.getConfig().bossbarMode.trim().toUpperCase();
        if (!enabled) {
            hideBar();
            return;
        }
        try {
            List<ServerPlayer> online = new ArrayList<>(server.getPlayerList().getPlayers());
            online.sort((a, b2) -> a.getScoreboardName().compareToIgnoreCase(b2.getScoreboardName()));
            if ("ACTIONBAR".equals(mode)) {
                hideBar();
                sendActionbar(online);
                return;
            }
            ServerBossEvent b = bar();
            if (b == null) return;
            sendBar(b, online);
        } catch (Throwable e) {
            System.err.println("[StatusMod] BossBar sync failed: " + e.getMessage());
        }
    }

    private static void hideBar() {
        if (bar == null) return;
        try {
            bar.removeAllPlayers();
        } catch (Throwable ignored) {}
    }

    /** Blendet die Status-Bossbar aus (Kill-Switch). */
    public static void hide() {
        hideBar();
    }

    /** Actionbar ticker: text only, no bar. Refreshed every ~2.5s (before fade). */
    private static void sendActionbar(List<ServerPlayer> online) {
        Component text;
        try {
            text = buildText(online);
        } catch (Throwable e) {
            return;
        }
        for (ServerPlayer p : online) {
            boolean bedrock = false;
            try {
                bedrock = BedrockUtil.isBedrockPlayer(p.getUUID());
            } catch (Throwable ignored) {}
            if (!bedrock) continue;
            try {
                p.connection.send(new net.minecraft.network.protocol.game.ClientboundSetActionBarTextPacket(text));
            } catch (Throwable ignored) {}
        }
    }

    private static void sendBar(ServerBossEvent b, List<ServerPlayer> online) {
        try {
            java.util.Set<String> seen = new java.util.HashSet<>();
            for (ServerPlayer p : online) {
                seen.add(p.getUUID().toString());
                boolean bedrock = false;
                try {
                    bedrock = BedrockUtil.isBedrockPlayer(p.getUUID());
                } catch (Throwable ignored) {}
                try {
                    // Bedrock-only: Java sieht die Liste im Tab, Bedrock nur hier.
                    if (bedrock) {
                        b.addPlayer(p);
                    } else {
                        b.removePlayer(p);
                    }
                } catch (Throwable ignored) {}
            }
            for (ServerPlayer p : new ArrayList<>(b.getPlayers())) {
                if (!seen.contains(p.getUUID().toString())) {
                    try {
                        b.removePlayer(p);
                    } catch (Throwable ignored) {}
                }
            }
            b.setName(buildText(online));
        } catch (Throwable e) {
            System.err.println("[StatusMod] BossBar sync failed: " + e.getMessage());
        }
    }

    public static void onDisconnect(ServerPlayer player) {
        if (player == null || bar == null) return;
        try {
            bar.removePlayer(player);
        } catch (Throwable ignored) {}
    }

    private static Component buildText(List<ServerPlayer> online) {
        com.teufel.statusmod.storage.ModConfig cfg = StatusMod.getConfig();
        MutableComponent out;
        if (cfg != null && cfg.bossbarShowHeader) {
            out = Component.literal("Online (" + online.size() + "): ").withStyle(ChatFormatting.GRAY);
        } else {
            out = Component.literal("");
        }
        boolean first = true;
        int shown = 0;
        for (ServerPlayer p : online) {
            String name = p.getScoreboardName();
            String uuid = p.getUUID().toString();
            MutableComponent entry;
            try {
                PlayerSettings s = StatusMod.storage.forPlayer(uuid);
                String st = StatusTextUtil.resolveStatusForPlayer(s, p);
                String ck = StatusTextUtil.resolveColorForPlayer(s, p);
                boolean admin = com.teufel.statusmod.util.PermissionUtil.hasAdminPermission(p);
                Component suffix = com.teufel.statusmod.util.StatusTeamUtil.buildDisplaySuffix(s, st, ck, uuid, admin, cfg);
                entry = Component.literal(name).withStyle(ChatFormatting.WHITE);
                if (suffix != null && !suffix.getString().isEmpty()) {
                    if (s != null && s.beforeName) {
                        entry = (MutableComponent) suffix.copy().append(Component.literal(" ")).append(entry);
                    } else {
                        entry.append(Component.literal(" ")).append(suffix);
                    }
                }
            } catch (Throwable ignored) {
                entry = Component.literal(name).withStyle(ChatFormatting.WHITE);
            }
            String piece = (first ? "" : " \u2022 ") + entry.getString();
            String plain = out.getString() + piece;
            if (plain.length() > MAX_TEXT_LENGTH) {
                out.append(Component.literal(" \u2026 (+" + (online.size() - shown) + ")").withStyle(ChatFormatting.GRAY));
                break;
            }
            if (!first) {
                out.append(Component.literal(" \u2022 ").withStyle(ChatFormatting.DARK_GRAY));
            }
            first = false;
            out.append(entry);
            shown++;
        }
        return out;
    }
}
