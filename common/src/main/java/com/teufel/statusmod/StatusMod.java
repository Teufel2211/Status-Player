package com.teufel.statusmod;

import com.teufel.statusmod.storage.AuditLogger;
import com.teufel.statusmod.storage.BlockedPlayers;
import com.teufel.statusmod.storage.CustomPresets;
import com.teufel.statusmod.storage.ModConfig;
import com.teufel.statusmod.storage.MutedPlayers;
import com.teufel.statusmod.storage.SettingsStorage;
import com.teufel.statusmod.platform.Platform;
import com.teufel.statusmod.platform.PlatformServices;
import com.teufel.statusmod.setup.SetupManager;
import com.teufel.statusmod.sync.SyncManager;

import java.util.concurrent.atomic.AtomicBoolean;

public final class StatusMod {
    public static final String MOD_ID = "statusmod";
    /** Bump on every GUI-fix round so running builds are identifiable via log + /status version. */
    public static final String BUILD = "geyser263";
    /** Mod version for user-facing output + /bug reports. Bump together with version.txt at release prep. */
    public static final String VERSION = "1.4.1";
    private static final AtomicBoolean initialized = new AtomicBoolean(false);
    public static volatile ModConfig config;
    public static volatile SettingsStorage storage;
    public static volatile BlockedPlayers blockedPlayers;
    public static volatile MutedPlayers mutedPlayers;
    public static volatile CustomPresets customPresets;

    private StatusMod() {}

    public static void init() {
        if (!initialized.compareAndSet(false, true)) {
            return;
        }

        Platform platform = PlatformServices.getPlatform();
        config = ModConfig.load();
        storage = new SettingsStorage();
        blockedPlayers = new BlockedPlayers();
        mutedPlayers = new MutedPlayers();
        customPresets = new CustomPresets();
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
}
