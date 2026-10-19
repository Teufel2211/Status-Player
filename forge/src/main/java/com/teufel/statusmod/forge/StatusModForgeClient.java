package com.teufel.statusmod.forge;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.teufel.statusmod.client.BugImageClient;
import com.teufel.statusmod.client.ClientRuntime;
import com.teufel.statusmod.client.RawStringArgumentType;
import com.teufel.statusmod.client.StatusMenuKeybind;
import net.minecraft.client.Minecraft;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraftforge.client.event.RegisterClientCommandsEvent;
import net.minecraftforge.client.event.RegisterKeyMappingsEvent;
import net.minecraftforge.event.TickEvent;

/**
 * Client-only Glue (Forge). Wird nur geladen, wenn FMLEnvironment.dist CLIENT ist.
 * Nutzt die Event-BUS-Felder des modernen Forge-Eventbus (1.21.9+), damit
 * derselbe Code auch für Forge 26.x kompiliert.
 */
public final class StatusModForgeClient {
    private StatusModForgeClient() {}

    public static void init() {
        RegisterKeyMappingsEvent.BUS.addListener(event -> event.register(StatusMenuKeybind.KEY));
        RegisterClientCommandsEvent.BUS.addListener(event -> registerCommands(event.getDispatcher()));
        TickEvent.ClientTickEvent.Post.BUS.addListener(event -> ClientRuntime.onClientTick());
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
