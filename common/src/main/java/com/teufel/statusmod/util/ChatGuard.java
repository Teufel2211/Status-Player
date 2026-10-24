package com.teufel.statusmod.util;

import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.storage.ModConfig;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Server-side chat slowmode guard used by the Fabric/Forge/NeoForge chat hooks.
 * Only normal chat is throttled; commands are never affected.
 */
public final class ChatGuard {
    private static final Map<String, Long> lastChatAtMs = new ConcurrentHashMap<>();

    private ChatGuard() {}

    /** @return true if the message may be broadcast, false if it was throttled. */
    public static boolean allowChat(ServerPlayer player, String message) {
        if (player == null) return true;
        if (StatusMod.isRemoteDisabled()) return true;
        try {
            ModConfig cfg = StatusMod.getConfig();
            if (cfg == null || !cfg.isEnabled("slowmode")) return true;
            if (StatusMod.slowmodeStore == null) return true;
            String uuid = player.getUUID().toString();
            int seconds = StatusMod.slowmodeStore.getSeconds(uuid);
            if (seconds <= 0) {
                lastChatAtMs.remove(uuid);
                return true;
            }
            long now = System.currentTimeMillis();
            Long last = lastChatAtMs.get(uuid);
            if (last != null) {
                long remaining = (seconds * 1000L) - (now - last);
                if (remaining > 0L) {
                    player.sendSystemMessage(Component.literal(
                        "\u00A7cSlowmode: Bitte warte noch " + DurationUtil.formatDuration(remaining) + "."));
                    return false;
                }
            }
            lastChatAtMs.put(uuid, now);
            return true;
        } catch (Exception ignored) {
            return true;
        }
    }

    public static void clear(String uuid) {
        if (uuid != null) lastChatAtMs.remove(uuid);
    }
}
