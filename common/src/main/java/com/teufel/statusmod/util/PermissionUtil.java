package com.teufel.statusmod.util;

import com.teufel.statusmod.StatusMod;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.permissions.LevelBasedPermissionSet;
import net.minecraft.server.permissions.PermissionLevel;
import net.minecraft.server.permissions.PermissionSet;
import net.minecraft.server.permissions.Permissions;
import net.minecraft.server.players.NameAndId;
import net.minecraft.server.players.ServerOpListEntry;

/**
 * Permission checks without string-based reflection (works on intermediary
 * runtimes like Fabric/Quilt 1.21.11, where Mojang/Yarn member names do not
 * exist) and without username-based ops.json parsing (spoofable, redundant
 * with vanilla's UUID-based op list).
 */
public class PermissionUtil {
    private static volatile boolean luckypermsAvailable = false;
    private static volatile Object luckypermsApi = null;

    static {
        try {
            Class.forName("net.luckperms.api.LuckPermsProvider");
            luckypermsAvailable = true;
            try {
                Class<?> providerClass = Class.forName("net.luckperms.api.LuckPermsProvider");
                java.lang.reflect.Method getMethod = providerClass.getMethod("get");
                luckypermsApi = getMethod.invoke(null);
            } catch (Exception e) {
                luckypermsAvailable = false;
            }
        } catch (ClassNotFoundException e) {
            System.out.println("[StatusMod] LuckyPerms not detected - using operator fallback");
        }
    }

    // Laedt LP nach, falls es erst nach StatusMod startet (sonst faellt
    // die Erkennung dauerhaft auf OP-Fallback zurück). Retry max. 1x/Min,
    // da hasAdminPermission auch pro Tick laeuft (teure Miss-Exceptions).
    private static volatile long lastLpRetryMs = 0L;
    private static void ensureLuckyPerms() {
        if (luckypermsAvailable && luckypermsApi != null) return;
        long now = System.currentTimeMillis();
        if (now - lastLpRetryMs < 60_000L) return;
        lastLpRetryMs = now;
        try {
            Class<?> providerClass = Class.forName("net.luckperms.api.LuckPermsProvider");
            java.lang.reflect.Method getMethod = providerClass.getMethod("get");
            Object api = getMethod.invoke(null);
            if (api != null) {
                luckypermsApi = api;
                luckypermsAvailable = true;
                System.out.println("[StatusMod] LuckyPerms detected (late) - using LP permissions");
            }
        } catch (Exception ignored) {}
    }

    public static boolean hasStatusPermission(CommandSourceStack src) {
        ServerPlayer player = null;
        try { player = src.getPlayer(); } catch (Exception ignored) {}
        ensureLuckyPerms();
        if (player != null && luckypermsAvailable && luckypermsApi != null) {
            return checkLuckyPermsPermission(player, StatusMod.getConfig().statusPermissionNode);
        }
        return true;
    }

    public static boolean hasAdminPermission(CommandSourceStack src) {
        ServerPlayer player = null;
        try { player = src.getPlayer(); } catch (Exception ignored) {}
        ensureLuckyPerms();
        if (player != null && luckypermsAvailable && luckypermsApi != null) {
            try {
                if (checkLuckyPermsPermission(player, StatusMod.getConfig().adminPermissionNode)) return true;
            } catch (Exception ignored) {}
        }
        return hasOpLevel(src, player, requiredOpLevel());
    }

    public static boolean hasAdminPermission(ServerPlayer player) {
        if (player == null) return false;
        try {
            ensureLuckyPerms();
            if (luckypermsAvailable && luckypermsApi != null) {
                if (checkLuckyPermsPermission(player, StatusMod.getConfig().adminPermissionNode)) return true;
            }
        } catch (Exception ignored) {}
        int requiredLevel = Math.max(1, StatusMod.getConfig() != null ? StatusMod.getConfig().adminOpLevel : 4);
        MinecraftServer server = serverOf(player);
        if (server != null && opLevelOf(server, player) >= requiredLevel) return true;
        return tierLevelOf(playerPermissions(player)) >= requiredLevel;
    }

    private static int requiredOpLevel() {
        try {
            if (StatusMod.getConfig() != null) return Math.max(1, StatusMod.getConfig().adminOpLevel);
        } catch (Exception ignored) {}
        return 4;
    }

    private static boolean hasOpLevel(CommandSourceStack src, ServerPlayer player, int requiredLevel) {
        if (requiredLevel <= 0) return true;
        try {
            if (src != null && src.getEntity() == null) {
                String name = src.getTextName();
                if ("Server".equals(name) || "Rcon".equals(name)) return true;
            }
        } catch (Exception ignored) {}
        if (player != null) {
            MinecraftServer server = null;
            try { server = src.getServer(); } catch (Exception ignored) {}
            if (server == null) server = serverOf(player);
            if (server != null && opLevelOf(server, player) >= requiredLevel) return true;
            if (tierLevelOf(playerPermissions(player)) >= requiredLevel) return true;
        } else if (src != null) {
            // Non-player sources (command blocks, functions): judge by their
            // own permission set instead of failing open.
            if (tierLevelOf(sourcePermissions(src)) >= requiredLevel) return true;
        }
        return false;
    }

    /**
     * Canonical OP level from vanilla's op list (UUID-based, spoof-proof).
     * Returns -1 when not listed.
     */
    private static int opLevelOf(MinecraftServer server, ServerPlayer player) {
        try {
            if (server == null || player == null) return -1;
            com.mojang.authlib.GameProfile profile = player.getGameProfile();
            if (profile == null) return -1;
            ServerOpListEntry entry = server.getPlayerList().getOps().get(new NameAndId(profile));
            if (entry == null) return -1;
            try {
                LevelBasedPermissionSet perms = entry.permissions();
                if (perms != null) {
                    PermissionLevel lvl = perms.level();
                    if (lvl != null) return lvl.id();
                }
            } catch (Throwable ignored) {}
            return 4;
        } catch (Throwable ignored) {
            return -1;
        }
    }

    /**
     * Level represented by a permission set: exact for level-based sets,
     * tier-mapped otherwise (OWNER=4, ADMIN=3, GAMEMASTER=2, MODERATOR=1).
     * Returns -1 for empty/unknown sets (fail closed).
     */
    private static int tierLevelOf(PermissionSet ps) {
        if (ps == null) return -1;
        try {
            if (ps instanceof LevelBasedPermissionSet lbs) {
                try {
                    PermissionLevel lvl = lbs.level();
                    if (lvl != null) return lvl.id();
                } catch (Throwable ignored) {}
            }
            if (ps.hasPermission(Permissions.COMMANDS_OWNER)) return 4;
            if (ps.hasPermission(Permissions.COMMANDS_ADMIN)) return 3;
            if (ps.hasPermission(Permissions.COMMANDS_GAMEMASTER)) return 2;
            if (ps.hasPermission(Permissions.COMMANDS_MODERATOR)) return 1;
        } catch (Throwable ignored) {}
        return -1;
    }

    private static PermissionSet playerPermissions(ServerPlayer player) {
        try {
            if (player != null) return player.permissions();
        } catch (Throwable ignored) {}
        return null;
    }

    private static PermissionSet sourcePermissions(CommandSourceStack src) {
        try {
            if (src != null) return src.permissions();
        } catch (Throwable ignored) {}
        return null;
    }

    private static MinecraftServer serverOf(ServerPlayer player) {
        try {
            if (player != null) return player.level().getServer();
        } catch (Throwable ignored) {}
        return null;
    }

    private static boolean checkLuckyPermsPermission(ServerPlayer player, String permission) {
        try {
            if (luckypermsApi == null) return false;
            Class<?> apiClass = luckypermsApi.getClass();
            java.lang.reflect.Method getPlayerAdapterMethod = apiClass.getMethod("getPlayerAdapter", Class.class);
            Object playerAdapter = getPlayerAdapterMethod.invoke(luckypermsApi, ServerPlayer.class);
            java.lang.reflect.Method getUserMethod = playerAdapter.getClass().getMethod("getUser", ServerPlayer.class);
            Object user = getUserMethod.invoke(playerAdapter, player);
            if (user == null) return false;
            java.lang.reflect.Method getCachedDataMethod = user.getClass().getMethod("getCachedData");
            Object cachedData = getCachedDataMethod.invoke(user);
            java.lang.reflect.Method getPermissionDataMethod = cachedData.getClass().getMethod("getPermissionData");
            Object permissionData = getPermissionDataMethod.invoke(cachedData);
            java.lang.reflect.Method checkPermissionMethod = permissionData.getClass().getMethod("checkPermission", String.class);
            Object result = checkPermissionMethod.invoke(permissionData, permission);
            java.lang.reflect.Method asBooleanMethod = result.getClass().getMethod("asBoolean");
            return (boolean) asBooleanMethod.invoke(result);
        } catch (Exception e) {
            System.err.println("[StatusMod] LuckyPerms permission check failed: " + e.getMessage());
            return false;
        }
    }
}
