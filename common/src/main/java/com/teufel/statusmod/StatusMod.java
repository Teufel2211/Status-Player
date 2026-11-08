package com.teufel.statusmod;

import com.teufel.statusmod.storage.AuditLogger;
import com.teufel.statusmod.storage.BlockedPlayers;
import com.teufel.statusmod.storage.CustomPresets;
import com.teufel.statusmod.storage.ModConfig;
import com.teufel.statusmod.storage.MutedPlayers;
import com.teufel.statusmod.storage.ServerPresets;
import com.teufel.statusmod.storage.SettingsStorage;
import com.teufel.statusmod.storage.SlowmodeStore;
import com.teufel.statusmod.storage.WarningStore;
import com.teufel.statusmod.platform.Platform;
import com.teufel.statusmod.platform.PlatformServices;
import com.teufel.statusmod.setup.SetupManager;
import com.teufel.statusmod.sync.SyncManager;

import java.util.concurrent.atomic.AtomicBoolean;

public final class StatusMod {
    public static final String MOD_ID = "statusmod";
    /** Anzeigename. Wird von der Anti-Rebrand-Pruefung (IdentityCheck) verifiziert. */
    public static final String DISPLAY_NAME = "Status Player";
    /** Bump on every GUI-fix round so running builds are identifiable via log + /status version. */
    public static final String BUILD = "1.4.2";
    /** Mod version for user-facing output + /bug reports. Bump together with version.txt at release prep. */
    public static final String VERSION = "1.4.2";
    /**
     * Build-Fingerprint, ausschliesslich intern: "<version>-<loader>-<mc>-<sha8>".
     * Wird beim Release-Build in die JAR-Ressource statusmod-build.txt gestempelt
     * (scripts/local/stamp-build.ps1) und hier nur gelesen. Bewusst NICHT in
     * /status version, GUI, Chat oder Dateinamen - er dient der Zuordnung einer
     * irgendwo gefundenen Kopie zu einem konkreten Build.
     */
    public static final String BUILD_ID = loadBuildId();

    private static String loadBuildId() {
        try (java.io.InputStream in = StatusMod.class.getResourceAsStream("/statusmod-build.txt")) {
            if (in == null) return VERSION + "-dev";
            String id = new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8).trim();
            return id.isEmpty() ? VERSION + "-dev" : id;
        } catch (Exception e) {
            return VERSION + "-dev";
        }
    }
    private static final AtomicBoolean initialized = new AtomicBoolean(false);
    /** True wenn die Anti-Rebrand-Pruefung fehlgeschlagen ist (Mod startet nicht). */
    private static volatile boolean refused = false;
    /** Ergebnis der Attest-Pruefung; null solange init() nicht lief. */
    public static volatile com.teufel.statusmod.attest.AttestResult attestation;
    /** Vom Dashboard gesteuerter Kill-Switch (siehe SyncManager.pull). */
    private static volatile boolean remoteDisabled = false;
    /** "global" oder "server": bestimmt die Chat-Meldung beim Join. */
    private static volatile String remoteDisabledScope = "server";
    public static volatile ModConfig config;
    public static volatile SettingsStorage storage;
    public static volatile BlockedPlayers blockedPlayers;
    public static volatile MutedPlayers mutedPlayers;
    public static volatile CustomPresets customPresets;
    public static volatile ServerPresets serverPresets;
    public static volatile SlowmodeStore slowmodeStore;
    public static volatile WarningStore warningStore;

    private StatusMod() {}

    public static void init() {
        if (!initialized.compareAndSet(false, true)) {
            return;
        }

        // Anti-Rebrand: dieses JAR muss noch die erwartete Identitaet tragen.
        // Bei Abweichung startet der Mod nicht - nur /modinfo bleibt erreichbar.
        String identityFailure = com.teufel.statusmod.util.IdentityCheck.failureReason();
        if (identityFailure != null) {
            refused = true;
            System.out.println("[StatusMod] This build has been modified or rebranded. Refusing to start.");
            System.out.println("[StatusMod] Reason: " + identityFailure + " - run /modinfo for details.");
            return;
        }

        // Echtheit: signiertes Build-Attest im JAR. Fehlt es (Dev-Build), startet
        // der Mod ohne Sync-Attest; ist es vorhanden aber falsch, startet er nicht.
        com.teufel.statusmod.attest.AttestResult attest =
                com.teufel.statusmod.attest.Attestation.result();
        if (attest.status == com.teufel.statusmod.attest.AttestResult.Status.INVALID) {
            refused = true;
            System.out.println("[StatusMod] This build failed integrity verification. Refusing to start.");
            System.out.println("[StatusMod] Reason: " + attest.reason + " - run /modinfo for details.");
            return;
        }
        attestation = attest;
        System.out.println("[StatusMod] Attest: " + attest.describe());

        Platform platform = PlatformServices.getPlatform();
        config = ModConfig.load();
        remoteDisabled = config.remoteDisabled;
        remoteDisabledScope = "global".equalsIgnoreCase(config.remoteDisabledScope) ? "global" : "server";
        storage = new SettingsStorage();
        blockedPlayers = new BlockedPlayers();
        mutedPlayers = new MutedPlayers();
        customPresets = new CustomPresets();
        serverPresets = new ServerPresets();
        slowmodeStore = new SlowmodeStore();
        warningStore = new WarningStore();
        AuditLogger.init();

        System.out.println("[StatusMod] Initializing on " + platform.getName() + " (build " + BUILD + ")");
        if (com.teufel.statusmod.util.BedrockUtil.isFloodgatePresent()) {
            System.out.println("[StatusMod] Floodgate detected - Bedrock support enabled.");
        }

        if (platform.isDedicatedServer()) {
            SetupManager.runIfNeeded();
            SyncManager.start();
        }
    }

    public static ModConfig getConfig() {
        return config;
    }

    /** True wenn die Anti-Rebrand-Pruefung fehlgeschlagen ist - der Mod laeuft dann nicht. */
    public static boolean isRefused() {
        return refused;
    }

    /** True wenn der Fleet-Owner StatusMod fuer diesen Server deaktiviert hat. */
    public static boolean isRemoteDisabled() {
        return remoteDisabled;
    }

    /** "global" wenn alle Server abgeschaltet sind, sonst "server". */
    public static String getRemoteDisabledScope() {
        return remoteDisabledScope;
    }

    /**
     * Setzt den Kill-Switch-Zustand und persistiert ihn in config.json.
     * Der Aufruf kommt aus dem Sync-Thread; config.save() ist atomar.
     */
    public static void setRemoteDisabled(boolean disabled, String scope) {
        String normalized = disabled && "global".equalsIgnoreCase(scope) ? "global" : "server";
        remoteDisabled = disabled;
        remoteDisabledScope = normalized;
        ModConfig cfg = config;
        if (cfg != null && (cfg.remoteDisabled != disabled || !normalized.equals(cfg.remoteDisabledScope))) {
            cfg.remoteDisabled = disabled;
            cfg.remoteDisabledScope = normalized;
            cfg.save();
        }
    }

    public static SettingsStorage getStorage() {
        return storage;
    }

    public static BlockedPlayers getBlockedPlayers() {
        return blockedPlayers;
    }

    public static MutedPlayers getMutedPlayers() {
        return mutedPlayers;
    }

    public static CustomPresets getCustomPresets() {
        return customPresets;
    }

    public static ServerPresets getServerPresets() {
        return serverPresets;
    }

    public static SlowmodeStore getSlowmodeStore() {
        return slowmodeStore;
    }

    public static WarningStore getWarningStore() {
        return warningStore;
    }
}
