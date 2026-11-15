package com.teufel.statusmod.client;

import com.mojang.blaze3d.platform.InputConstants;
import com.teufel.statusmod.StatusMod;
import net.minecraft.client.KeyMapping;
import net.minecraft.resources.Identifier;

/**
 * Client-only: KeyMapping für das Statusmenü (Standard: U). Erscheint nach dem
 * ersten Start automatisch in den Minecraft-Steuerungen unter der Kategorie
 * "StatusMod" und ist dort frei änderbar.
 *
 * Bewusst OHNE org.lwjgl.glfw und ohne InputConstants.Type: MC 26.3 hat GLFW
 * durch SDL ersetzt (kein lwjgl-glfw mehr im Client) und den Type-Enum-Wert
 * KEYSYM zu KEYBOARD umbenannt. Der (String, int, Category)-Konstruktor mit
 * InputConstants.KEY_U existiert in allen Zielversionen (1.21.11 + 26.1-26.3).
 */
public final class StatusMenuKeybind {
    public static final KeyMapping.Category CATEGORY =
            KeyMapping.Category.register(Identifier.fromNamespaceAndPath(StatusMod.MOD_ID, "main"));

    public static final KeyMapping KEY = new KeyMapping(
            "key.statusmod.statusmenu",
            InputConstants.KEY_U,
            CATEGORY);

    private StatusMenuKeybind() {}
}
