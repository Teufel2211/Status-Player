package com.teufel.statusmod.util;

import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.storage.ModConfig;
import com.teufel.statusmod.storage.PlayerSettings;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.ServerScoreboard;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.scores.PlayerTeam;

public final class StatusTeamUtil {
    private StatusTeamUtil() {}

    private static Component wrapWithWhiteBrackets(String text, int bracketStyle, String colorKey) {
        Component colored = StatusColorUtil.applyColor(text, colorKey);
        if (bracketStyle == 0) return colored;
        String prefix = bracketStyle == 1 ? "[" : "<";
        String suffix = bracketStyle == 1 ? "]" : ">";
        MutableComponent result = Component.literal(prefix).withStyle(ChatFormatting.WHITE);
        result.append(colored);
        result.append(Component.literal(suffix).withStyle(ChatFormatting.WHITE));
        return result;
    }

    /**
     * Builds the status (+badge) suffix exactly as shown in the Java tab list.
     * Shared by team rendering and the bossbar ticker so both look identical.
     */
    public static Component buildDisplaySuffix(PlayerSettings settings, String status,
            String colorKey, String uuid, boolean isAdmin, ModConfig cfg) {
        // Kill-Switch: keinerlei Suffix/Badge rendern, solange der Server
        // im Admin-Dashboard deaktiviert ist.
        if (StatusMod.isRemoteDisabled()) return Component.empty();
        boolean statusEnabled = cfg == null || cfg.isEnabled("status");
        Component colored;
        if (statusEnabled) {
            String inner = status == null ? "" : status;
            int bracketStyle = settings != null ? settings.brackets : 0;
            colored = wrapWithWhiteBrackets(inner, bracketStyle, colorKey);
        } else {
            colored = Component.empty();
        }
        Component finalComponent = colored;
        if (cfg != null && cfg.isEnabled("warn") && StatusMod.warningStore != null) {
            int level = StatusMod.warningStore.getLevel(uuid);
            if (level > 0) {
                ChatFormatting warnColor = level >= 3 ? ChatFormatting.RED
                    : (level == 2 ? ChatFormatting.GOLD : ChatFormatting.YELLOW);
                Component badge = Component.literal("[!" + Math.min(3, level) + "]").withStyle(warnColor);
                if (finalComponent.getString().isEmpty()) {
                    finalComponent = badge;
                } else {
                    finalComponent = finalComponent.copy().append(Component.literal(" ")).append(badge);
                }
            }
        }
        if (cfg != null && cfg.enableStaffBadge && cfg.isEnabled("badge")) {
            ModConfig.StaffBadge override = cfg.staffBadges == null ? null : cfg.staffBadges.get(uuid);
            if (override != null) {
                String badgeText = (override.text == null || override.text.isEmpty()) ? "STAFF" : override.text;
                String badgeColor = (override.color == null || override.color.isEmpty()) ? "red" : override.color;
                Component badge = wrapWithWhiteBrackets(badgeText, override.brackets, badgeColor);
                finalComponent = finalComponent.copy().append(Component.literal(" ")).append(badge);
            } else if (isAdmin) {
                String badgeText = cfg.staffBadgeText == null ? "STAFF" : cfg.staffBadgeText;
                String badgeColor = cfg.staffBadgeColor == null ? "red" : cfg.staffBadgeColor;
                Component badge = wrapWithWhiteBrackets(badgeText, cfg.staffBadgeBrackets, badgeColor);
                finalComponent = finalComponent.copy().append(Component.literal(" ")).append(badge);
            }
        }
        return finalComponent;
    }

    public static void applyStatus(ServerScoreboard scoreboard, ServerPlayer player, PlayerSettings settings, String status, String colorKey, boolean isAdmin) {
        if (scoreboard == null || player == null || settings == null) return;
        if (StatusMod.isRemoteDisabled()) return;
        ModConfig cfg = StatusMod.getConfig();
        boolean any = cfg == null || cfg.isEnabled("status") || cfg.isEnabled("badge") || cfg.isEnabled("warn");
        if (!any) return;
        String uuid = player.getUUID().toString();
        String teamName = "status_" + uuid.substring(0, 8);
        PlayerTeam team = scoreboard.getPlayerTeam(teamName);
        if (team == null) team = scoreboard.addPlayerTeam(teamName);
        Component finalComponent = buildDisplaySuffix(settings, status, colorKey, uuid, isAdmin, cfg);
        if (settings.beforeName) {
            team.setPlayerPrefix(finalComponent.copy().append(Component.literal(" ")));
            team.setPlayerSuffix(Component.empty());
        } else {
            team.setPlayerPrefix(Component.empty());
            team.setPlayerSuffix(Component.literal(" ").append(finalComponent));
        }
        String playerName = player.getScoreboardName();
        PlayerTeam existing = scoreboard.getPlayersTeam(playerName);
        if (existing != null && existing != team) {
            scoreboard.removePlayerFromTeam(playerName, existing);
        }
        if (existing != team) {
            scoreboard.addPlayerToTeam(playerName, team);
        }
    }

    /**
     * Entfernt das von StatusMod angelegte Team eines Spielers samt Prefix/
     * Suffix. Wird beim Aktivieren des Kill-Switches aufgerufen, damit keine
     * veralteten Status-Anzeigen stehen bleiben.
     */
    public static void clearStatus(ServerScoreboard scoreboard, ServerPlayer player) {
        if (scoreboard == null || player == null) return;
        String teamName = "status_" + player.getUUID().toString().substring(0, 8);
        try {
            PlayerTeam team = scoreboard.getPlayerTeam(teamName);
            if (team == null) return;
            String playerName = player.getScoreboardName();
            PlayerTeam current = scoreboard.getPlayersTeam(playerName);
            if (current == team) {
                scoreboard.removePlayerFromTeam(playerName, team);
            }
            scoreboard.removePlayerTeam(team);
        } catch (Throwable ignored) {
            // Scoreboard-API unterscheidet sich minimal zwischen MC-Versionen;
            // das Entfernen ist best-effort, der Reapply-Tick raeumt sonst nach.
        }
    }
}
