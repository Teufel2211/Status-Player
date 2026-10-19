package com.teufel.statusmod.util;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;

import java.net.URI;

/**
 * Klickbare Chat-Bausteine für /bug-Bildlinks und das /bugbild-Menü.
 * Nutzt die modernen ClickEvent-Records (1.21.5+); die aktuelle
 * Build-Matrix (1.21.11 + 26.x) unterstützt sie durchgehend.
 */
public final class ChatLinks {
    private ChatLinks() {}

    public static Component button(String label, ClickEvent click, ChatFormatting color, String hover) {
        MutableComponent text = Component.literal(label);
        Style style = Style.EMPTY.withColor(color).withClickEvent(click);
        if (hover != null && !hover.isEmpty()) {
            style = style.withHoverEvent(new HoverEvent.ShowText(Component.literal(hover)));
        }
        text.setStyle(style);
        return text;
    }

    public static Component runCommand(String label, String command, ChatFormatting color, String hover) {
        return button(label, new ClickEvent.RunCommand(command), color, hover);
    }

    public static Component openUrl(String label, String url, ChatFormatting color, String hover) {
        try {
            URI uri = URI.create(url);
            String scheme = uri.getScheme();
            if (scheme != null && (scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) {
                return button(label, new ClickEvent.OpenUrl(uri), color, hover);
            }
        } catch (Exception ignored) {
            // Ungültige URL - dann eben nur Text ohne Klick.
        }
        return Component.literal(label);
    }

    public static Component copyToClipboard(String label, String value, ChatFormatting color, String hover) {
        return button(label, new ClickEvent.CopyToClipboard(value), color, hover);
    }
}
