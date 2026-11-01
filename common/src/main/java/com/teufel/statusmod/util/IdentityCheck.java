package com.teufel.statusmod.util;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.teufel.statusmod.StatusMod;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Laufzeit-Identitaetspruefung (Anti-Rebrand).
 *
 * <p>Prueft, ob dieses JAR noch die erwartete Identitaet traegt: Mod-ID,
 * Anzeigename, Version und - falls vorhanden - die Loader-Metadaten im JAR.
 * Wird beim Init aufgerufen; bei Abweichung startet der Mod nicht
 * (keine Commands ausser /modinfo, kein Sync, kein Lifecycle).</p>
 *
 * <p>Grenze: Ein Fork aus dem Quellcode kann diese Pruefung entfernen. Sie ist
 * eine Huerde gegen JAR-Patching, keine Lizenzdurchsetzung.</p>
 */
public final class IdentityCheck {
    private static final String EXPECTED_ID = "statusmod";
    private static final String EXPECTED_NAME = "Status Player";
    private static final Pattern TOML_MOD_ID = Pattern.compile("(?m)^\\s*modId\\s*=\\s*\"([^\"]+)\"");

    private IdentityCheck() {}

    /**
     * @return null wenn alles passt, sonst eine kurze Begruendung (englisch,
     *         damit sie in jedem Log lesbar bleibt).
     */
    public static String failureReason() {
        if (!EXPECTED_ID.equals(StatusMod.MOD_ID)) {
            return "mod id is '" + StatusMod.MOD_ID + "'";
        }
        if (!EXPECTED_NAME.equals(StatusMod.DISPLAY_NAME)) {
            return "display name is '" + StatusMod.DISPLAY_NAME + "'";
        }
        if (StatusMod.VERSION == null || StatusMod.VERSION.trim().isEmpty()) {
            return "version is empty";
        }
        String metadataId = metadataModId();
        if (metadataId != null && !EXPECTED_ID.equals(metadataId)) {
            return "loader metadata declares mod id '" + metadataId + "'";
        }
        return null;
    }

    /**
     * Liest die Mod-ID aus der Loader-Metadaten-Ressource, die in diesem JAR
     * liegt. {@code null} = keine Metadaten gefunden (z. B. Unit-/Dev-Kontext),
     * dann wird die Pruefung nicht erzwungen.
     */
    private static String metadataModId() {
        try {
            JsonObject fabric = readJson("/fabric.mod.json");
            if (fabric != null) return asString(fabric, "id");

            JsonObject quilt = readJson("/quilt.mod.json");
            if (quilt != null) {
                if (quilt.has("quilt_loader") && quilt.get("quilt_loader").isJsonObject()) {
                    return asString(quilt.getAsJsonObject("quilt_loader"), "id");
                }
                return asString(quilt, "id");
            }

            String neo = readText("/META-INF/neoforge.mods.toml");
            if (neo != null) return firstTomlModId(neo);

            String forge = readText("/META-INF/mods.toml");
            if (forge != null) return firstTomlModId(forge);
        } catch (Exception ignored) {
            // Defekte Metadaten sind Sache des Loaders, nicht dieser Pruefung.
        }
        return null;
    }

    private static JsonObject readJson(String resource) {
        String text = readText(resource);
        if (text == null) return null;
        try {
            return JsonParser.parseString(text).getAsJsonObject();
        } catch (Exception e) {
            return null;
        }
    }

    private static String readText(String resource) {
        try (InputStream in = IdentityCheck.class.getResourceAsStream(resource)) {
            if (in == null) return null;
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    private static String asString(JsonObject obj, String key) {
        try {
            if (obj.has(key) && obj.get(key).isJsonPrimitive()) return obj.get(key).getAsString();
        } catch (Exception ignored) {}
        return null;
    }

    private static String firstTomlModId(String toml) {
        Matcher m = TOML_MOD_ID.matcher(toml);
        return m.find() ? m.group(1) : null;
    }
}
