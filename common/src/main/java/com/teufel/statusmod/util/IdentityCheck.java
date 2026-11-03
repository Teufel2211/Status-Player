package com.teufel.statusmod.util;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.teufel.statusmod.StatusMod;

import java.io.File;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.CodeSource;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Laufzeit-Identitaetspruefung (Anti-Rebrand).
 *
 * <p>Prueft, ob dieses JAR noch die erwartete Identitaet traegt: Mod-ID,
 * Anzeigename, Version und - falls vorhanden - die Loader-Metadaten im JAR.
 * Wird beim Init aufgerufen; bei Abweichung startet der Mod nicht
 * (keine Commands ausser /modinfo, kein Sync, kein Lifecycle).</p>
 *
 * <p>Wichtig: Die Loader-Metadaten werden ausschliesslich aus dem eigenen
 * Artefakt gelesen. {@code getResourceAsStream("/fabric.mod.json")} waere
 * falsch, weil der Mod-Klassenlader die Ressourcen aller Mods sieht und
 * dann die Datei eines fremden Mods zurueckliefert.</p>
 *
 * <p>Grenze: Ein Fork aus dem Quellcode kann diese Pruefung entfernen. Sie ist
 * eine Huerde gegen JAR-Patching, keine Lizenzdurchsetzung.</p>
 */
public final class IdentityCheck {
    private static final String EXPECTED_ID = "statusmod";
    private static final String EXPECTED_NAME = "Status Player";
    private static final Pattern TOML_MOD_ID = Pattern.compile("(?m)^\\s*modId\\s*=\\s*\"([^\"]+)\"");

    /** Nur dieses Artefakt enthaelt die Klasse - Marker fuer "das ist unsere JAR". */
    private static final String OWN_MARKER = "com/teufel/statusmod/StatusMod.class";

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
            JsonObject fabric = readJson("fabric.mod.json");
            if (fabric != null) return asString(fabric, "id");

            JsonObject quilt = readJson("quilt.mod.json");
            if (quilt != null) {
                if (quilt.has("quilt_loader") && quilt.get("quilt_loader").isJsonObject()) {
                    return asString(quilt.getAsJsonObject("quilt_loader"), "id");
                }
                return asString(quilt, "id");
            }

            String neo = readText("META-INF/neoforge.mods.toml");
            if (neo != null) return firstTomlModId(neo);

            String forge = readText("META-INF/mods.toml");
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
        String name = resource.startsWith("/") ? resource.substring(1) : resource;
        byte[] data = readOwnEntry(name);
        if (data == null) return null;
        return new String(data, StandardCharsets.UTF_8);
    }

    // ------------------------------------------------------------------
    // Own-artifact handling
    // ------------------------------------------------------------------

    /** Reads a resource from this mod's own JAR/directory only. */
    private static byte[] readOwnEntry(String name) {
        File self = ownArtifact();
        if (self == null) return null;
        try {
            if (self.isFile()) return readEntryFromZip(self, name);
            if (self.isDirectory()) {
                Path p = self.toPath().resolve(name);
                return Files.isRegularFile(p) ? Files.readAllBytes(p) : null;
            }
        } catch (Throwable ignored) {
            // fall through
        }
        return null;
    }

    /** Locates this mod's own JAR (release) or classes directory (dev). */
    private static File ownArtifact() {
        File candidate = fromCodeSource();
        if (isOwnArtifact(candidate)) return candidate;

        candidate = fromClassResource();
        if (isOwnArtifact(candidate)) return candidate;

        return null;
    }

    private static File fromCodeSource() {
        try {
            CodeSource cs = IdentityCheck.class.getProtectionDomain().getCodeSource();
            if (cs == null || cs.getLocation() == null) return null;
            return toFile(cs.getLocation());
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static File fromClassResource() {
        try {
            String path = "/" + IdentityCheck.class.getName().replace('.', '/') + ".class";
            URL self = IdentityCheck.class.getResource(path);
            if (self == null) return null;
            String s = self.toExternalForm();
            int bang = s.indexOf("!/");
            if (s.startsWith("jar:") && bang > 4) {
                return toFile(java.net.URI.create(s.substring(4, bang)).toURL());
            }
        } catch (Throwable ignored) {
            // not a JAR (directory or exotic filesystem)
        }
        return null;
    }

    private static File toFile(URL url) {
        try {
            return new File(url.toURI());
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Guards against false positives: a loader may report a CodeSource that
     * points at a shared classpath entry (e.g. the loader's own JAR). Only a
     * location containing our marker class counts as "our artifact".
     */
    private static boolean isOwnArtifact(File candidate) {
        if (candidate == null || !candidate.exists()) return false;
        try {
            if (candidate.isFile()) return readEntryFromZip(candidate, OWN_MARKER) != null;
            if (candidate.isDirectory()) return candidate.toPath().resolve(OWN_MARKER).toFile().isFile();
        } catch (Throwable ignored) {
            return false;
        }
        return false;
    }

    private static byte[] readEntryFromZip(File jar, String name) {
        try (ZipFile zip = new ZipFile(jar)) {
            ZipEntry entry = zip.getEntry(name);
            if (entry == null) return null;
            try (InputStream in = zip.getInputStream(entry)) {
                return in.readAllBytes();
            }
        } catch (Throwable ignored) {
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
