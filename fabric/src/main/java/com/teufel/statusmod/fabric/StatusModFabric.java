package com.teufel.statusmod.fabric;

import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.command.BlockCommand;
import com.teufel.statusmod.command.BugCommand;
import com.teufel.statusmod.command.CodeCommand;
import com.teufel.statusmod.command.ColorCommand;
import com.teufel.statusmod.command.ModInfoCommand;
import com.teufel.statusmod.command.SettingsCommand;
import com.teufel.statusmod.command.StatusCommand;
import com.teufel.statusmod.lifecycle.StatusLifecycle;
import com.teufel.statusmod.util.ChatGuard;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.message.v1.ServerMessageEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.api.ModInitializer;

public final class StatusModFabric implements ModInitializer {
    @Override
    public void onInitialize() {
        StatusMod.init();
        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) -> {
            StatusCommand.register(dispatcher);
            ModInfoCommand.register(dispatcher);
            SettingsCommand.register(dispatcher);
            BlockCommand.register(dispatcher);
            ColorCommand.register(dispatcher);
            CodeCommand.register(dispatcher);
            BugCommand.register(dispatcher);
        });
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> StatusLifecycle.onPlayerJoin(server, handler.getPlayer()));
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> StatusLifecycle.onPlayerDisconnect(handler.getPlayer()));
        ServerTickEvents.END_SERVER_TICK.register(StatusLifecycle::onServerTick);
        ServerMessageEvents.ALLOW_CHAT_MESSAGE.register((message, player, params) ->
            ChatGuard.allowChat(player, message.signedContent()));
    }
}
