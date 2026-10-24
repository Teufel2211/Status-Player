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
 * Active warning levels pulled from the dashboard. The dashboard owns the
 * warnings; the mod only caches the aggregated badge data (level 1-3 + count).
 */
public class WarningStore {
    public static class WarnInfo {
        public int level = 0;
        public int count = 0;
        public long updatedAtMs = 0L;

        public WarnInfo() {}

        public WarnInfo(int level, int count, long updatedAtMs) {
            this.level = Math.max(0, Math.min(3, level));
            this.count = Math.max(0, count);
            this.updatedAtMs = updatedAtMs;
        }

        public WarnInfo copy() {
            return new WarnInfo(level, count, updatedAtMs);
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof WarnInfo)) return false;
            WarnInfo other = (WarnInfo) o;
            return level == other.level && count == other.count && updatedAtMs == other.updatedAtMs;
        }

        @Override
        public int hashCode() {
            return java.util.Objects.hash(level, count, updatedAtMs);
        }
    }

    private final File file;
    private Map<String, WarnInfo> warnings = new HashMap<>();
    private final Gson gson = new Gson();

    public WarningStore() {
        File configDir = new File("config/statusmod");
        configDir.mkdirs();
        file = new File(configDir, "warnings.json");
        load();
    }

    public synchronized WarnInfo get(String uuid) {
        if (uuid == null || uuid.isBlank()) return null;
        WarnInfo info = warnings.get(uuid);
        return info == null ? null : info.copy();
    }

    public synchronized int getLevel(String uuid) {
        WarnInfo info = get(uuid);
        return info == null ? 0 : info.level;
    }

    public synchronized Map<String, WarnInfo> getAll() {
        Map<String, WarnInfo> out = new HashMap<>();
        for (Map.Entry<String, WarnInfo> e : warnings.entrySet()) {
            if (e.getValue() != null) out.put(e.getKey(), e.getValue().copy());
        }
        return out;
    }

    /** Full replace: the dashboard response is authoritative (active warnings only). */
    public synchronized boolean replaceAll(Map<String, WarnInfo> next) {
        Map<String, WarnInfo> clean = new HashMap<>();
        if (next != null) {
            for (Map.Entry<String, WarnInfo> e : next.entrySet()) {
                if (e.getKey() == null || e.getKey().isBlank() || e.getValue() == null) continue;
                WarnInfo info = e.getValue();
                if (info.level <= 0 || info.count <= 0) continue;
                clean.put(e.getKey(), new WarnInfo(info.level, info.count, info.updatedAtMs));
            }
        }
        if (clean.equals(warnings)) return false;
        warnings = clean;
        save();
        return true;
    }

    public synchronized void load() {
        try {
            if (!file.exists()) return;
            Type t = new TypeToken<Map<String, WarnInfo>>(){}.getType();
            try (Reader fr = Files.newBufferedReader(file.toPath())) {
                warnings = gson.fromJson(fr, t);
            }
            if (warnings == null) warnings = new HashMap<>();
            warnings.entrySet().removeIf(e -> e.getKey() == null || e.getValue() == null || e.getValue().level <= 0);
        } catch (Exception e) {
            System.err.println("[StatusMod] Error loading warnings:");
            e.printStackTrace();
            StorageFiles.backupCorrupted(file.toPath(), "warnings.corrupt-" + System.currentTimeMillis() + ".json");
            warnings = new HashMap<>();
        }
    }

    public synchronized void save() {
        try {
            File parent = file.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();
            if (warnings == null) warnings = new HashMap<>();
            Path target = file.toPath();
            Path tmp = target.resolveSibling(target.getFileName().toString() + ".tmp");
            try (Writer fw = Files.newBufferedWriter(tmp)) {
                gson.toJson(warnings, fw);
            }
            try {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (Exception ignored) {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (Exception e) {
            System.err.println("[StatusMod] Error saving warnings:");
            e.printStackTrace();
        }
    }
}
