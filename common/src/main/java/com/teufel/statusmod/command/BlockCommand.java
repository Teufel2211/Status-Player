package com.teufel.statusmod.command;

import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.lifecycle.StatusLifecycle;
import com.teufel.statusmod.storage.AuditLogger;
import com.teufel.statusmod.storage.BlockedPlayers;
import com.teufel.statusmod.storage.PlayerSettings;
import com.teufel.statusmod.sync.SyncManager;
import com.teufel.statusmod.util.CommandUtil;
import com.teufel.statusmod.util.DurationUtil;
import com.teufel.statusmod.util.PermissionUtil;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.EntityArgument;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

public class BlockCommand {
    private static final String[] DURATION_SUGGESTIONS = {"30m", "1h", "2h", "6h", "1d", "7d"};

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        registerPair(dispatcher, "block", "unblock");
        registerPair(dispatcher, "ignore", "unignore");
    }

    private static void registerPair(CommandDispatcher<CommandSourceStack> dispatcher, String blockLiteral, String unblockLiteral) {
        var block = Commands.literal(blockLiteral)
            .requires(ctx -> !StatusMod.isRemoteDisabled())
            .then(Commands.argument("player", EntityArgument.player())
                .executes(ctx -> {
                    ServerPlayer target = EntityArgument.getPlayer(ctx, "player");
                    blockPlayer(ctx.getSource(), target.getUUID().toString(), target.getScoreboardName(), null);
                    return 1;
                })
                .then(Commands.argument("duration", StringArgumentType.word())
                    .suggests((ctx, builder) -> {
                        for (String s : DURATION_SUGGESTIONS) builder.suggest(s);
                        return builder.buildFuture();
                    })
                    .executes(ctx -> {
                        ServerPlayer target = EntityArgument.getPlayer(ctx, "player");
                        blockPlayer(ctx.getSource(), target.getUUID().toString(), target.getScoreboardName(),
                            StringArgumentType.getString(ctx, "duration"));
                        return 1;
                    })));
        dispatcher.register(block);

        dispatcher.register(Commands.literal(unblockLiteral)
            .requires(ctx -> !StatusMod.isRemoteDisabled())
            .then(Commands.argument("player", EntityArgument.player())
                .executes(ctx -> {
                    ServerPlayer target = EntityArgument.getPlayer(ctx, "player");
                    unblockPlayer(ctx.getSource(), target.getUUID().toString(), target.getScoreboardName());
                    return 1;
                })));
    }

    private static void blockPlayer(CommandSourceStack src, String uuid, String playerName, String durationInput) {
        try {
            if (!StatusMod.getConfig().isEnabled("block")) {
                src.sendFailure(Component.literal("Das Block-Feature ist auf diesem Server deaktiviert."));
                return;
            }
            if (!PermissionUtil.hasAdminPermission(src)) {
                src.sendFailure(Component.literal("Du hast keine Berechtigung für diesen Befehl."));
                return;
            }
            ServerPlayer targetPlayer = src.getServer().getPlayerList().getPlayerByName(playerName);
            if (targetPlayer == null) {
                src.sendFailure(Component.literal("Spieler '" + playerName + "' nicht gefunden."));
                return;
            }
            long durationMs = -1L;
            if (durationInput != null && !durationInput.isBlank()) {
                durationMs = DurationUtil.parseMillis(durationInput);
                if (durationMs <= 0L) {
                    src.sendFailure(Component.literal("Ungültige Dauer. Beispiele: 30m, 2h, 1d."));
                    return;
                }
            }
            if (StatusMod.getBlockedPlayers().isBlocked(uuid) && durationMs <= 0L) {
                src.sendFailure(Component.literal(playerName + " ist bereits blockiert."));
                return;
            }
            PlayerSettings settings = StatusMod.getStorage().forPlayer(uuid);
            String prevStatus = settings.status == null ? "" : settings.status;
            String prevColor = settings.color == null || settings.color.isEmpty() ? "reset" : settings.color;
            long prevExpiresAtMs = settings.statusExpiresAtMs;
            String prevTimedStatus = settings.timedPrevStatus == null ? "" : settings.timedPrevStatus;
            String prevTimedColor = settings.timedPrevColor == null || settings.timedPrevColor.isEmpty() ? "reset" : settings.timedPrevColor;
            boolean permanent = durationMs <= 0L;
            if (permanent) {
                StatusMod.getBlockedPlayers().block(uuid);
            } else {
                StatusMod.getBlockedPlayers().blockTemporary(uuid, System.currentTimeMillis() + durationMs,
                        prevStatus, prevColor, prevExpiresAtMs, prevTimedStatus, prevTimedColor);
            }
            // Hide the current status while ignored.
            settings.status = "";
            settings.color = StatusMod.getConfig() != null && StatusMod.getConfig().defaultColor != null ? StatusMod.getConfig().defaultColor : "reset";
            settings.statusExpiresAtMs = 0L;
            settings.timedPrevStatus = "";
            settings.timedPrevColor = "reset";
            settings.autoAfk = false;
            settings.lastStatusChangeAtMs = System.currentTimeMillis();
            StatusMod.getStorage().put(uuid, settings);
            StatusLifecycle.reapplyFor(targetPlayer, settings);
            SyncManager.requestPush();
            AuditLogger.logBlock(src.getTextName(), playerName);
            if (permanent) {
                CommandUtil.sendSuccess(src, Component.literal(playerName + " wurde vom Status-Mod blockiert."), true);
                targetPlayer.sendSystemMessage(Component.literal("Du wurdest vom Status-Mod blockiert."));
            } else {
                String pretty = DurationUtil.formatDuration(durationMs);
                CommandUtil.sendSuccess(src, Component.literal(playerName + " wurde für " + pretty + " ignoriert (automatische Rückkehr)."), true);
                targetPlayer.sendSystemMessage(Component.literal("Du wurdest für " + pretty + " vom Status-Mod ignoriert."));
            }
        } catch (Exception e) {
            try { src.sendFailure(Component.literal("Fehler beim Blockieren des Spielers.")); } catch (Exception ignore) {}
            e.printStackTrace();
        }
    }

    private static void unblockPlayer(CommandSourceStack src, String uuid, String playerName) {
        try {
            if (!StatusMod.getConfig().isEnabled("block")) {
                src.sendFailure(Component.literal("Das Block-Feature ist auf diesem Server deaktiviert."));
                return;
            }
            if (!PermissionUtil.hasAdminPermission(src)) {
                src.sendFailure(Component.literal("Du hast keine Berechtigung für diesen Befehl."));
                return;
            }
            ServerPlayer targetPlayer = src.getServer().getPlayerList().getPlayerByName(playerName);
            String targetUuid = targetPlayer != null ? targetPlayer.getUUID().toString() : uuid;
            BlockedPlayers.BlockEntry removed = StatusMod.getBlockedPlayers().unblock(targetUuid);
            if (removed == null) {
                src.sendFailure(Component.literal(playerName + " ist nicht blockiert."));
                return;
            }
            if (targetPlayer != null) {
                StatusLifecycle.restoreBlockedStatus(targetPlayer, removed, false);
                targetPlayer.sendSystemMessage(Component.literal("Du wurdest vom Status-Mod freigegeben."));
            }
            SyncManager.requestPush();
            AuditLogger.logUnblock(src.getTextName(), playerName);
            CommandUtil.sendSuccess(src, Component.literal(playerName + " wurde vom Status-Mod freigegeben."), true);
        } catch (Exception e) {
            try { src.sendFailure(Component.literal("Fehler beim Freigeben des Spielers.")); } catch (Exception ignore) {}
            e.printStackTrace();
        }
    }
}
