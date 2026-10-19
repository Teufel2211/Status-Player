package com.teufel.statusmod.fabric;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import com.teufel.statusmod.client.BugImageClient;
import com.teufel.statusmod.client.ClientRuntime;
import com.teufel.statusmod.client.RawStringArgumentType;
import com.teufel.statusmod.client.StatusMenuKeybind;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.KeyMapping;

/**
 * Client-only Glue (Fabric, inkl. Quilt): registriert die Statusmenü-Taste und
 * den lokalen Befehl /bugbild. Wird auf Dedicated Servern nie geladen.
 *
 * <p>Die Key-Mapping-Registrierung läuft über Reflection, weil Fabric API die
 * Klasse zwischen den Versionen umbenannt hat (KeyBindingHelper -> KeyMappingHelper
 * ab MC 26.x). Die Command-Builder kommen direkt aus Brigadier, damit derselbe
 * Quelltext gegen beide Fabric-API-Generationen kompiliert.</p>
 */
public final class StatusModFabricClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        registerKeyMapping();
        ClientTickEvents.END_CLIENT_TICK.register(client -> ClientRuntime.onClientTick());

        ClientCommandRegistrationCallback.EVENT.register((dispatcher, registryAccess) -> {
            LiteralArgumentBuilder<FabricClientCommandSource> root =
                    LiteralArgumentBuilder.literal("bugbild");
            root.then(RequiredArgumentBuilder.<FabricClientCommandSource, String>argument(
                            "url", RawStringArgumentType.rawString())
                    .executes(ctx -> {
                        FabricClientCommandSource source = ctx.getSource();
                        String url = RawStringArgumentType.getRawString(ctx, "url");
                        BugImageClient.listScreenshots(
                                component -> source.getClient().execute(() -> source.sendFeedback(component)),
                                url);
                        return 1;
                    })
                    .then(LiteralArgumentBuilder.<FabricClientCommandSource>literal("send")
                            .then(RequiredArgumentBuilder.<FabricClientCommandSource, Integer>argument(
                                            "index", IntegerArgumentType.integer(1))
                                    .executes(ctx -> {
                                        FabricClientCommandSource source = ctx.getSource();
                                        String url = RawStringArgumentType.getRawString(ctx, "url");
                                        int index = IntegerArgumentType.getInteger(ctx, "index");
                                        BugImageClient.sendScreenshot(
                                                component -> source.getClient().execute(() -> source.sendFeedback(component)),
                                                url, index);
                                        return 1;
                                    }))));
            root.executes(ctx -> {
                FabricClientCommandSource source = ctx.getSource();
                BugImageClient.sendUsage(component -> source.getClient().execute(() -> source.sendFeedback(component)));
                return 1;
            });
            dispatcher.register(root);
        });
    }

    private static void registerKeyMapping() {
        // MC 26.x / Fabric API 0.161+: KeyMappingHelper.registerKeyMapping
        try {
            Class<?> helper = Class.forName("net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper");
            helper.getMethod("registerKeyMapping", KeyMapping.class).invoke(null, StatusMenuKeybind.KEY);
            return;
        } catch (ClassNotFoundException ignored) {
            // Ältere Fabric API: Fallback unten
        } catch (ReflectiveOperationException e) {
            System.out.println("[StatusMod] Keybind registration failed: " + e);
            return;
        }
        // 1.21.x: KeyBindingHelper.registerKeyBinding
        try {
            Class<?> helper = Class.forName("net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper");
            helper.getMethod("registerKeyBinding", KeyMapping.class).invoke(null, StatusMenuKeybind.KEY);
        } catch (ReflectiveOperationException e) {
            System.out.println("[StatusMod] Keybind registration failed: " + e);
        }
    }
}
