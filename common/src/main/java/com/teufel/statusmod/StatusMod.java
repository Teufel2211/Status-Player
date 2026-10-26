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
    /** Bump on every GUI-fix round so running builds are identifiable via log + /status version. */
    public static final String BUILD = "1.4.2-dev6";
    /** Mod version for user-facing output + /bug reports. Bump together with version.txt at release prep. */
    public static final String VERSION = "1.4.2";
    private static final AtomicBoolean initialized = new AtomicBoolean(false);
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
