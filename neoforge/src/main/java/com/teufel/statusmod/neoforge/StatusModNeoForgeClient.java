package com.teufel.statusmod.neoforge;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.client.BugImageClient;
import com.teufel.statusmod.client.ClientRuntime;
import com.teufel.statusmod.client.RawStringArgumentType;
import com.teufel.statusmod.client.StatusMenuKeybind;
import net.minecraft.client.Minecraft;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterClientCommandsEvent;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;

/**
 * Client-only Glue (NeoForge). Der Annotation-Subscriber routet automatisch:
 * IModBusEvent (KeyMappings) auf den Mod-Bus, alles andere auf den Game-Bus.
 */
@EventBusSubscriber(modid = StatusMod.MOD_ID, value = Dist.CLIENT)
public final class StatusModNeoForgeClient {
    private StatusModNeoForgeClient() {}

    @SubscribeEvent
    public static void onRegisterKeyMappings(RegisterKeyMappingsEvent event) {
        event.register(StatusMenuKeybind.KEY);
    }

    @SubscribeEvent
    public static void onRegisterClientCommands(RegisterClientCommandsEvent event) {
        registerCommands(event.getDispatcher());
    }

    @SubscribeEvent
    public static void onClientTick(ClientTickEvent.Post event) {
        ClientRuntime.onClientTick();
    }

    private static void registerCommands(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("bugbild")
                .executes(ctx -> {
                    CommandSourceStack source = ctx.getSource();
                    BugImageClient.sendUsage(component -> Minecraft.getInstance().execute(() -> source.sendSuccess(() -> component, false)));
                    return 1;
                })
                .then(Commands.argument("url", RawStringArgumentType.rawString())
                        .executes(ctx -> {
                            CommandSourceStack source = ctx.getSource();
                            String url = RawStringArgumentType.getRawString(ctx, "url");
                            BugImageClient.listScreenshots(
                                    component -> Minecraft.getInstance().execute(() -> source.sendSuccess(() -> component, false)),
                                    url);
                            return 1;
                        })
                        .then(Commands.literal("send")
                                .then(Commands.argument("index", IntegerArgumentType.integer(1))
                                        .executes(ctx -> {
                                            CommandSourceStack source = ctx.getSource();
                                            String url = RawStringArgumentType.getRawString(ctx, "url");
                                            int index = IntegerArgumentType.getInteger(ctx, "index");
                                            BugImageClient.sendScreenshot(
                                                    component -> Minecraft.getInstance().execute(() -> source.sendSuccess(() -> component, false)),
                                                    url, index);
                                            return 1;
                                        })))));
    }
}
