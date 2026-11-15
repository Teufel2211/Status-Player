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
import java.util.Locale;
import java.util.Map;

/**
 * Server-wide presets maintained in the dashboard and delivered through the
 * sync pull. Player-created presets live in {@link CustomPresets} and keep
 * precedence over server presets with the same name.
 */
public class ServerPresets {
    public static class ServerPreset {
        public String status = "";
        public String color = "reset";
        public long updatedAtMs = 0L;

        public ServerPreset() {}

        public ServerPreset(String status, String color, long updatedAtMs) {
            this.status = status == null ? "" : status;
            this.color = color == null || color.isEmpty() ? "reset" : color;
            this.updatedAtMs = updatedAtMs;
        }
    }

    private final File file;
    private Map<String, ServerPreset> presets = new HashMap<>();
    private final Gson gson = new Gson();

    public ServerPresets() {
        File configDir = new File("config/statusmod");
        configDir.mkdirs();
        file = new File(configDir, "server_presets.json");
        load();
    }

    public synchronized ServerPreset get(String name) {
        if (name == null || name.isBlank()) return null;
        return presets.get(name.toLowerCase(Locale.ROOT));
    }

    public synchronized Map<String, ServerPreset> getAll() {
        return new HashMap<>(presets);
    }

    public synchronized void replaceAll(Map<String, ServerPreset> next) {
        Map<String, ServerPreset> clean = new HashMap<>();
        if (next != null) {
            for (Map.Entry<String, ServerPreset> e : next.entrySet()) {
                if (e.getKey() == null || e.getKey().isBlank() || e.getValue() == null) continue;
                clean.put(e.getKey().toLowerCase(Locale.ROOT), e.getValue());
            }
        }
        presets = clean;
        save();
    }

    public synchronized void load() {
        try {
            if (!file.exists()) return;
            Type t = new TypeToken<Map<String, ServerPreset>>(){}.getType();
            try (Reader fr = Files.newBufferedReader(file.toPath())) {
                presets = gson.fromJson(fr, t);
            }
            if (presets == null) presets = new HashMap<>();
            presets.entrySet().removeIf(e -> e.getKey() == null || e.getValue() == null);
        } catch (Exception e) {
            System.err.println("[StatusMod] Error loading server presets:");
            e.printStackTrace();
            StorageFiles.backupCorrupted(file.toPath(), "server_presets.corrupt-" + System.currentTimeMillis() + ".json");
            presets = new HashMap<>();
        }
    }

    public synchronized void save() {
        try {
            File parent = file.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();
            if (presets == null) presets = new HashMap<>();
            Path target = file.toPath();
            Path tmp = target.resolveSibling(target.getFileName().toString() + ".tmp");
            try (Writer fw = Files.newBufferedWriter(tmp)) {
                gson.toJson(presets, fw);
            }
            try {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (Exception ignored) {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (Exception e) {
            System.err.println("[StatusMod] Error saving server presets:");
            e.printStackTrace();
        }
    }
}
