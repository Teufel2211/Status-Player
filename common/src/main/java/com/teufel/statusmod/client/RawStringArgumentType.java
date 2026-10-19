package com.teufel.statusmod.client;

import com.mojang.brigadier.StringReader;
import com.mojang.brigadier.arguments.ArgumentType;
import com.mojang.brigadier.context.CommandContext;

import java.util.Collection;
import java.util.List;

/**
 * Argument, das den Rest des Tokens liest - ohne die Zeichenbeschränkung von
 * {@code StringArgumentType.word()}. Nötig für URLs mit {@code : / ? = &}:
 * Brigadier bricht dort sonst mit "Expected whitespace to end one argument,
 * but found trailing data" ab (word() stoppt beim Doppelpunkt von https://).
 *
 * <p>Stoppt vor dem Leerzeichen (verbraucht es nicht), damit danach noch
 * Unterbefehle wie {@code send <index>} geparst werden können.</p>
 */
public final class RawStringArgumentType implements ArgumentType<String> {
    private static final RawStringArgumentType INSTANCE = new RawStringArgumentType();

    private RawStringArgumentType() {}

    public static RawStringArgumentType rawString() {
        return INSTANCE;
    }

    public static String getRawString(CommandContext<?> context, String name) {
        return context.getArgument(name, String.class);
    }

    @Override
    public String parse(StringReader reader) {
        StringBuilder value = new StringBuilder();
        while (reader.canRead() && reader.peek() != ' ') {
            value.append(reader.read());
        }
        return value.toString();
    }

    @Override
    public Collection<String> getExamples() {
        return List.of("https://example.com/api/bug-report/image?c=ABC123");
    }
}
