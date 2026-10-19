package com.teufel.statusmod.client;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.teufel.statusmod.util.ChatLinks;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Client-only Bild-Anhänge für /bug: listet die neuesten Screenshots aus dem
 * screenshots-Ordner als klickbare Chat-Zeilen und lädt sie verkleinert
 * (max. 1920 px, JPEG q0.85) zum Dashboard-Upload-Link hoch.
 *
 * Referenziert bewusst keine Client-Klassen - wird nur vom Client-Entrypoint
 * geladen, damit Dedicated Server unberührt bleiben.
 */
public final class BugImageClient {
    private static final int MAX_EDGE = 1920;
    private static final float JPEG_QUALITY = 0.85f;
    private static final int MAX_LIST = 6;
    private static final int MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
    private static final long CACHE_TTL_MS = 10 * 60 * 1000L;

    private static final HttpClient HTTP_CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .version(HttpClient.Version.HTTP_1_1)
            .build();

    private static final Map<String, CachedList> CACHE = new HashMap<>();

    private static volatile Path screenshotsDir;

    private BugImageClient() {}

    public static void setScreenshotsDir(Path dir) {
        screenshotsDir = dir;
    }

    /** Hinweis, wenn /bugbild ohne Upload-Link benutzt wird — bleibt lokal statt zum Server zu gehen. */
    public static void sendUsage(Consumer<Component> feedback) {
        feedback.accept(Component.literal("Bilder hängst du über den Button [Im Spiel anhängen] in deiner /bug-Meldung an. Für einen neuen Screenshot drücke vorher F2.")
                .withStyle(ChatFormatting.GRAY));
    }

    /** Listet die neuesten Screenshots als klickbare Chat-Zeilen. */
    public static void listScreenshots(Consumer<Component> feedback, String apiUrl) {
        if (!isHttpUrl(apiUrl)) {
            feedback.accept(Component.literal("Ungültiger Upload-Link — bitte erstelle eine neue /bug-Meldung.").withStyle(ChatFormatting.RED));
            return;
        }

        List<Path> files = freshList(apiUrl);
        if (files.isEmpty()) {
            feedback.accept(Component.literal("Keine Screenshots gefunden. Drücke F2 und klicke dann erneut auf [Im Spiel anhängen].").withStyle(ChatFormatting.GRAY));
            return;
        }

        feedback.accept(Component.literal("Screenshots (neueste zuerst) — klicke [Senden]:").withStyle(ChatFormatting.GRAY));
        for (int i = 0; i < files.size(); i++) {
            Path file = files.get(i);
            Component line = Component.literal((i + 1) + ". ").withStyle(ChatFormatting.DARK_GRAY)
                    .append(Component.literal(fileName(file)).withStyle(ChatFormatting.WHITE))
                    .append(Component.literal("  "))
                    .append(ChatLinks.runCommand("[Senden]", "/bugbild " + apiUrl + " send " + (i + 1), ChatFormatting.AQUA,
                            "Diesen Screenshot an die Bug-Meldung anhängen"));
            feedback.accept(line);
        }
        feedback.accept(Component.literal("Tipp: F2 nimmt einen neuen Screenshot auf.").withStyle(ChatFormatting.DARK_GRAY));
    }

    /** Lädt Screenshot Nummer {@code index} (1-basiert, Reihenfolge wie in der Liste) hoch. */
    public static void sendScreenshot(Consumer<Component> feedback, String apiUrl, int index) {
        if (!isHttpUrl(apiUrl)) {
            feedback.accept(Component.literal("Ungültiger Upload-Link — bitte erstelle eine neue /bug-Meldung.").withStyle(ChatFormatting.RED));
            return;
        }

        List<Path> files = cachedList(apiUrl);
        if (index < 1 || index > files.size()) {
            feedback.accept(Component.literal("Screenshot " + index + " nicht gefunden — klicke erneut auf [Im Spiel anhängen].").withStyle(ChatFormatting.RED));
            return;
        }

        Path file = files.get(index - 1);
        String name = fileName(file);
        feedback.accept(Component.literal("Sende " + name + " …").withStyle(ChatFormatting.GRAY));

        Thread thread = new Thread(() -> upload(feedback, apiUrl, file, name), "statusmod-bugimage");
        thread.setDaemon(true);
        thread.start();
    }

    private static void upload(Consumer<Component> feedback, String apiUrl, Path file, String name) {
        try {
            byte[] jpeg = downscaleToJpeg(Files.readAllBytes(file));
            if (jpeg.length > MAX_UPLOAD_BYTES) {
                feedback.accept(Component.literal("Das Bild ist auch nach dem Verkleinern zu groß.").withStyle(ChatFormatting.RED));
                return;
            }

            HttpRequest request = HttpRequest.newBuilder(URI.create(apiUrl))
                    .timeout(Duration.ofSeconds(45))
                    .header("Content-Type", "image/jpeg")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(jpeg))
                    .build();

            HttpResponse<String> response = HTTP_CLIENT.send(request, HttpResponse.BodyHandlers.ofString());
            int status = response.statusCode();

            if (status >= 200 && status < 300) {
                int count = 0;
                int remaining = 0;
                try {
                    JsonObject obj = JsonParser.parseString(response.body()).getAsJsonObject();
                    if (obj.has("count")) count = obj.get("count").getAsInt();
                    if (obj.has("remaining")) remaining = obj.get("remaining").getAsInt();
                } catch (Exception ignored) {
                    // Antwort ohne JSON ist trotzdem Erfolg (2xx).
                }
                String message = "✅ " + name + " gesendet" + (count > 0 ? " (" + count + "/3)" : "") + ".";
                if (remaining > 0) message += " Noch " + remaining + " Bild(er) möglich.";
                feedback.accept(Component.literal(message).withStyle(ChatFormatting.GREEN));
            } else if (status == 410) {
                feedback.accept(Component.literal("Der Upload-Code ist abgelaufen. Bitte erstelle eine neue /bug-Meldung.").withStyle(ChatFormatting.RED));
            } else if (status == 429) {
                feedback.accept(Component.literal("Zu viele Uploads — bitte warte ein paar Minuten.").withStyle(ChatFormatting.RED));
            } else if (status == 413) {
                feedback.accept(Component.literal("Das Bild ist zu groß (max. 3 MB nach dem Verkleinern).").withStyle(ChatFormatting.RED));
            } else if (status == 415) {
                feedback.accept(Component.literal("Das Bildformat wird nicht unterstützt.").withStyle(ChatFormatting.RED));
            } else if (status == 404) {
                feedback.accept(Component.literal("Upload-Code ungültig — bitte erstelle eine neue /bug-Meldung.").withStyle(ChatFormatting.RED));
            } else {
                feedback.accept(Component.literal("Upload fehlgeschlagen (HTTP " + status + ").").withStyle(ChatFormatting.RED));
            }
        } catch (Exception e) {
            feedback.accept(Component.literal("Upload fehlgeschlagen (keine Verbindung zum Dashboard).").withStyle(ChatFormatting.RED));
        }
    }

    /**
     * Nutzt die zuletzt angezeigte Liste (stabile [Senden]-Indizes). Ist keine
     * vorhanden (z. B. direkt nach Mod-Neustart), wird frisch gelesen.
     */
    private static List<Path> cachedList(String apiUrl) {
        long now = System.currentTimeMillis();
        synchronized (CACHE) {
            CACHE.entrySet().removeIf(entry -> now - entry.getValue().createdAt > CACHE_TTL_MS);
            CachedList cached = CACHE.get(apiUrl);
            if (cached != null) return cached.files;

            List<Path> files = scanScreenshots();
            CACHE.put(apiUrl, new CachedList(files, now));
            return files;
        }
    }

    /**
     * Liest den Screenshot-Ordner immer frisch, damit ein direkt nach F2
     * geklickter Button die neue Datei sofort zeigt, und merkt sich die Liste
     * für die Auflösung von [Senden].
     */
    private static List<Path> freshList(String apiUrl) {
        long now = System.currentTimeMillis();
        synchronized (CACHE) {
            CACHE.entrySet().removeIf(entry -> now - entry.getValue().createdAt > CACHE_TTL_MS);

            List<Path> files = scanScreenshots();
            CACHE.put(apiUrl, new CachedList(files, now));
            return files;
        }
    }

    private static List<Path> scanScreenshots() {
        Path dir = screenshotsDir;
        if (dir == null || !Files.isDirectory(dir)) return List.of();

        try (Stream<Path> stream = Files.list(dir)) {
            return stream
                    .filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".png"))
                    .sorted(Comparator
                            .comparingLong(BugImageClient::lastModified)
                            .reversed()
                            .thenComparing(path -> path.getFileName().toString(), Comparator.reverseOrder()))
                    .limit(MAX_LIST)
                    .collect(Collectors.toCollection(ArrayList::new));
        } catch (IOException e) {
            return List.of();
        }
    }

    private static long lastModified(Path path) {
        try {
            return Files.getLastModifiedTime(path).toMillis();
        } catch (IOException e) {
            return 0L;
        }
    }

    private static String fileName(Path file) {
        String name = file.getFileName().toString();
        return name.length() > 48 ? name.substring(0, 45) + "…" : name;
    }

    private static boolean isHttpUrl(String value) {
        if (value == null || value.isEmpty()) return false;
        try {
            URI uri = URI.create(value);
            String scheme = uri.getScheme();
            return scheme != null && (scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"));
        } catch (Exception e) {
            return false;
        }
    }

    /** Skaliert auf max. 1920 px (längste Kante) und kodiert immer neu als JPEG (Metadaten weg). */
    private static byte[] downscaleToJpeg(byte[] input) throws IOException {
        BufferedImage source = ImageIO.read(new ByteArrayInputStream(input));
        if (source == null) throw new IOException("Kein lesbares Bild");

        int width = source.getWidth();
        int height = source.getHeight();
        double scale = Math.min(1.0, (double) MAX_EDGE / Math.max(width, height));
        int targetWidth = Math.max(1, (int) Math.round(width * scale));
        int targetHeight = Math.max(1, (int) Math.round(height * scale));

        BufferedImage rgb = new BufferedImage(targetWidth, targetHeight, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = rgb.createGraphics();
        try {
            graphics.setColor(Color.WHITE);
            graphics.fillRect(0, 0, targetWidth, targetHeight);
            graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            graphics.drawImage(source, 0, 0, targetWidth, targetHeight, null);
        } finally {
            graphics.dispose();
        }

        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        ImageWriteParam param = writer.getDefaultWriteParam();
        param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
        param.setCompressionQuality(JPEG_QUALITY);

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ImageOutputStream imageOut = ImageIO.createImageOutputStream(out)) {
            writer.setOutput(imageOut);
            writer.write(null, new IIOImage(rgb, null, null), param);
        } finally {
            writer.dispose();
        }
        return out.toByteArray();
    }

    private static final class CachedList {
        final List<Path> files;
        final long createdAt;

        CachedList(List<Path> files, long createdAt) {
            this.files = files;
            this.createdAt = createdAt;
        }
    }
}
