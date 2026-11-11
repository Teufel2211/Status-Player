package com.teufel.statusmod.attest;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.teufel.statusmod.platform.Platform;
import com.teufel.statusmod.storage.ModConfig;
import com.teufel.statusmod.util.CodeGenerator;

import java.io.File;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;

/**
 * Release-Gate: prueft beim Start, ob die eigene Build-ID in der Registry des
 * Dashboards steht (siehe docs/superpowers/specs/2026-11-10-build-release-gate-design.md).
 *
 * <ul>
 *   <li>Cache-Treffer - diese Build-ID wurde schon einmal geprueft und war
 *       registriert. Kein Netzwerk, keine Ausgabe, 0 ms.</li>
 *   <li>HTTP 200 status=ok - registriert. Startet still, schreibt den Cache.</li>
 *   <li>HTTP 200 status=override - nur fuer genau diesen Server freigegeben.
 *       Startet still, schreibt KEINEN Cache (ein Zurueckziehen der Freigabe
 *       greift beim naechsten Neustart).</li>
 *   <li>HTTP 403 build_unknown - Start wird verweigert.</li>
 *   <li>Alles andere (Timeout, kein Netz, 5xx, 429, andere 4xx) - der Mod
 *       startet (Fail-open): ein Vercel-Ausfall darf keine Server lahmlegen.</li>
 * </ul>
 *
 * <p>Nicht angewendet wird die Pruefung bei Dev-Builds (kein verifiziertes
 * Attest), im Client/Singleplayer und auf Servern ohne Dashboard-Anbindung.</p>
 */
public final class BuildGate {

    public enum Result {
        ALLOW, ALLOW_REGISTERED, ALLOW_OVERRIDE, DENY, OPEN, SKIP
    }

    /** Ergebnis der Pruefung; reason nur bei DENY/OPEN/SKIP gesetzt. */
    public static final class Outcome {
        public final Result result;
        public final String reason;

        private Outcome(Result result, String reason) {
            this.result = result;
            this.reason = reason;
        }

        public boolean isDenied() {
            return result == Result.DENY;
        }

        public String describe() {
            switch (result) {
                case ALLOW: return "registered (cached)";
                case ALLOW_REGISTERED: return "registered";
                case ALLOW_OVERRIDE: return "manually approved for this server";
                case DENY: return "not registered (" + reason + ")";
                case OPEN: return "unchecked (" + reason + ")";
                default: return "skipped (" + reason + ")";
            }
        }
    }

    private static final String CACHE_FILE = "build-gate.txt";
    private static final int MAX_CACHE_CHARS = 256;
    private static final int MAX_BODY_BYTES = 4096;
    private static final long CONNECT_TIMEOUT_MS = 1500L;
    private static final long REQUEST_TIMEOUT_MS = 2000L;

    /** Eigener Client: bewusst nicht mit SyncManager geteilt (keine gemeinsamen Timeouts). */
    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(CONNECT_TIMEOUT_MS))
            .version(HttpClient.Version.HTTP_1_1)
            .build();

    private BuildGate() {}

    /**
     * Fuehrt die Pruefung aus und gibt das Ergebnis zurueck. Der Aufrufer
     * entscheidet ueber den Abbruch (StatusMod.init setzt refused).
     */
    public static Outcome check(ModConfig config, Platform platform) {
        AttestResult attest = Attestation.result();
        if (!attest.isVerified()) {
            return new Outcome(Result.SKIP, "no verified attest");
        }
        if (platform == null || !platform.isDedicatedServer()) {
            return new Outcome(Result.SKIP, "not a dedicated server");
        }
        if (config == null) {
            return new Outcome(Result.SKIP, "no config");
        }
        String url = CodeGenerator.trimTrailingSlash(config.effectiveDashboardUrl());
        String apiKey = config.apiKey == null ? "" : config.apiKey;
        if (url.isEmpty() || config.serverId == null || config.serverId.isEmpty() || apiKey.isEmpty()) {
            return new Outcome(Result.SKIP, "server not paired");
        }

        String buildId = attest.buildId;

        // 1) Lokaler Cache: diese Build-ID war schon einmal registriert.
        if (buildId.equals(readCache())) {
            return new Outcome(Result.ALLOW, null);
        }

        // 2) Einmalige Netzwerkpruefung (harte Obergrenze: Request-Timeout).
        try {
            HttpRequest.Builder req = HttpRequest.newBuilder()
                    .uri(URI.create(url + "/api/builds/check"))
                    .timeout(Duration.ofMillis(REQUEST_TIMEOUT_MS))
                    .header("x-mod-attest", attest.headerValue())
                    .header("x-mod-attest-sig", attest.signatureValue())
                    .header("x-api-key", apiKey)
                    .POST(HttpRequest.BodyPublishers.noBody());
            HttpResponse<InputStream> response =
                    CLIENT.send(req.build(), HttpResponse.BodyHandlers.ofInputStream());

            int status = response.statusCode();
            String body = readLimited(response.body());

            if (status == 200) {
                String state = jsonString(body, "status");
                if ("ok".equals(state)) {
                    writeCache(buildId);
                    return new Outcome(Result.ALLOW_REGISTERED, null);
                }
                if ("override".equals(state)) {
                    return new Outcome(Result.ALLOW_OVERRIDE, null);
                }
                return new Outcome(Result.OPEN, "unexpected dashboard response");
            }

            if (status == 403 && "build_unknown".equals(jsonString(body, "error"))) {
                return new Outcome(Result.DENY, "build_unknown");
            }

            return new Outcome(Result.OPEN, "http " + status);
        } catch (Exception e) {
            return new Outcome(Result.OPEN, e.getClass().getSimpleName());
        }
    }

    /** Konsolenausgabe: Erfolg bleibt stumm, nur Fehler werden gemeldet. */
    public static void report(Outcome outcome) {
        if (outcome == null) return;
        if (outcome.isDenied()) {
            System.out.println("[StatusMod] This build is not registered. Refusing to start.");
            System.out.println("[StatusMod] Reason: " + outcome.reason + " - run /modinfo for details.");
        } else if (outcome.result == Result.OPEN) {
            System.out.println("[StatusMod] Build check skipped: dashboard unreachable.");
        }
    }

    // ---------------------------------------------------------------- Cache

    private static File cacheFile() {
        return new File(new File("config/statusmod"), CACHE_FILE);
    }

    private static String readCache() {
        try {
            File f = cacheFile();
            if (!f.isFile()) return "";
            long size = f.length();
            if (size > MAX_CACHE_CHARS) return "";
            String content = Files.readString(f.toPath(), StandardCharsets.UTF_8);
            return content.trim();
        } catch (Exception e) {
            return "";
        }
    }

    /** Atomar (Temp-Datei + Move, wie ModConfig.save()) - ein Crash hinterlaesst keine halbe Datei. */
    private static void writeCache(String buildId) {
        try {
            File f = cacheFile();
            File dir = f.getParentFile();
            if (dir != null) dir.mkdirs();
            Path target = f.toPath();
            Path tmp = target.resolveSibling(target.getFileName().toString() + ".tmp");
            Files.writeString(tmp, buildId, StandardCharsets.UTF_8);
            try {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (Exception ignored) {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (Exception ignored) {
            // Ohne Cache startet der Mod beim naechsten Start mit einer neuen
            // Pruefung - kein Grund abzubrechen.
        }
    }

    // ---------------------------------------------------------------- Antwort

    private static String readLimited(InputStream in) {
        if (in == null) return "";
        try (InputStream body = in) {
            byte[] buf = body.readNBytes(MAX_BODY_BYTES);
            return new String(buf, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    private static String jsonString(String body, String key) {
        try {
            JsonObject obj = JsonParser.parseString(body).getAsJsonObject();
            if (obj.has(key) && obj.get(key).isJsonPrimitive()) return obj.get(key).getAsString();
        } catch (Exception ignored) {}
        return null;
    }
}
