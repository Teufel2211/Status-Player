package com.teufel.statusmod.client;

import com.mojang.blaze3d.platform.InputConstants;
import com.teufel.statusmod.StatusMod;
import net.minecraft.client.KeyMapping;
import net.minecraft.resources.Identifier;
import org.lwjgl.glfw.GLFW;

/**
 * Client-only: KeyMapping für das Statusmenü (Standard: U). Erscheint nach dem
 * ersten Start automatisch in den Minecraft-Steuerungen unter der Kategorie
 * "StatusMod" und ist dort frei änderbar.
 */
public final class StatusMenuKeybind {
    public static final KeyMapping.Category CATEGORY =
            KeyMapping.Category.register(Identifier.fromNamespaceAndPath(StatusMod.MOD_ID, "main"));

    public static final KeyMapping KEY = new KeyMapping(
            "key.statusmod.statusmenu",
            InputConstants.Type.KEYSYM,
            GLFW.GLFW_KEY_U,
            CATEGORY);

    private StatusMenuKeybind() {}
}
