package com.teufel.statusmod.api;

import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.storage.PlayerSettings;
import com.teufel.statusmod.util.StatusTeamUtil;
import com.teufel.statusmod.util.StatusTextUtil;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

import java.util.UUID;

public final class StatusModAPI {
    private StatusModAPI() {}

    public static String getStatus(UUID uuid) {
        if (uuid == null || StatusMod.storage == null) return "";
        PlayerSettings settings = StatusMod.storage.forPlayer(uuid.toString());
        return settings != null ? settings.status : "";
    }

    public static String getStatusColor(UUID uuid) {
        if (uuid == null || StatusMod.storage == null) return "reset";
        PlayerSettings settings = StatusMod.storage.forPlayer(uuid.toString());
        return settings != null ? settings.color : "reset";
    }

    public static boolean isAfk(UUID uuid) {
        if (uuid == null || StatusMod.storage == null) return false;
        PlayerSettings settings = StatusMod.storage.forPlayer(uuid.toString());
        return settings != null && settings.autoAfk;
    }

    public static void setStatus(UUID uuid, String status, String color) {
        if (uuid == null || StatusMod.storage == null || status == null) return;
        if (StatusMod.isRemoteDisabled()) return;
        String key = uuid.toString();
        // External callers bypass commands: enforce the same guards
        // (mute/block/sanitize) so the API cannot be used to circumvent them.
        try {
            if (StatusMod.getBlockedPlayers() != null && StatusMod.getBlockedPlayers().isBlocked(key)) return;
            if (StatusMod.getMutedPlayers() != null && StatusMod.getMutedPlayers().isMuted(key)) return;
        } catch (Exception ignored) {}
        PlayerSettings settings = StatusMod.storage.forPlayer(key);
        settings.status = com.teufel.statusmod.util.StatusTextUtil.sanitizePlayerText(status, 64);
        String c = (color != null && !color.isEmpty()) ? color.trim() : "reset";
        try {
            if (!com.teufel.statusmod.util.ColorMapper.isValidColorInput(c) || c.length() > 32) c = "reset";
        } catch (Exception ignored) {
            c = "reset";
        }
        settings.color = c;
        settings.lastStatusChangeAtMs = System.currentTimeMillis();
        StatusMod.storage.put(key, settings);
    }

    public static void clearStatus(UUID uuid) {
        if (uuid == null || StatusMod.storage == null) return;
        if (StatusMod.isRemoteDisabled()) return;
        String key = uuid.toString();
        PlayerSettings settings = StatusMod.storage.forPlayer(key);
        settings.status = "";
        settings.color = "reset";
        settings.statusExpiresAtMs = 0L;
        StatusMod.storage.put(key, settings);
    }

    public static void refreshDisplay(MinecraftServer server, UUID uuid) {
        if (server == null || uuid == null || StatusMod.storage == null) return;
        if (StatusMod.isRemoteDisabled()) return;
        ServerPlayer player = server.getPlayerList().getPlayer(uuid);
        if (player == null) return;
        String key = uuid.toString();
        PlayerSettings settings = StatusMod.storage.forPlayer(key);
        String status = StatusTextUtil.resolveStatusForPlayer(settings, player);
        String color = StatusTextUtil.resolveColorForPlayer(settings, player);
        StatusTeamUtil.applyStatus(server.getScoreboard(), player, settings, status, color, false);
    }
}
