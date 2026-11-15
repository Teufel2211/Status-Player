package com.teufel.statusmod.command;

import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.storage.PlayerSettings;
import com.teufel.statusmod.util.CommandUtil;
import com.teufel.statusmod.util.FontMapper;
import com.teufel.statusmod.util.PermissionUtil;
import com.teufel.statusmod.util.StatusTeamUtil;
import com.teufel.statusmod.util.StatusTextUtil;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.SharedSuggestionProvider;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

public class SettingsCommand {
    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("settings")
            .requires(ctx -> !StatusMod.isRemoteDisabled())
            .then(Commands.literal("brackets").then(Commands.argument("value", StringArgumentType.word()).suggests((ctx, builder) -> SharedSuggestionProvider.suggest(new String[]{"off","square","angle"}, builder)).executes(ctx -> { setBrackets(ctx.getSource(), ctx.getSource().getPlayer(), parseBracketStyle(StringArgumentType.getString(ctx, "value"))); return 1; })))
            .then(Commands.literal("position").then(Commands.argument("value", StringArgumentType.word()).suggests((ctx, builder) -> SharedSuggestionProvider.suggest(new String[]{"before","after"}, builder)).executes(ctx -> { setPosition(ctx.getSource(), ctx.getSource().getPlayer(), isBefore(StringArgumentType.getString(ctx, "value"))); return 1; })))
            .then(Commands.literal("words").then(Commands.argument("value", IntegerArgumentType.integer(1, 10)).executes(ctx -> { setWords(ctx.getSource(), ctx.getSource().getPlayer(), IntegerArgumentType.getInteger(ctx, "value")); return 1; })))
            .then(Commands.literal("font").then(Commands.argument("value", StringArgumentType.word()).suggests(CommandSuggestions.FONT_SUGGESTIONS).executes(ctx -> { setFont(ctx.getSource(), ctx.getSource().getPlayer(), StringArgumentType.getString(ctx, "value")); return 1; })))
        );
    }

    private static boolean isTrue(String v) { return v != null && (v.equalsIgnoreCase("on") || v.equalsIgnoreCase("true") || v.equalsIgnoreCase("an") || v.equalsIgnoreCase("ein")); }
    private static boolean isBefore(String v) { return v != null && (v.equalsIgnoreCase("before") || v.equalsIgnoreCase("vor") || v.equalsIgnoreCase("vorn")); }
    private static int parseBracketStyle(String v) {
        if (v == null) return 0;
        return switch (v.toLowerCase()) {
            case "square", "on", "true", "an", "ein", "[]" -> 1;
            case "angle", "<>", "<" -> 2;
            default -> 0;
        };
    }
    private static String bracketStyleName(int style) {
        return switch (style) {
            case 1 -> "Eckige Klammern []";
            case 2 -> "Spitze Klammern <>";
            default -> "Keine Klammern";
        };
    }

    private static void setBrackets(CommandSourceStack src, ServerPlayer p, int value) { update(src, p, s -> s.brackets = value, "Klammern: " + bracketStyleName(value)); }
    private static void setPosition(CommandSourceStack src, ServerPlayer p, boolean before) { update(src, p, s -> s.beforeName = before, "Position: " + (before ? "vor dem Namen" : "hinter dem Namen")); }
    private static void setWords(CommandSourceStack src, ServerPlayer p, int words) { update(src, p, s -> s.statusWords = Math.max(1, words), "Anzahl Status-Wörter: " + Math.max(1, words)); }
    private static void setFont(CommandSourceStack src, ServerPlayer p, String style) { update(src, p, s -> s.fontStyle = FontMapper.normalizeStyle(style), "Schriftart: " + FontMapper.normalizeStyle(style)); }

    private static void update(CommandSourceStack src, ServerPlayer p, java.util.function.Consumer<PlayerSettings> mutator, String msg) {
        try {
            if (!StatusMod.getConfig().isEnabled("status")) { src.sendFailure(Component.literal("Das Status-Feature ist auf diesem Server deaktiviert.")); return; }
            if (!PermissionUtil.hasStatusPermission(src)) { src.sendFailure(Component.literal("Du hast keine Berechtigung.")); return; }
            if (p == null) { src.sendFailure(Component.literal("Nur Spieler können diesen Befehl nutzen.")); return; }
            String uuid = p.getUUID().toString();
            if (StatusMod.getBlockedPlayers().isBlocked(uuid)) { src.sendFailure(Component.literal("Du wurdest vom Status-Mod blockiert.")); return; }
            if (StatusMod.getMutedPlayers().isMuted(uuid)) { src.sendFailure(Component.literal("Du bist vom Status-Mod gestummt.")); return; }
            PlayerSettings s = StatusMod.getStorage().forPlayer(uuid);
            mutator.accept(s);
            StatusMod.getStorage().put(uuid, s);
            p.sendSystemMessage(Component.literal(msg));
            MinecraftServer server = src.getServer();
            StatusTeamUtil.applyStatus(server.getScoreboard(), p, s, StatusTextUtil.resolveStatusForPlayer(s, p), StatusTextUtil.resolveColorForPlayer(s, p), PermissionUtil.hasAdminPermission(p));
        } catch (Exception e) { e.printStackTrace(); }
    }
}
