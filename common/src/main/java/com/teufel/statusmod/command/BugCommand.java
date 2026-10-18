package com.teufel.statusmod.command;

import com.google.gson.JsonObject;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.platform.PlatformServices;
import com.teufel.statusmod.storage.ModConfig;
import com.teufel.statusmod.util.CodeGenerator;
import com.teufel.statusmod.util.CommandUtil;
import net.minecraft.SharedConstants;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * /bug &lt;Beschreibung&gt; - Spieler melden Bugs direkt im Spiel. Der Report geht
 * mit Kontext (Mod-/MC-Version, Loader, Server-ID, Spieler) an das Dashboard,
 * das ihn im Bug-Posteingang der Server-Admins speichert.
 * Ohne eingerichtetes Dashboard gibt es eine klare Fehlermeldung, kein Log.
 * Der Beschreibungstext wird nie in Server-Logs geschrieben.
 */
public final class BugCommand {
    private static final int MIN_LENGTH = 10;
    private static final int MAX_LENGTH = 1500;
    private static final long COOLDOWN_MS = 10 * 60 * 1000L;
    private static final HttpClient HTTP_CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .version(HttpClient.Version.HTTP_1_1)
            .build();
    /** Letzte Meldung je Spieler (In-Memory-Cooldown; Server-Neustart setzt zurück). */
    private static final Map<UUID, Long> lastReportAt = new HashMap<>();

    private BugCommand() {}

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("bug")
                .executes(ctx -> {
                    ctx.getSource().sendFailure(Component.literal("Nutze: /bug <Beschreibung> — was ist passiert?"));
                    return 0;
                })
                .then(Commands.argument("text", StringArgumentType.greedyString())
                        .executes(ctx -> {
                            handleReport(ctx.getSource(), StringArgumentType.getString(ctx, "text"));
                            return 1;
                        })));
    }

    private static void handleReport(CommandSourceStack src, String rawText) {
        try {
            ServerPlayer player = src.getPlayer();
            if (player == null) {
                src.sendFailure(Component.literal("Dieser Befehl kann nur im Spiel benutzt werden."));
                return;
            }
            ModConfig config = StatusMod.getConfig();
            if (config == null) {
                src.sendFailure(Component.literal("[StatusMod] Keine Konfiguration geladen."));
                return;
            }
            if (!config.isEnabled("bug")) {
                src.sendFailure(Component.literal("Bug-Meldungen sind auf diesem Server deaktiviert."));
                return;
            }
            String text = rawText == null ? "" : rawText.trim();
            if (text.length() < MIN_LENGTH) {
                src.sendFailure(Component.literal("Bitte beschreibe den Bug genauer (mindestens " + MIN_LENGTH + " Zeichen)."));
                return;
            }
            if (text.length() > MAX_LENGTH) {
                text = text.substring(0, MAX_LENGTH);
            }
            if (config.serverId == null || config.serverId.trim().isEmpty()
                    || config.apiKey == null || config.apiKey.trim().isEmpty()) {
                src.sendFailure(Component.literal("Bug-Meldungen sind nicht eingerichtet (Server zuerst mit dem Dashboard verbinden)."));
                return;
            }
            String dashboardUrl = config.effectiveDashboardUrl();
            if (dashboardUrl == null || dashboardUrl.trim().isEmpty() || !CodeGenerator.isSecureHttpUrl(dashboardUrl)) {
                src.sendFailure(Component.literal("Bug-Meldungen sind nicht eingerichtet (dashboardUrl muss HTTPS sein)."));
                return;
            }
            long remaining = cooldownRemainingMs(player.getUUID());
            if (remaining > 0L) {
                src.sendFailure(Component.literal("Du hast gerade erst gemeldet — nächste Meldung in ca. " + ((remaining + 59_999L) / 60_000L) + " Minute(n)."));
                return;
            }

            final String baseUrl = CodeGenerator.trimTrailingSlash(dashboardUrl);
            final String apiKey = config.apiKey;
            final String serverId = config.serverId;
            final String playerName = player.getScoreboardName();
            final String playerUuid = player.getUUID().toString();
            final String reportText = text;
            MinecraftServer server = src.getServer();

            CommandUtil.sendSuccess(src, Component.literal("Bug-Meldung wird gesendet..."), false);

            Thread thread = new Thread(() -> {
                int status = send(baseUrl, apiKey, serverId, playerUuid, playerName, reportText);
                server.execute(() -> deliver(player, status));
            }, "statusmod-bug");
            thread.setDaemon(true);
            thread.start();
        } catch (Exception e) {
            try { src.sendFailure(Component.literal("Fehler beim Senden der Bug-Meldung.")); } catch (Exception ignored) {}
            e.printStackTrace();
        }
    }

    private static void deliver(ServerPlayer player, int status) {
        try {
            if (player.isRemoved()) return;
            if (status >= 200 && status < 300) {
                synchronized (lastReportAt) {
                    lastReportAt.put(player.getUUID(), System.currentTimeMillis());
                }
                player.sendSystemMessage(Component.literal("§aDanke! Deine Bug-Meldung ist angekommen."));
            } else if (status == 401 || status == 403) {
                player.sendSystemMessage(Component.literal("§cBug-Meldung fehlgeschlagen (Auth-Fehler). Prüfe den apiKey in config/statusmod/config.json."));
            } else if (status == 429) {
                player.sendSystemMessage(Component.literal("§cZu viele Bug-Meldungen. Warte ein paar Minuten und versuche es erneut."));
            } else if (status == 503) {
                player.sendSystemMessage(Component.literal("§cBug-Meldungen sind auf diesem Server noch nicht eingerichtet."));
            } else if (status < 0) {
                player.sendSystemMessage(Component.literal("§cBug-Meldung fehlgeschlagen (keine Verbindung zum Dashboard)."));
            } else {
                player.sendSystemMessage(Component.literal("§cBug-Meldung fehlgeschlagen (HTTP " + status + ")."));
            }
        } catch (Exception ignored) {}
    }

    private static int send(String dashboardUrl, String apiKey, String serverId, String playerUuid, String playerName, String text) {
        try {
            JsonObject payload = new JsonObject();
            payload.addProperty("server_id", serverId);
            payload.addProperty("uuid", playerUuid);
            payload.addProperty("player", playerName);
            payload.addProperty("text", text);
            payload.addProperty("mod_version", StatusMod.VERSION);
            payload.addProperty("mc_version", detectMcVersion());
            payload.addProperty("loader", detectLoader());

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(dashboardUrl + "/api/bug-report"))
                    .timeout(Duration.ofSeconds(20))
                    .header("Content-Type", "application/json")
                    .header("x-api-key", apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(payload.toString()))
                    .build();

            HttpResponse<Void> response = HTTP_CLIENT.send(request, HttpResponse.BodyHandlers.discarding());
            return response.statusCode();
        } catch (Exception e) {
            return -1;
        }
    }

    private static String detectMcVersion() {
        try {
            String name = SharedConstants.getCurrentVersion().name();
            return name == null || name.isEmpty() ? "unknown" : name;
        } catch (Throwable t) {
            return "unknown";
        }
    }

    private static String detectLoader() {
        try {
            Class.forName("org.quiltmc.loader.api.QuiltLoader", false, BugCommand.class.getClassLoader());
            return "quilt";
        } catch (Throwable ignored) {}
        try {
            String name = PlatformServices.getPlatform().getName();
            return name == null || name.isEmpty() ? "unknown" : name;
        } catch (Throwable ignored) {
            return "unknown";
        }
    }

    private static long cooldownRemainingMs(UUID playerUuid) {
        synchronized (lastReportAt) {
            Long last = lastReportAt.get(playerUuid);
            if (last == null) return 0L;
            return Math.max(COOLDOWN_MS - (System.currentTimeMillis() - last), 0L);
        }
    }
}
