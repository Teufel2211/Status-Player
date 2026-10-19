package com.teufel.statusmod.client;

import net.minecraft.client.Minecraft;

/**
 * Client-only Tick-Logik: Screenshot-Ordner einmalig setzen und die
 * Statusmenü-Taste pollen. Drücken sendet exakt "status" wie getippt -
 * der Server prüft Feature + Berechtigung unverändert.
 */
public final class ClientRuntime {
    private static boolean screenshotsDirSet;

    private ClientRuntime() {}

    public static void onClientTick() {
        Minecraft client = Minecraft.getInstance();
        if (client == null) return;

        if (!screenshotsDirSet) {
            BugImageClient.setScreenshotsDir(client.gameDirectory.toPath().resolve("screenshots"));
            screenshotsDirSet = true;
        }

        while (StatusMenuKeybind.KEY.consumeClick()) {
            if (client.player != null) {
                client.player.connection.sendCommand("status");
            }
        }
    }
}
