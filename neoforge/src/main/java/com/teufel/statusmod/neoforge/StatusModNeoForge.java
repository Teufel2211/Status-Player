package com.teufel.statusmod.neoforge;

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
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.ServerChatEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;

@Mod(StatusMod.MOD_ID)
public final class StatusModNeoForge {
    public StatusModNeoForge() {
        StatusMod.init();
        NeoForge.EVENT_BUS.register(this);
    }

    @SubscribeEvent
    public void onRegisterCommands(RegisterCommandsEvent event) {
        StatusCommand.register(event.getDispatcher());
        ModInfoCommand.register(event.getDispatcher());
        SettingsCommand.register(event.getDispatcher());
        BlockCommand.register(event.getDispatcher());
        ColorCommand.register(event.getDispatcher());
        CodeCommand.register(event.getDispatcher());
        BugCommand.register(event.getDispatcher());
    }

    @SubscribeEvent
    public void onPlayerJoin(PlayerEvent.PlayerLoggedInEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) {
            StatusLifecycle.onPlayerJoin(player.level().getServer(), player);
        }
    }

    @SubscribeEvent
    public void onPlayerLeave(PlayerEvent.PlayerLoggedOutEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) {
            StatusLifecycle.onPlayerDisconnect(player);
        }
    }

    @SubscribeEvent
    public void onServerTick(ServerTickEvent.Post event) {
        StatusLifecycle.onServerTick(event.getServer());
    }

    @SubscribeEvent
    public void onChat(ServerChatEvent event) {
        if (!ChatGuard.allowChat(event.getPlayer(), event.getRawText())) {
            event.setCanceled(true);
        }
    }
}
