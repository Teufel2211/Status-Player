package com.teufel.statusmod.sync;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.storage.ModConfig;
import com.teufel.statusmod.storage.PlayerSettings;
import com.teufel.statusmod.storage.SyncState;
import com.teufel.statusmod.attest.AttestResult;
import com.teufel.statusmod.util.CodeGenerator;
import com.teufel.statusmod.util.ColorMapper;
import com.teufel.statusmod.util.StatusTextUtil;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class SyncManager {
    private static final long SYNC_INTERVAL_MS = 30_000L;
    private static final long PULL_INTERVAL_MS = 15_000L;
    private static final long LOOP_TICK_MS = 2_000L;
    /** Abstand zwischen zwei Paarungsversuchen mit dem Dashboard. */
    private static final long PAIR_RETRY_MS = 60_000L;
    private static final int MAX_PLAYERS_PER_PUSH = 200;
    private static final int MAX_STATUS_LENGTH = 64;
    private static final int MAX_COLOR_LENGTH = 32;
    private static final int MAX_USERNAME_LENGTH = 16;
    private static final java.util.regex.Pattern UUID_PATTERN =
            java.util.regex.Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
    private static final Gson GSON = new Gson();
    private static final HttpClient HTTP_CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .version(HttpClient.Version.HTTP_1_1)
            .build();
    private static final java.util.concurrent.atomic.AtomicBoolean started = new java.util.concurrent.atomic.AtomicBoolean(false);
    /** Backoff-Deckel und Wartezeit nach Fehlern, die nur ein Admin beheben kann. */
    private static final long MAX_BACKOFF_MS = 300_000L;
    private static final long STOP_RETRY_MS = 15 * 60_000L;
    private static final long MAX_RETRY_AFTER_MS = 300_000L;
    /** Persistenter Sync-Zustand (Offline-Puffer-Merker). */
    private static volatile SyncState state = new SyncState();
    /** Nach Start/Paarung einmal den kompletten Stand hochladen. */
    private static volatile boolean forceFullPush = true;
    /** Grund, warum der Sync pausiert (attest/unauthorized/not_found); null = laeuft. */
    private static volatile String stopReason = null;
    /** Attest-Header (nur bei verifiziertem Build gesetzt). */
    private static volatile String attestHeader = null;
    private static volatile String attestSigHeader = null;
    private static volatile String attestBuildId = null;
    /** Aktueller Sync-Thread; nur setzen/loeschen, wenn man ihn besitzt. */
    private static volatile Thread threadRef = null;
    /** Dashboard hat den Sync-Code abgelehnt (403) -> neu paaren. */
    private static volatile boolean codeRejected = false;
    private static volatile boolean pushDirty = false;
    public static volatile String lastPushInfo = "-";
    public static volatile String lastPullInfo = "-";
    private static volatile Map<String, String> onlineNames = new HashMap<>();
    private static volatile MinecraftServer serverRef = null;
    // UUIDs des letzten erfolgreichen Pushs: nur diese darf der Pull bei
    // Fehlen im Dashboard-Report lokal entfernen. Schuetzt frische lokale
    // Aktionen (noch nicht gepusht) vor sofortigem Zurücksetzen.
    // Nur Sync-Thread nutzt sie (kein Lock noetig).
    private static final java.util.Set<String> lastPushedMuted = new java.util.HashSet<>();
    private static final java.util.Set<String> lastPushedBlocked = new java.util.HashSet<>();

    /** Marks local state changed: next loop iteration pushes immediately (<=2s). */
    public static void requestPush() {
        pushDirty = true;
    }

    private SyncManager() {}

    public static void updateOnlineNames(MinecraftServer server) {
        serverRef = server;
        if (server == null) return;
        try {
            Map<String, String> names = new HashMap<>();
            for (ServerPlayer p : server.getPlayerList().getPlayers()) {
                names.put(p.getUUID().toString(), p.getScoreboardName());
            }
            onlineNames = names;
        } catch (Exception ignored) {}
    }

    public static void start() {
        ModConfig config = StatusMod.getConfig();
        if (config == null) return;
        if (!config.isEnabled("sync")) return;
        if (config.effectiveDashboardUrl().isEmpty()) return;
        if (config.serverId == null || config.serverId.isEmpty()) return;
        if (config.apiKey == null || config.apiKey.isEmpty()) return;
        boolean needsCode = config.syncCode == null || config.syncCode.isEmpty();
        if (!started.compareAndSet(false, true)) return;
        codeRejected = false;
        stopReason = null;
        forceFullPush = true;
        state = SyncState.load();
        initAttestHeaders();
        if (state.pendingSince != 0L) {
            System.out.println("[StatusMod] Sync: unsent changes from a previous session will be uploaded");
        }
        Thread thread = new Thread(needsCode ? SyncManager::bootstrap : SyncManager::loop,
                needsCode ? "statusmod-sync-bootstrap" : "statusmod-sync");
        thread.setDaemon(true);
        threadRef = thread;
        thread.start();
        if (!needsCode) {
            System.out.println("[StatusMod] Sync enabled. Push interval: " + (SYNC_INTERVAL_MS / 1000) + "s");
        }
    }

    /**
     * Ohne Code: Paarung mit dem Dashboard (Pull ohne x-sync-code). Das
     * Dashboard stellt dabei einen Code aus und liefert ihn als
     * `sync_code_setup` mit; der Mod uebernimmt ihn selbst. Schlaegt das fehl
     * (Dashboard nicht erreichbar, alter Stand), wird es in festen Abstaenden
     * erneut versucht - ohne Admin-Eingriff.
     */
    private static void bootstrap() {
        if (!pair()) {
            exitLoop();
            return;
        }
        loop();
    }

    /**
     * Handelt den Sync-Code mit dem Dashboard aus, bis einer uebernommen wurde.
     * Laeuft, bis der Thread gestoppt wird oder ein Code vorliegt.
     */
    private static boolean pair() {
        while (true) {
            if (Thread.currentThread() != threadRef) return false;
            ModConfig before = StatusMod.getConfig();
            if (before == null) return false;
            try {
                pull(true);
            } catch (Exception e) {
                lastPullInfo = "ex: " + e.getMessage();
            }
            if (Thread.currentThread() != threadRef) return false;
            ModConfig after = StatusMod.getConfig();
            if (after != null && after.syncCode != null && !after.syncCode.isEmpty()) return true;
            try {
                Thread.sleep(PAIR_RETRY_MS);
            } catch (InterruptedException e) {
                return false;
            }
        }
    }

    /**
     * Dashboard hat den Code abgelehnt (403), z. B. weil die Server-Daten
     * zurueckgesetzt wurden. Der lokale Code wird verworfen und die Paarung
     * automatisch neu ausgehandelt - kein Admin-Eingriff noetig.
     */
    private static boolean repair() {
        codeRejected = false;
        ModConfig cfg = StatusMod.getConfig();
        if (cfg != null && cfg.syncCode != null && !cfg.syncCode.isEmpty()) {
            cfg.syncCode = "";
            cfg.save();
        }
        System.out.println("[StatusMod] Sync pairing lost, re-pairing automatically");
        if (!pair()) return false;
        System.out.println("[StatusMod] Sync pairing restored");
        stopReason = null;
        forceFullPush = true;
        return true;
    }

    /**
     * Baut die Attest-Header einmalig auf. Ohne verifiziertes Attest (Dev-Build)
     * bleiben sie leer; das Dashboard entscheidet dann ueber 403 attest_required.
     */
    private static void initAttestHeaders() {
        AttestResult attest = StatusMod.attestation;
        if (attest == null) return;
        if (!attest.isVerified()) {
            System.out.println("[StatusMod] Attest: " + attest.describe()
                    + " - dashboard sync needs a verified release build");
            return;
        }
        attestHeader = attest.headerValue();
        attestSigHeader = attest.signatureValue();
        attestBuildId = attest.buildId;
    }

    /** Exponentielles Backoff mit Jitter, gedeckelt auf {@link #MAX_BACKOFF_MS}. */
    private static long backoffMs() {
        int shift = Math.min(state.consecutiveFailures, 4);
        long delay = Math.min(MAX_BACKOFF_MS, SYNC_INTERVAL_MS << shift);
        double jitter = 0.8d + (Math.random() * 0.4d);
        return (long) (delay * jitter);
    }

    /**
     * Netz-/Serverfehler: Puffer bleibt lokal, naechster Versuch nach Backoff.
     * Es wird nie etwas geloescht.
     */
    private static void onSyncFailure(String reason, long retryMs) {
        long now = System.currentTimeMillis();
        state.recordFailure(now, reason, now + retryMs);
        state.save();
        long seconds = Math.max(1L, retryMs / 1000L);
        if (state.consecutiveFailures == 1) {
            System.out.println("[StatusMod] Sync offline, buffering locally (attempt 1, retry in "
                    + seconds + "s)");
        } else {
            System.out.println("[StatusMod] Sync still offline (attempt "
                    + state.consecutiveFailures + ", retry in " + seconds + "s)");
        }
    }

    /**
     * Zustand, den nur ein Admin beheben kann: Sync pausiert und versucht es
     * spaeter erneut, statt in einer 403-Schleife zu paaren.
     */
    private static void stopSync(String reason, String message) {
        long now = System.currentTimeMillis();
        state.recordFailure(now, reason, now + STOP_RETRY_MS);
        state.save();
        if (!reason.equals(stopReason)) {
            System.out.println("[StatusMod] Sync stopped: " + message);
        }
        stopReason = reason;
    }

    /** Liest {@code {"error":"..."}} aus einer Fehlerantwort. */
    private static String errorCode(String body) {
        try {
            JsonObject json = JsonParser.parseString(body).getAsJsonObject();
            if (json.has("error") && json.get("error").isJsonPrimitive()) {
                return json.get("error").getAsString();
            }
        } catch (Exception ignored) {}
        return "";
    }

    /**
     * Einheitliche Behandlung von Nicht-2xx-Antworten.
     *
     * @return true, wenn die Anfrage erfolgreich war
     */
    private static boolean handleFailure(int code, String body, HttpResponse<?> response, String op) {
        String info = "push".equals(op) ? "push" : "pull";
        if (code >= 200 && code < 300) return true;

        if (code == 403) {
            String error = errorCode(body);
            if (error.startsWith("attest")) {
                stopSync("attest", error
                        + " - update the mod or enable dev builds in the dashboard");
                if ("push".equals(info)) lastPushInfo = "attest";
                else lastPullInfo = "attest";
                return false;
            }
            onCodeRejected(info);
            return false;
        }
        if (code == 401) {
            stopSync("unauthorized", "API key rejected (401)");
            if ("push".equals(info)) lastPushInfo = "401";
            else lastPullInfo = "401";
            return false;
        }
        if (code == 404) {
            stopSync("not_found", "server not found in dashboard (404)");
            if ("push".equals(info)) lastPushInfo = "404";
            else lastPullInfo = "404";
            return false;
        }
        if (code == 429) {
            long retry = 60_000L;
            try {
                String header = response.headers().firstValue("Retry-After").orElse("");
                if (!header.isEmpty()) {
                    retry = Math.min(MAX_RETRY_AFTER_MS, Long.parseLong(header.trim()) * 1000L);
                }
            } catch (Exception ignored) {}
            onSyncFailure("rate_limited", Math.max(30_000L, retry));
            if ("push".equals(info)) lastPushInfo = "429";
            else lastPullInfo = "429";
            return false;
        }

        onSyncFailure("http_" + code, backoffMs());
        if ("push".equals(info)) lastPushInfo = "HTTP " + code;
        else lastPullInfo = "HTTP " + code;
        return false;
    }

    /** "4m12s" / "38s" - nur fuer Logzeilen. */
    private static String formatDuration(long ms) {
        long seconds = Math.max(0L, ms / 1000L);
        if (seconds < 60L) return seconds + "s";
        long minutes = seconds / 60L;
        long rest = seconds % 60L;
        if (minutes < 60L) return minutes + "m" + rest + "s";
        return (minutes / 60L) + "h" + (minutes % 60L) + "m";
    }

    public static void retryStart() {
        if (started.get()) return;
        start();
    }

    /**
     * Beendet den Loop nur, wenn der aufrufende Thread noch der aktuelle ist.
     * Sonst wuerde ein alter Thread den Zustand eines neuen ueberschreiben.
     */
    private static void exitLoop() {
        if (Thread.currentThread() == threadRef) {
            threadRef = null;
            started.set(false);
        }
    }

    private static void loop() {
        long lastPush = 0L;
        long lastPull = 0L;
        while (true) {
            try {
                Thread.sleep(LOOP_TICK_MS);
            } catch (InterruptedException e) {
                return;
            }
            long now = System.currentTimeMillis();
            // Feature-Toggle live beachten (kein Restart noetig).
            ModConfig loopCfg = StatusMod.getConfig();
            if (loopCfg == null || !loopCfg.isEnabled("sync")) {
                exitLoop();
                return;
            }
            // Code fehlt (z. B. von Hand aus der config entfernt): neu paaren.
            if (loopCfg.syncCode == null || loopCfg.syncCode.isEmpty()) {
                if (!repair()) {
                    exitLoop();
                    return;
                }
                continue;
            }
            // Backoff/Pause: nach einem Fehler (oder einem Stopp-Grund, der nur
            // ein Admin beheben kann) bis nextAttemptAt gar nichts senden.
            if (state.nextAttemptAt > now) {
                continue;
            }
            // Erst pullen, dann pushen: Dashboard-Edits werden lokal angewendet,
            // bevor der naechste Push den (dann konsistenten) Stand hochlaedt.
            if ((now - lastPull) >= PULL_INTERVAL_MS) {
                lastPull = now;
                try {
                    pull();
                } catch (Exception e) {
                    lastPullInfo = "ex: " + e.getMessage();
                    System.out.println("[StatusMod] Sync pull failed: " + e.getMessage());
                    onSyncFailure("network", backoffMs());
                    continue;
                }
            }
            if (codeRejected && !repair()) {
                exitLoop();
                return;
            }
            // Nach einem Ausfall oder Stopp immer erst den vollen Stand senden.
            boolean full = forceFullPush || state.pendingSince != 0L;
            if (!pushDirty && !full && (now - lastPush) < SYNC_INTERVAL_MS) continue;

            lastPush = now;
            Boolean ok;
            try {
                ok = push();
            } catch (Exception e) {
                lastPushInfo = "ex: " + e.getMessage();
                System.out.println("[StatusMod] Sync push failed: " + e.getMessage());
                onSyncFailure("network", backoffMs());
                ok = Boolean.FALSE;
            }
            if (ok == null) {
                // Nichts zu tun (Kill-Switch, unvollstaendige Config): Zustand
                // unveraendert lassen, kein kuenstlicher Ausfall.
                continue;
            }
            if (ok) {
                long restoreAt = System.currentTimeMillis();
                long outage = state.lastOutageMs(restoreAt);
                pushDirty = false;
                forceFullPush = false;
                stopReason = null;
                state.recordSuccess(restoreAt);
                state.lastAttestBuildId = attestBuildId;
                state.save();
                if (outage > 0L) {
                    System.out.println("[StatusMod] Sync restored after " + formatDuration(outage));
                }
            } else {
                // Aenderung bleibt offen, naechster Versuch laut Backoff.
                pushDirty = true;
            }
            if (codeRejected && !repair()) {
                exitLoop();
                return;
            }
        }
    }

    /**
     * Laedt den lokalen Stand hoch.
     *
     * @return {@code null} wenn nichts zu senden ist (Kill-Switch, unvollstaendige
     *         Config), sonst true bei Erfolg und false bei Fehler
     */
    private static Boolean push() {
        ModConfig config = StatusMod.getConfig();
        if (config == null || StatusMod.storage == null) return null;
        // Kill-Switch: keine Schreibvorgaenge, solange der Fleet-Owner den
        // Server deaktiviert hat. Der Pull laeuft weiter (Flag-Erkennung).
        if (StatusMod.isRemoteDisabled()) {
            lastPushInfo = "disabled";
            return null;
        }
        String dashboardUrl = CodeGenerator.trimTrailingSlash(config.effectiveDashboardUrl());
        if (!CodeGenerator.isSecureHttpUrl(dashboardUrl)) return null;
        if (!isValidUuid(config.serverId)) return null;
        String endpoint = dashboardUrl + "/api/players/" + config.serverId + "/sync";
        String apiKey = config.apiKey;
        String syncCode = config.syncCode == null ? "" : config.syncCode.trim();
        if (syncCode.isEmpty()) return null;

        List<JsonObject> playerEntries = new ArrayList<>();
        Map<String, PlayerSettings> snapshot = StatusMod.storage.getAllSnapshot();
        for (Map.Entry<String, PlayerSettings> e : snapshot.entrySet()) {
            String uuid = e.getKey();
            PlayerSettings ps = e.getValue();
            JsonObject entry = new JsonObject();
            entry.addProperty("uuid", uuid);
            String name = onlineNames.get(uuid);
            if (name != null && !name.isEmpty()) {
                entry.addProperty("username", name);
            }
            entry.addProperty("online", onlineNames.containsKey(uuid));
            entry.addProperty("status", ps.status == null ? "" : ps.status);
            entry.addProperty("color", ps.color == null ? "reset" : ps.color);
            long statusExpiresAt = ps.statusExpiresAtMs > System.currentTimeMillis() ? ps.statusExpiresAtMs : 0L;
            entry.addProperty("status_expires_at", statusExpiresAt);

            JsonObject settings = new JsonObject();
            settings.addProperty("brackets", ps.brackets);
            settings.addProperty("beforeName", ps.beforeName);
            settings.addProperty("avatar", ps.avatar == null ? "" : ps.avatar);
            if (ps.fontStyle != null) settings.addProperty("fontStyle", ps.fontStyle);
            if (ps.statusWords > 0) settings.addProperty("statusWords", ps.statusWords);
            if (ps.statusByWorld != null) settings.add("statusByWorld", GSON.toJsonTree(ps.statusByWorld));
            if (ps.colorByWorld != null) settings.add("colorByWorld", GSON.toJsonTree(ps.colorByWorld));

            ModConfig.StaffBadge badge = config.staffBadges == null ? null : config.staffBadges.get(uuid);
            if (badge != null) {
                JsonObject b = new JsonObject();
                b.addProperty("text", badge.text);
                b.addProperty("color", badge.color);
                b.addProperty("brackets", badge.brackets);
                settings.add("badge", b);
            }
            entry.add("settings", settings);
            playerEntries.add(entry);
        }

        Map<String, Long> mutedAll = StatusMod.mutedPlayers == null
                ? new HashMap<>() : StatusMod.mutedPlayers.getAllMuted();
        Set<String> pushedMuted = new java.util.HashSet<>(mutedAll.keySet());
        // Ingame-Unmute: Mutes, die im letzten erfolgreichen Push noch aktiv
        // waren, jetzt aber lokal fehlen, als Loeschmarker mitsenden. Sonst
        // bleibt die DB-Zeile stehen und der naechste Pull muted wieder.
        Set<String> mutedDeletes = new java.util.HashSet<>(lastPushedMuted);
        mutedDeletes.removeAll(pushedMuted);

        Map<String, com.teufel.statusmod.storage.BlockedPlayers.BlockEntry> blockedAll =
                StatusMod.blockedPlayers == null
                ? java.util.Collections.emptyMap() : StatusMod.blockedPlayers.getActiveEntries();
        Set<String> pushedBlocked = new java.util.HashSet<>(blockedAll.keySet());
        // Ingame-Unblock/abgelaufener Ignore: Zeile im Dashboard ebenfalls
        // entfernen (active=false), sonst blockiert der naechste Pull erneut.
        Set<String> blockedDeletes = new java.util.HashSet<>(lastPushedBlocked);
        blockedDeletes.removeAll(pushedBlocked);

        // Chunking: maximal 200 Eintraege pro Request (Schema-Limit im
        // Dashboard). Ein Server mit mehr Spielern laedt so auch beim
        // Nachhol-Push alles hoch, statt den Rest still zu verlieren.
        int total = playerEntries.size();
        int chunks = Math.max(1, (total + MAX_PLAYERS_PER_PUSH - 1) / MAX_PLAYERS_PER_PUSH);
        for (int chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
            int from = chunkIndex * MAX_PLAYERS_PER_PUSH;
            int to = Math.min(total, from + MAX_PLAYERS_PER_PUSH);
            List<JsonObject> chunk = playerEntries.subList(from, to);
            Set<String> chunkUuids = new java.util.HashSet<>();
            for (JsonObject entry : chunk) chunkUuids.add(entry.get("uuid").getAsString());

            JsonObject payload = new JsonObject();
            JsonArray players = new JsonArray();
            for (JsonObject entry : chunk) players.add(entry);
            payload.add("players", players);

            JsonArray muted = new JsonArray();
            for (Map.Entry<String, Long> e : mutedAll.entrySet()) {
                if (!chunkUuids.contains(e.getKey())) continue;
                JsonObject m = new JsonObject();
                m.addProperty("uuid", e.getKey());
                m.addProperty("muted_until", e.getValue());
                muted.add(m);
            }
            if (chunkIndex == 0) {
                for (String uuid : mutedDeletes) {
                    JsonObject m = new JsonObject();
                    m.addProperty("uuid", uuid);
                    m.addProperty("muted_until", 0L);
                    muted.add(m);
                }
            }
            payload.add("muted", muted);

            JsonArray blocked = new JsonArray();
            for (Map.Entry<String, com.teufel.statusmod.storage.BlockedPlayers.BlockEntry> e : blockedAll.entrySet()) {
                if (!chunkUuids.contains(e.getKey())) continue;
                JsonObject b = new JsonObject();
                b.addProperty("uuid", e.getKey());
                b.addProperty("expires_at", e.getValue() == null ? 0L : Math.max(0L, e.getValue().until));
                blocked.add(b);
            }
            if (chunkIndex == 0) {
                for (String uuid : blockedDeletes) {
                    JsonObject b = new JsonObject();
                    b.addProperty("uuid", uuid);
                    b.addProperty("active", false);
                    blocked.add(b);
                }
            }
            payload.add("blocked", blocked);

            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint))
                    .timeout(Duration.ofSeconds(20))
                    .header("Content-Type", "application/json")
                    .header("x-api-key", apiKey)
                    .header("x-sync-code", syncCode)
                    .POST(HttpRequest.BodyPublishers.ofString(payload.toString()));
            addAttestHeaders(builder);

            HttpResponse<java.io.InputStream> response;
            int code;
            String body = "";
            try {
                response = HTTP_CLIENT.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
                code = response.statusCode();
                try (java.io.InputStream in = response.body()) {
                    body = CodeGenerator.readCapped(in, CodeGenerator.MAX_BODY_BYTES);
                } catch (Exception ignored) {}
            } catch (java.io.IOException | InterruptedException e) {
                lastPushInfo = "ex: " + e.getMessage();
                onSyncFailure("network", backoffMs());
                return false;
            }

            if (!handleFailure(code, body, response, "push")) return false;
        }

        // Snapshot des uebertragenen Stands merken (nicht den aktuellen Zustand:
        // eine Aenderung waehrend des HTTP-Calls muss beim naechsten Push als
        // Diff/Tombstone erkannt werden).
        lastPushedMuted.clear();
        lastPushedMuted.addAll(pushedMuted);
        lastPushedBlocked.clear();
        lastPushedBlocked.addAll(pushedBlocked);
        lastPushInfo = "ok";
        return true;
    }

    private static void addAttestHeaders(HttpRequest.Builder builder) {
        String attest = attestHeader;
        String sig = attestSigHeader;
        if (attest != null && sig != null) {
            builder.header("x-mod-attest", attest);
            builder.header("x-mod-attest-sig", sig);
        }
    }

    private static void pull() {
        pull(false);
    }

    /**
     * @param bootstrap true = Erstkontakt/Paarung ohne Code. Ein 403 beendet
     *                  dann nicht den Loop, sondern laesst {@link #pair()}
     *                  den Code erneut anfragen.
     */
    private static void pull(boolean bootstrap) {
        ModConfig config = StatusMod.getConfig();
        if (config == null || StatusMod.mutedPlayers == null || StatusMod.blockedPlayers == null) return;
        String dashboardUrl = CodeGenerator.trimTrailingSlash(config.effectiveDashboardUrl());
        if (!CodeGenerator.isSecureHttpUrl(dashboardUrl)) {
            System.out.println("[StatusMod] Sync pull skipped: dashboardUrl must use HTTPS (or localhost for dev)");
            return;
        }
        if (!isValidUuid(config.serverId)) return;
        String syncCode = config.syncCode == null ? "" : config.syncCode.trim();
        if (syncCode.isEmpty() && !bootstrap) return;
        String since = config.lastSyncAtMs > 0L ? "?since=" + java.time.Instant.ofEpochMilli(config.lastSyncAtMs) : "";
        String endpoint = dashboardUrl + "/api/players/" + config.serverId + "/sync" + since;

        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create(endpoint))
                .timeout(Duration.ofSeconds(20))
                .header("x-api-key", config.apiKey)
                .GET();
        if (!syncCode.isEmpty()) builder.header("x-sync-code", syncCode);
        addAttestHeaders(builder);

        String body;
        HttpResponse<java.io.InputStream> response;
        int code;
        try {
            response = HTTP_CLIENT.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream());
            code = response.statusCode();
            try (java.io.InputStream in = response.body()) {
                body = CodeGenerator.readCapped(in, CodeGenerator.MAX_BODY_BYTES);
            }
        } catch (java.io.IOException | InterruptedException e) {
            lastPullInfo = "ex: " + e.getMessage();
            System.out.println("[StatusMod] Sync pull exception: " + e.getMessage());
            onSyncFailure("network", backoffMs());
            return;
        }

        // Erstpaarung: solange kein Code vorliegt, ist ein 403 die normale
        // Antwort. Nur ein Attest-Fehler ist dort schon ein Stopp-Grund.
        if (code == 403 && bootstrap && !errorCode(body).startsWith("attest")) {
            lastPullInfo = "code not confirmed";
            return;
        }
        if (!handleFailure(code, body, response, "pull")) return;
        lastPullInfo = "ok";

        JsonObject json;
        try {
            json = JsonParser.parseString(body).getAsJsonObject();
        } catch (Exception e) {
            System.out.println("[StatusMod] Sync pull: invalid JSON response");
            return;
        }

        // Paarung: das Dashboard stellt den Code aus und liefert ihn genau hier
        // aus. Nie einen bereits vorhandenen Code ueberschreiben.
        if (json.has("sync_code_setup") && json.get("sync_code_setup").isJsonPrimitive()
                && json.get("sync_code_setup").getAsJsonPrimitive().isString()) {
            adoptSyncCode(json.get("sync_code_setup").getAsString());
        }

        // Kill-Switch zuerst auswerten: die Antwort darf bei deaktiviertem
        // Mod nur mod_enabled + server_time enthalten. Fehlt das Flag (alte
        // Dashboard-Version), bleibt der Mod aktiv.
        boolean remoteEnabled = true;
        if (json.has("mod_enabled") && json.get("mod_enabled").isJsonPrimitive()
                && json.get("mod_enabled").getAsJsonPrimitive().isBoolean()) {
            remoteEnabled = json.get("mod_enabled").getAsBoolean();
        }
        String disableScope = "server";
        if (json.has("mod_disabled_scope") && json.get("mod_disabled_scope").isJsonPrimitive()
                && json.get("mod_disabled_scope").getAsJsonPrimitive().isString()) {
            disableScope = json.get("mod_disabled_scope").getAsString();
        }
        applyRemoteEnabled(remoteEnabled, disableScope);
        if (!remoteEnabled) {
            lastPullInfo = "disabled";
            return;
        }

        if (!json.has("muted") || !json.has("blocked") || !json.has("server_time")) return;

        java.util.Set<String> reportedMuted = new java.util.HashSet<>();
        for (JsonElement el : json.getAsJsonArray("muted")) {
            try {
                JsonObject m = el.getAsJsonObject();
                String uuid = m.get("uuid").getAsString();
                if (!isValidUuid(uuid)) continue;
                long until = java.time.Instant.parse(m.get("muted_until").getAsString()).toEpochMilli();
                StatusMod.mutedPlayers.muteUntil(uuid, until);
                reportedMuted.add(uuid);
            } catch (Exception ignored) {}
        }
        // Dashboard-Unmute übernehmen: Bekannte (gepushte) Mutes, die nicht
        // mehr gemeldet werden, lokal entfernen - sonst legt der nächste
        // Push sie wieder an.
        for (String uuid : new java.util.HashSet<>(lastPushedMuted)) {
            if (!reportedMuted.contains(uuid) && StatusMod.mutedPlayers != null) {
                StatusMod.mutedPlayers.unmute(uuid);
            }
        }

        java.util.Set<String> reportedBlocked = new java.util.HashSet<>();
        long nowMs = System.currentTimeMillis();
        for (JsonElement el : json.getAsJsonArray("blocked")) {
            try {
                JsonObject b = el.getAsJsonObject();
                String uuid = b.get("uuid").getAsString();
                if (!isValidUuid(uuid)) continue;
                long until = 0L;
                if (b.has("expires_at") && !b.get("expires_at").isJsonNull()) {
                    JsonElement ex = b.get("expires_at");
                    if (ex.isJsonPrimitive() && ex.getAsJsonPrimitive().isNumber()) {
                        until = ex.getAsLong();
                    } else {
                        try { until = java.time.Instant.parse(ex.getAsString()).toEpochMilli(); } catch (Exception ignored) {}
                    }
                }
                if (until > nowMs) {
                    if (!StatusMod.blockedPlayers.isBlocked(uuid)) {
                        PlayerSettings ps = StatusMod.storage == null ? null : StatusMod.storage.forPlayer(uuid);
                        String prevStatus = ps == null ? "" : ps.status;
                        String prevColor = ps == null ? "reset" : ps.color;
                        long prevExpiresAtMs = ps == null ? 0L : ps.statusExpiresAtMs;
                        String prevTimedStatus = ps == null ? "" : ps.timedPrevStatus;
                        String prevTimedColor = ps == null ? "reset" : ps.timedPrevColor;
                        StatusMod.blockedPlayers.blockTemporary(uuid, until, prevStatus, prevColor,
                                prevExpiresAtMs, prevTimedStatus, prevTimedColor);
                        if (ps != null) {
                            ps.status = "";
                            ps.color = "reset";
                            ps.statusExpiresAtMs = 0L;
                            ps.timedPrevStatus = "";
                            ps.timedPrevColor = "reset";
                            ps.lastStatusChangeAtMs = System.currentTimeMillis();
                            StatusMod.storage.put(uuid, ps);
                            applyOnline(serverRef, uuid, ps);
                        }
                    } else if (StatusMod.blockedPlayers.isTemporary(uuid)) {
                        StatusMod.blockedPlayers.blockTemporary(uuid, until, null, null);
                    }
                } else if (until <= 0L) {
                    if (!StatusMod.blockedPlayers.isBlocked(uuid)) {
                        StatusMod.blockedPlayers.block(uuid);
                        if (StatusMod.storage != null) {
                            PlayerSettings ps = StatusMod.storage.forPlayer(uuid);
                            ps.status = "";
                            ps.color = "reset";
                            ps.statusExpiresAtMs = 0L;
                            ps.timedPrevStatus = "";
                            ps.timedPrevColor = "reset";
                            ps.lastStatusChangeAtMs = System.currentTimeMillis();
                            StatusMod.storage.put(uuid, ps);
                            applyOnline(serverRef, uuid, ps);
                        }
                    }
                }
                reportedBlocked.add(uuid);
                lastPushedBlocked.add(uuid);
            } catch (Exception ignored) {}
        }
        for (String uuid : new java.util.HashSet<>(lastPushedBlocked)) {
            if (!reportedBlocked.contains(uuid) && StatusMod.blockedPlayers != null) {
                com.teufel.statusmod.storage.BlockedPlayers.BlockEntry removed = StatusMod.blockedPlayers.unblock(uuid);
                if (removed != null) {
                    ServerPlayer online = null;
                    try {
                        if (serverRef != null) online = serverRef.getPlayerList().getPlayer(java.util.UUID.fromString(uuid));
                    } catch (Exception ignored) {}
                    com.teufel.statusmod.lifecycle.StatusLifecycle.restoreBlockedEntry(uuid, online, removed, false);
                }
                lastPushedBlocked.remove(uuid);
            }
        }

        if (json.has("warnings") && json.get("warnings").isJsonArray() && StatusMod.warningStore != null) {
            Map<String, com.teufel.statusmod.storage.WarningStore.WarnInfo> warnMap = new HashMap<>();
            for (JsonElement el : json.getAsJsonArray("warnings")) {
                try {
                    JsonObject w = el.getAsJsonObject();
                    String uuid = w.get("uuid").getAsString();
                    if (!isValidUuid(uuid)) continue;
                    int level = w.has("level") ? w.get("level").getAsInt() : 0;
                    int count = w.has("count") ? w.get("count").getAsInt() : level;
                    long updated = 0L;
                    if (w.has("updated_at") && !w.get("updated_at").isJsonNull()) {
                        try { updated = java.time.Instant.parse(w.get("updated_at").getAsString()).toEpochMilli(); } catch (Exception ignored) {}
                    }
                    if (level > 0 && count > 0) {
                        warnMap.put(uuid, new com.teufel.statusmod.storage.WarningStore.WarnInfo(level, count, updated));
                    }
                } catch (Exception ignored) {}
            }
            if (StatusMod.warningStore.replaceAll(warnMap)) {
                refreshOnlineSuffixes();
            }
        }

        if (json.has("presets") && json.get("presets").isJsonArray() && StatusMod.serverPresets != null) {
            Map<String, com.teufel.statusmod.storage.ServerPresets.ServerPreset> presetMap = new HashMap<>();
            for (JsonElement el : json.getAsJsonArray("presets")) {
                try {
                    JsonObject pr = el.getAsJsonObject();
                    String name = pr.has("name") ? pr.get("name").getAsString() : "";
                    String statusText = pr.has("status") ? pr.get("status").getAsString() : "";
                    String color = pr.has("color") ? pr.get("color").getAsString() : "reset";
                    long updated = 0L;
                    if (pr.has("updated_at") && !pr.get("updated_at").isJsonNull()) {
                        try { updated = java.time.Instant.parse(pr.get("updated_at").getAsString()).toEpochMilli(); } catch (Exception ignored) {}
                    }
                    if (name != null && !name.isBlank() && statusText != null && !statusText.isEmpty()) {
                        presetMap.put(name, new com.teufel.statusmod.storage.ServerPresets.ServerPreset(statusText, color, updated));
                    }
                } catch (Exception ignored) {}
            }
            StatusMod.serverPresets.replaceAll(presetMap);
        }

        if (json.has("players") && json.get("players").isJsonArray()) {
        for (JsonElement el : json.getAsJsonArray("players")) {
            try {
                JsonObject p = el.getAsJsonObject();
                String uuid = p.has("uuid") ? p.get("uuid").getAsString() : "";
                if (!isValidUuid(uuid)) continue;
                boolean hasStatus = p.has("status") && !p.get("status").isJsonNull();
                boolean hasColor = p.has("color") && !p.get("color").isJsonNull();
                if ((!hasStatus && !hasColor) || StatusMod.storage == null) continue;
                // Avoid overwriting newer local changes with stale DB snapshot (fix instant reset)
                long dbTime = 0L;
                if (p.has("updated_at") && !p.get("updated_at").isJsonNull()) {
                    try { dbTime = java.time.Instant.parse(p.get("updated_at").getAsString()).toEpochMilli(); } catch (Exception ignored) {}
                }
                PlayerSettings ps = StatusMod.storage.forPlayer(uuid);
                if (p.has("slowmode_seconds") && !p.get("slowmode_seconds").isJsonNull() && StatusMod.slowmodeStore != null) {
                    try {
                        StatusMod.slowmodeStore.setSeconds(uuid, p.get("slowmode_seconds").getAsInt());
                    } catch (Exception ignored) {}
                }
                if (dbTime > 0L && ps.lastStatusChangeAtMs > 0L && dbTime < ps.lastStatusChangeAtMs) {
                    // DB is older than local edit -> local not yet pushed, skip to preserve unpushed change
                    continue;
                }
                boolean blocked = StatusMod.blockedPlayers != null && StatusMod.blockedPlayers.isBlocked(uuid);
                boolean changed = false;
                if (!blocked) {
                if (hasStatus) {
                    String status = StatusTextUtil.sanitizePlayerText(p.get("status").getAsString(), MAX_STATUS_LENGTH);
                    if (!status.equals(ps.status)) {
                        ps.status = status;
                        // Dashboard-Edit beendet einen laufenden Timed-Status.
                        ps.statusExpiresAtMs = 0L;
                        ps.timedPrevStatus = "";
                        ps.timedPrevColor = "reset";
                        changed = true;
                    }
                }
                if (hasColor) {
                    String rc = p.get("color").getAsString();
                    String color = (rc != null && ColorMapper.isValidColorInput(rc)
                        && rc.length() <= MAX_COLOR_LENGTH) ? rc : "reset";
                    if (!color.equals(ps.color)) { ps.color = color; changed = true; }
                }
                // Ablaufzeit aus dem Dashboard uebernehmen (Dashboard-Edit setzt
                // sie auf null und beendet damit den Timed-Status).
                if (p.has("status_expires_at")) {
                    long expires = 0L;
                    JsonElement ex = p.get("status_expires_at");
                    if (ex != null && !ex.isJsonNull()) {
                        if (ex.isJsonPrimitive() && ex.getAsJsonPrimitive().isNumber()) {
                            expires = ex.getAsLong();
                        } else {
                            try { expires = java.time.Instant.parse(ex.getAsString()).toEpochMilli(); } catch (Exception ignored) {}
                        }
                    }
                    long normalized = expires > System.currentTimeMillis() ? expires : 0L;
                    if (normalized != ps.statusExpiresAtMs) {
                        ps.statusExpiresAtMs = normalized;
                        if (normalized == 0L) {
                            ps.timedPrevStatus = "";
                            ps.timedPrevColor = "reset";
                        }
                        changed = true;
                    }
                }
                }
                if (changed) {
                    ps.lastStatusChangeAtMs = System.currentTimeMillis();
                    StatusMod.storage.put(uuid, ps);
                    applyOnline(serverRef, uuid, ps);
                }
            } catch (Exception ignored) {}
        }
        }

        try {
            long wm = java.time.Instant.parse(json.get("server_time").getAsString()).toEpochMilli();
            // Reload-merge: die Platte ist die Wahrheit (manuelle Edits, Feature-
            // Commands). Blindes Speichern des (ggf. veralteten) Memory-Objekts
            // würde fremde Änderungen still zurücksetzen.
            com.teufel.statusmod.storage.ModConfig fresh =
                com.teufel.statusmod.storage.ModConfig.load();
            fresh.lastSyncAtMs = wm;
            // In-Memory-Zustand ist die Wahrheit (gerade aus dem Pull gesetzt);
            // ein veralteter Wert auf der Platte darf ihn nicht ueberschreiben.
            fresh.remoteDisabled = StatusMod.isRemoteDisabled();
            fresh.save();
            com.teufel.statusmod.StatusMod.config = fresh;
        } catch (Exception ignored) {}
    }

    /**
     * Uebernimmt einen vom Dashboard ausgestellten Sync-Code (Paarung laeuft
     * automatisch, ohne Admin-Eingriff). Reload-Merge wie in
     * SetupManager.pollPendingKey: die Platte ist die Wahrheit, nur dieses
     * eine Feld wird gesetzt. Ein bereits vorhandener Code wird nie
     * ueberschrieben.
     */
    private static void adoptSyncCode(String code) {
        String v = code == null ? "" : code.trim();
        if (v.isEmpty() || v.length() > 64) return;
        ModConfig current = StatusMod.getConfig();
        if (current != null && current.syncCode != null && !current.syncCode.isEmpty()) return;
        try {
            ModConfig fresh = ModConfig.load();
            if (fresh.syncCode != null && !fresh.syncCode.isEmpty()) {
                StatusMod.config = fresh;
                return;
            }
            fresh.syncCode = v;
            fresh.save();
            StatusMod.config = fresh;
            System.out.println("[StatusMod] Sync code adopted from dashboard.");
        } catch (Exception e) {
            System.out.println("[StatusMod] Sync code adoption failed: " + e.getMessage());
        }
    }

    /**
     * Dashboard hat den Code abgelehnt (403). Der Loop paart sich danach
     * automatisch neu ({@link #repair()}). Der Code selbst wird nie geloggt.
     */
    private static void onCodeRejected(String op) {
        codeRejected = true;
        if ("push".equals(op)) lastPushInfo = "pairing";
        else lastPullInfo = "pairing";
    }

    private static void applyOnline(MinecraftServer server, String uuidStr, PlayerSettings ps) {
        if (server == null || uuidStr == null) return;
        try {
            java.util.UUID id = java.util.UUID.fromString(uuidStr);
            // Defensive copy: the sync thread keeps mutating ps while the
            // server thread reads it (race). Copy all display-relevant fields.
            final PlayerSettings snapshot = new PlayerSettings();
            snapshot.status = ps.status == null ? "" : ps.status;
            snapshot.color = ps.color == null ? "reset" : ps.color;
            snapshot.brackets = ps.brackets;
            snapshot.beforeName = ps.beforeName;
            snapshot.fontStyle = ps.fontStyle;
            snapshot.statusWords = ps.statusWords;
            snapshot.avatar = ps.avatar == null ? "" : ps.avatar;
            server.execute(() -> {
                try {
                    ModConfig cfg = StatusMod.getConfig();
                    if (cfg == null || !cfg.isEnabled("status")) return;
                    ServerPlayer sp = server.getPlayerList().getPlayer(id);
                    if (sp != null) {
                        com.teufel.statusmod.util.StatusTeamUtil.applyStatus(
                                server.getScoreboard(), sp, snapshot,
                                snapshot.status == null ? "" : snapshot.status,
                                snapshot.color == null ? "reset" : snapshot.color, false);
                    }
                } catch (Exception ignored) {}
            });
        } catch (Exception ignored) {}
    }

    /**
     * Wendet den vom Dashboard gemeldeten Kill-Switch an und raeumt beim
     * Ausschalten sofort alle sichtbaren Status-Anzeigen ab. Beim Einschalten
     * werden die Status der Online-Spieler direkt neu gerendert.
     */
    private static void applyRemoteEnabled(boolean enabled, String scope) {
        boolean disabled = !enabled;
        boolean stateChanged = StatusMod.isRemoteDisabled() != disabled;
        boolean scopeChanged = !StatusMod.getRemoteDisabledScope().equalsIgnoreCase(scope);
        StatusMod.setRemoteDisabled(disabled, scope);
        if (!stateChanged && !scopeChanged) return;
        MinecraftServer server = serverRef;
        if (server != null) {
            server.execute(() ->
                com.teufel.statusmod.lifecycle.StatusLifecycle.onRemoteStateChanged(server, enabled));
        }
        System.out.println(disabled
            ? "[StatusMod] Remote kill switch active: StatusMod disabled by dashboard (scope="
                + StatusMod.getRemoteDisabledScope() + ")."
            : "[StatusMod] Remote kill switch released: StatusMod enabled by dashboard.");
    }

    /** Re-renders the tab suffix for all online players (warning badge changes). */
    private static void refreshOnlineSuffixes() {
        MinecraftServer server = serverRef;
        if (server == null || StatusMod.storage == null) return;
        server.execute(() -> {
            try {
                ModConfig cfg = StatusMod.getConfig();
                if (cfg == null) return;
                if (!cfg.isEnabled("status") && !cfg.isEnabled("badge") && !cfg.isEnabled("warn")) return;
                for (ServerPlayer sp : server.getPlayerList().getPlayers()) {
                    PlayerSettings ps = StatusMod.storage.forPlayer(sp.getUUID().toString());
                    com.teufel.statusmod.util.StatusTeamUtil.applyStatus(
                            server.getScoreboard(), sp, ps,
                            ps.status == null ? "" : ps.status,
                            ps.color == null ? "reset" : ps.color,
                            com.teufel.statusmod.util.PermissionUtil.hasAdminPermission(sp));
                }
            } catch (Exception ignored) {}
        });
    }

    private static boolean isValidUuid(String s) {
        return s != null && UUID_PATTERN.matcher(s).matches();
    }
}
