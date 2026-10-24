package com.teufel.statusmod.command;

import com.google.gson.JsonObject;
import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.storage.ModConfig;
import com.teufel.statusmod.util.CodeGenerator;
import com.teufel.statusmod.util.CommandUtil;
import com.teufel.statusmod.util.PermissionUtil;
import com.mojang.brigadier.CommandDispatcher;
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

public final class CodeCommand {
    private static final int CODE_LENGTH = 8;
    private static final HttpClient HTTP_CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .version(HttpClient.Version.HTTP_1_1)
            .build();

    private CodeCommand() {}

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("code").requires(ctx -> !StatusMod.isRemoteDisabled()).executes(ctx -> {
            handleCode(ctx.getSource());
            return 1;
        }));
    }

    private static void handleCode(CommandSourceStack src) {
        if (!StatusMod.getConfig().isEnabled("code")) {
            src.sendFailure(Component.literal("Das Login-Code-Feature ist auf diesem Server deaktiviert."));
            return;
        }
        ServerPlayer player = src.getPlayer();
        if (player == null) {
            src.sendFailure(Component.literal("Dieser Befehl kann nur im Spiel benutzt werden."));
            return;
        }
        if (!PermissionUtil.hasAdminPermission(src)) {
            src.sendFailure(Component.literal("Du hast nicht genügend Rechte, um einen Login-Code zu generieren."));
            return;
        }

        ModConfig config = StatusMod.getConfig();
        if (config == null) {
            src.sendFailure(Component.literal("[StatusMod] Keine Konfiguration geladen."));
            return;
        }
        if (config.serverId == null || config.serverId.isEmpty() || config.apiKey == null || config.apiKey.isEmpty()) {
            src.sendFailure(Component.literal("Der Server ist noch nicht eingerichtet. Führe zuerst den Server-Setup mit dem Setup-Code aus der Konsole durch."));
            return;
        }
        if (config.dashboardUrl == null || config.dashboardUrl.trim().isEmpty()) {
            src.sendFailure(Component.literal("[StatusMod] dashboardUrl ist in der Konfiguration nicht gesetzt."));
            return;
        }
        String dashboardUrl = config.effectiveDashboardUrl();
        if (!CodeGenerator.isSecureHttpUrl(dashboardUrl)) {
            src.sendFailure(Component.literal("[StatusMod] dashboardUrl muss HTTPS verwenden (oder http://localhost für Entwicklung)."));
            return;
        }
        final String baseUrl = CodeGenerator.trimTrailingSlash(dashboardUrl);
        String apiKey = config.apiKey;
        String code = CodeGenerator.generate(CODE_LENGTH);
        MinecraftServer server = src.getServer();

        CommandUtil.sendSuccess(src, Component.literal("Login-Code wird generiert..."), false);

        Thread thread = new Thread(() -> {
            int status;
            try {
                status = requestCode(baseUrl, apiKey, code);
            } catch (Exception e) {
                server.execute(() -> {
                    try {
                        if (!player.isRemoved()) {
                            player.sendSystemMessage(Component.literal("§cLogin-Code fehlgeschlagen: " + e.getMessage()));
                        }
                    } catch (Exception ignored) {}
                });
                return;
            }
            server.execute(() -> {
                try {
                    if (player.isRemoved()) return;
                    if (status >= 200 && status < 300) {
                        player.sendSystemMessage(Component.literal("§aDein Login-Code: §f" + code + " §a— gültig für 10 Minuten."));
                        player.sendSystemMessage(Component.literal("§7Öffne " + baseUrl + "/login und gib den Code ein."));
                    } else if (status == 401 || status == 403) {
                        player.sendSystemMessage(Component.literal("§cLogin-Code konnte nicht erstellt werden (Auth-Fehler). Prüfe den apiKey in config/statusmod/config.json."));
                    } else if (status == 429) {
                        player.sendSystemMessage(Component.literal("§cZu viele Anfragen. Warte kurz und versuche es erneut."));
                    } else {
                        player.sendSystemMessage(Component.literal("§cLogin-Code konnte nicht erstellt werden (HTTP " + status + ")."));
                    }
                } catch (Exception ignored) {}
            });
        }, "statusmod-code");
        thread.setDaemon(true);
        thread.start();
    }

    private static int requestCode(String dashboardUrl, String apiKey, String code) throws Exception {
        JsonObject payload = new JsonObject();
        payload.addProperty("code", code);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(dashboardUrl + "/api/auth/verify-code"))
                .timeout(Duration.ofSeconds(20))
                .header("Content-Type", "application/json")
                .header("x-api-key", apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(payload.toString()))
                .build();

        HttpResponse<java.io.InputStream> response =
            HTTP_CLIENT.send(request, HttpResponse.BodyHandlers.ofInputStream());
        try (java.io.InputStream in = response.body()) {
            return response.statusCode();
        }
    }
}
