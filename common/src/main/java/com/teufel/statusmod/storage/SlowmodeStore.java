package com.teufel.statusmod.storage;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;

import java.io.File;
import java.io.Reader;
import java.io.Writer;
import java.lang.reflect.Type;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.Map;

/**
 * Per-player chat slowmode. The dashboard is the source of truth; values are
 * cached locally (and persisted) so a dashboard outage does not disable the
 * last known slowmode.
 */
public class SlowmodeStore {
    private final File file;
    private Map<String, Integer> seconds = new HashMap<>();
    private final Gson gson = new Gson();

    public SlowmodeStore() {
        File configDir = new File("config/statusmod");
        configDir.mkdirs();
        file = new File(configDir, "slowmode.json");
        load();
    }

    public synchronized int getSeconds(String uuid) {
        if (uuid == null || uuid.isBlank()) return 0;
        Integer value = seconds.get(uuid);
        return value == null ? 0 : Math.max(0, Math.min(3600, value));
    }

    public synchronized void setSeconds(String uuid, int value) {
        if (uuid == null || uuid.isBlank()) return;
        int clamped = Math.max(0, Math.min(3600, value));
        if (clamped <= 0) {
            if (seconds.remove(uuid) != null) save();
            return;
        }
        if (!Integer.valueOf(clamped).equals(seconds.get(uuid))) {
            seconds.put(uuid, clamped);
            save();
        }
    }

    public synchronized Map<String, Integer> getAll() {
        return new HashMap<>(seconds);
    }

    public synchronized void load() {
        try {
            if (!file.exists()) return;
            Type t = new TypeToken<Map<String, Integer>>(){}.getType();
            try (Reader fr = Files.newBufferedReader(file.toPath())) {
                seconds = gson.fromJson(fr, t);
            }
            if (seconds == null) seconds = new HashMap<>();
            seconds.entrySet().removeIf(e -> e.getKey() == null || e.getValue() == null || e.getValue() <= 0);
        } catch (Exception e) {
            System.err.println("[StatusMod] Error loading slowmode:");
            e.printStackTrace();
            StorageFiles.backupCorrupted(file.toPath(), "slowmode.corrupt-" + System.currentTimeMillis() + ".json");
            seconds = new HashMap<>();
        }
    }

    public synchronized void save() {
        try {
            File parent = file.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();
            if (seconds == null) seconds = new HashMap<>();
            Path target = file.toPath();
            Path tmp = target.resolveSibling(target.getFileName().toString() + ".tmp");
            try (Writer fw = Files.newBufferedWriter(tmp)) {
                gson.toJson(seconds, fw);
            }
            try {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (Exception ignored) {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (Exception e) {
            System.err.println("[StatusMod] Error saving slowmode:");
            e.printStackTrace();
        }
    }
}
