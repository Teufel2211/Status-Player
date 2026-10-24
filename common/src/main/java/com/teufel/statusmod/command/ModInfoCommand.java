package com.teufel.statusmod.command;

import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.util.CommandUtil;
import com.mojang.brigadier.CommandDispatcher;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;

public class ModInfoCommand {
    private static final String WEBSITE = "https://github.com/Teufel2211/StatusMod";
    private static final String ISSUES = "https://github.com/Teufel2211/StatusMod/issues";

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("modinfo").executes(ctx -> {
            CommandSourceStack src = ctx.getSource();
            try {
                CommandUtil.sendSuccess(src, Component.literal("StatusMod — Informationen"), false);
                CommandUtil.sendSuccess(src, Component.literal("Status: "
                    + (StatusMod.isRemoteDisabled()
                        ? "vom Admin-Dashboard deaktiviert"
                        : "aktiv")), false);
                CommandUtil.sendSuccess(src, Component.literal("Website: " + WEBSITE), false);
                CommandUtil.sendSuccess(src, Component.literal("Issues: " + ISSUES), false);
            } catch (Exception e) {
                src.sendFailure(Component.literal("Fehler beim Anzeigen der Mod-Informationen."));
                e.printStackTrace();
            }
            return 1;
        }));
    }
}
