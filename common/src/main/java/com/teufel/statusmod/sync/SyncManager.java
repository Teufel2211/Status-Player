package com.teufel.statusmod.sync;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.storage.ModConfig;
import com.teufel.statusmod.storage.PlayerSettings;
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
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

public final class SyncManager {
    private static final long SYNC_INTERVAL_MS = 30_000L;
    private static final long PULL_INTERVAL_MS = 15_000L;
    private static final long LOOP_TICK_MS = 2_000L;
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
        if (!started.compareAndSet(false, true)) return;
        Thread thread = new Thread(SyncManager::loop, "statusmod-sync");
        thread.setDaemon(true);
        thread.start();
        System.out.println("[StatusMod] Sync enabled. Push interval: " + (SYNC_INTERVAL_MS / 1000) + "s");
    }

    public static void retryStart() {
        if (started.get()) return;
        start();
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
                started.set(false);
                return;
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
                }
            }
            if (pushDirty || (now - lastPush) >= SYNC_INTERVAL_MS) {
                pushDirty = false;
                lastPush = now;
                try {
                    push();
                } catch (Exception e) {
                    lastPushInfo = "ex: " + e.getMessage();
                    System.out.println("[StatusMod] Sync push failed: " + e.getMessage());
                }
            }
        }
    }

    private static void push() {
        ModConfig config = StatusMod.getConfig();
        if (config == null || StatusMod.storage == null) return;
        // Kill-Switch: keine Schreibvorgaenge, solange der Fleet-Owner den
        // Server deaktiviert hat. Der Pull laeuft weiter (Flag-Erkennung).
        if (StatusMod.isRemoteDisabled()) {
            lastPushInfo = "disabled";
            return;
        }
        String dashboardUrl = CodeGenerator.trimTrailingSlash(config.effectiveDashboardUrl());
        if (!CodeGenerator.isSecureHttpUrl(dashboardUrl)) return;
        if (!isValidUuid(config.serverId)) return;
        String endpoint = dashboardUrl + "/api/players/" + config.serverId + "/sync";
        String apiKey = config.apiKey;

        JsonObject payload = new JsonObject();

        JsonArray players = new JsonArray();
        Map<String, PlayerSettings> snapshot = StatusMod.storage.getAllSnapshot();
        int count = 0;
        for (Map.Entry<String, PlayerSettings> e : snapshot.entrySet()) {
            if (count >= MAX_PLAYERS_PER_PUSH) break;
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
            players.add(entry);
            count++;
        }
        payload.add("players", players);

        JsonArray muted = new JsonArray();
        Map<String, Long> mutedAll = StatusMod.mutedPlayers == null
                ? new HashMap<>() : StatusMod.mutedPlayers.getAllMuted();
        Set<String> pushedMuted = new java.util.HashSet<>(mutedAll.keySet());
        for (Map.Entry<String, Long> e : mutedAll.entrySet()) {
            JsonObject m = new JsonObject();
            m.addProperty("uuid", e.getKey());
            m.addProperty("muted_until", e.getValue());
            muted.add(m);
        }
        // Ingame-Unmute: Mutes, die im letzten erfolgreichen Push noch aktiv
        // waren, jetzt aber lokal fehlen, als Loeschmarker mitsenden. Sonst
        // bleibt die DB-Zeile stehen und der naechste Pull muted wieder.
        Set<String> mutedDeletes = new java.util.HashSet<>(lastPushedMuted);
        mutedDeletes.removeAll(pushedMuted);
        for (String uuid : mutedDeletes) {
            JsonObject m = new JsonObject();
            m.addProperty("uuid", uuid);
            m.addProperty("muted_until", 0L);
            muted.add(m);
        }
        payload.add("muted", muted);

        JsonArray blocked = new JsonArray();
        Map<String, com.teufel.statusmod.storage.BlockedPlayers.BlockEntry> blockedAll =
                StatusMod.blockedPlayers == null
                ? java.util.Collections.emptyMap() : StatusMod.blockedPlayers.getActiveEntries();
        Set<String> pushedBlocked = new java.util.HashSet<>(blockedAll.keySet());
        for (Map.Entry<String, com.teufel.statusmod.storage.BlockedPlayers.BlockEntry> e : blockedAll.entrySet()) {
            JsonObject b = new JsonObject();
            b.addProperty("uuid", e.getKey());
            b.addProperty("expires_at", e.getValue() == null ? 0L : Math.max(0L, e.getValue().until));
            blocked.add(b);
        }
        // Ingame-Unblock/abgelaufener Ignore: Zeile im Dashboard ebenfalls
        // entfernen (active=false), sonst blockiert der naechste Pull erneut.
        Set<String> blockedDeletes = new java.util.HashSet<>(lastPushedBlocked);
        blockedDeletes.removeAll(pushedBlocked);
        for (String uuid : blockedDeletes) {
            JsonObject b = new JsonObject();
            b.addProperty("uuid", uuid);
            b.addProperty("active", false);
            blocked.add(b);
        }
        payload.add("blocked", blocked);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(endpoint))
                .timeout(Duration.ofSeconds(20))
                .header("Content-Type", "application/json")
                .header("x-api-key", apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(payload.toString()))
                .build();

        try {
            HttpResponse<java.io.InputStream> response =
                HTTP_CLIENT.send(request, HttpResponse.BodyHandlers.ofInputStream());
            int code;
            try (java.io.InputStream in = response.body()) {
                code = response.statusCode();
            }
            if (code < 200 || code >= 300) {
                lastPushInfo = "HTTP " + code;
                System.out.println("[StatusMod] Sync push status " + code);
            } else {
                lastPushInfo = "ok";
                // Snapshot des uebertragenen Stands merken (nicht den aktuellen
                // Zustand: eine Aenderung waehrend des HTTP-Calls muss beim
                // naechsten Push als Diff/Tombstone erkannt werden).
                lastPushedMuted.clear();
                lastPushedMuted.addAll(pushedMuted);
                lastPushedBlocked.clear();
                lastPushedBlocked.addAll(pushedBlocked);
            }
        } catch (java.io.IOException | InterruptedException e) {
            lastPushInfo = "ex: " + e.getMessage();
            System.out.println("[StatusMod] Sync push exception: " + e.getMessage());
        }
    }

    private static void pull() {
        ModConfig config = StatusMod.getConfig();
        if (config == null || StatusMod.mutedPlayers == null || StatusMod.blockedPlayers == null) return;
        String dashboardUrl = CodeGenerator.trimTrailingSlash(config.effectiveDashboardUrl());
        if (!CodeGenerator.isSecureHttpUrl(dashboardUrl)) {
            System.out.println("[StatusMod] Sync pull skipped: dashboardUrl must use HTTPS (or localhost for dev)");
            return;
        }
        if (!isValidUuid(config.serverId)) return;
        String since = config.lastSyncAtMs > 0L ? "?since=" + java.time.Instant.ofEpochMilli(config.lastSyncAtMs) : "";
        String endpoint = dashboardUrl + "/api/players/" + config.serverId + "/sync" + since;

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(endpoint))
                .timeout(Duration.ofSeconds(20))
                .header("x-api-key", config.apiKey)
                .GET()
                .build();

        String body;
        try {
            HttpResponse<java.io.InputStream> response =
                HTTP_CLIENT.send(request, HttpResponse.BodyHandlers.ofInputStream());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                lastPullInfo = "HTTP " + response.statusCode();
                try { response.body().close(); } catch (Exception ignored) {}
                return;
            }
            try (java.io.InputStream in = response.body()) {
                body = CodeGenerator.readCapped(in, CodeGenerator.MAX_BODY_BYTES);
            }
        } catch (java.io.IOException | InterruptedException e) {
            lastPullInfo = "ex: " + e.getMessage();
            System.out.println("[StatusMod] Sync pull exception: " + e.getMessage());
            return;
        }
        lastPullInfo = "ok";

        JsonObject json;
        try {
            json = JsonParser.parseString(body).getAsJsonObject();
        } catch (Exception e) {
            System.out.println("[StatusMod] Sync pull: invalid JSON response");
            return;
        }

        // Kill-Switch zuerst auswerten: die Antwort darf bei deaktiviertem
        // Mod nur mod_enabled + server_time enthalten. Fehlt das Flag (alte
        // Dashboard-Version), bleibt der Mod aktiv.
        boolean remoteEnabled = true;
        if (json.has("mod_enabled") && json.get("mod_enabled").isJsonPrimitive()
                && json.get("mod_enabled").getAsJsonPrimitive().isBoolean()) {
            remoteEnabled = json.get("mod_enabled").getAsBoolean();
        }
        applyRemoteEnabled(remoteEnabled);
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
    private static void applyRemoteEnabled(boolean enabled) {
        boolean disabled = !enabled;
        if (StatusMod.isRemoteDisabled() == disabled) return;
        StatusMod.setRemoteDisabled(disabled);
        MinecraftServer server = serverRef;
        if (server != null) {
            server.execute(() ->
                com.teufel.statusmod.lifecycle.StatusLifecycle.onRemoteStateChanged(server, enabled));
        }
        System.out.println(disabled
            ? "[StatusMod] Remote kill switch active: StatusMod disabled by dashboard."
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
