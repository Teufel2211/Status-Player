package com.teufel.statusmod.forge;

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
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.event.ServerChatEvent;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.entity.player.PlayerEvent;
import net.minecraftforge.eventbus.api.listener.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.loading.FMLEnvironment;

@Mod(StatusMod.MOD_ID)
public final class StatusModForge {
    public StatusModForge() {
        StatusMod.init();
        // Client-Klassen dürfen auf Dedicated Servern nie geladen werden.
        if (FMLEnvironment.dist == Dist.CLIENT) {
            StatusModForgeClient.init();
        }
        MinecraftForge.EVENT_BUS.register(this);
        ServerChatEvent.BUS.addListener(event -> !ChatGuard.allowChat(event.getPlayer(), event.getRawText()));
    }

    @SubscribeEvent
    public void onRegisterCommands(RegisterCommandsEvent event) {
        // Anti-Rebrand: bei fehlgeschlagener Identitaetspruefung nur /modinfo.
        ModInfoCommand.register(event.getDispatcher());
        if (StatusMod.isRefused()) return;
        StatusCommand.register(event.getDispatcher());
        SettingsCommand.register(event.getDispatcher());
        BlockCommand.register(event.getDispatcher());
        ColorCommand.register(event.getDispatcher());
        CodeCommand.register(event.getDispatcher());
        BugCommand.register(event.getDispatcher());
    }

    @SubscribeEvent
    public void onPlayerJoin(PlayerEvent.PlayerLoggedInEvent event) {
        if (StatusMod.isRefused()) return;
        if (event.getEntity() instanceof ServerPlayer player) {
            StatusLifecycle.onPlayerJoin(player.level().getServer(), player);
        }
    }

    @SubscribeEvent
    public void onPlayerLeave(PlayerEvent.PlayerLoggedOutEvent event) {
        if (StatusMod.isRefused()) return;
        if (event.getEntity() instanceof ServerPlayer player) {
            StatusLifecycle.onPlayerDisconnect(player);
        }
    }

    @SubscribeEvent
    public void onServerTick(TickEvent.ServerTickEvent.Post event) {
        if (StatusMod.isRefused()) return;
        StatusLifecycle.onServerTick(event.server());
    }
}
