package com.teufel.statusmod.storage;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.File;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Block/ignore list with optional expiry.
 *
 * <p>Permanent entries ({@code until == 0}) behave like the old /block.
 * Temporary entries ("Kurzzeit-Ignore") automatically expire; the stashed
 * status is restored by {@link com.teufel.statusmod.lifecycle.StatusLifecycle}.
 * The on-disk format is backwards compatible: the old JSON array of UUIDs is
 * still accepted.</p>
 */
public class BlockedPlayers {
    public static class BlockEntry {
        public long until = 0L;
        public String prevStatus = "";
        public String prevColor = "reset";
        /** Expiry of the stashed status (0 = normal status, no expiry). */
        public long prevExpiresAtMs = 0L;
        /** Status that the timed status would have fallen back to. */
        public String prevTimedStatus = "";
        public String prevTimedColor = "reset";

        public BlockEntry() {}

        public BlockEntry(long until, String prevStatus, String prevColor) {
            this(until, prevStatus, prevColor, 0L, "", "reset");
        }

        public BlockEntry(long until, String prevStatus, String prevColor,
                          long prevExpiresAtMs, String prevTimedStatus, String prevTimedColor) {
            this.until = until;
            this.prevStatus = prevStatus == null ? "" : prevStatus;
            this.prevColor = prevColor == null || prevColor.isEmpty() ? "reset" : prevColor;
            this.prevExpiresAtMs = Math.max(0L, prevExpiresAtMs);
            this.prevTimedStatus = prevTimedStatus == null ? "" : prevTimedStatus;
            this.prevTimedColor = prevTimedColor == null || prevTimedColor.isEmpty() ? "reset" : prevTimedColor;
        }

        public boolean active(long now) {
            return until <= 0L || now < until;
        }

        public BlockEntry copy() {
            return new BlockEntry(until, prevStatus, prevColor, prevExpiresAtMs, prevTimedStatus, prevTimedColor);
        }
    }

    private final File file;
    private Map<String, BlockEntry> entries = new HashMap<>();
    private final Gson gson = new Gson();

    public BlockedPlayers() {
        File configDir = new File("config/statusmod");
        configDir.mkdirs();
        file = new File(configDir, "blocked_players.json");
        load();
    }

    public synchronized boolean isBlocked(String uuid) {
        if (uuid == null || uuid.isBlank()) return false;
        BlockEntry entry = entries.get(uuid);
        return entry != null && entry.active(System.currentTimeMillis());
    }

    /** @return a copy of the active entry, or null. */
    public synchronized BlockEntry getEntry(String uuid) {
        if (uuid == null || uuid.isBlank()) return null;
        BlockEntry entry = entries.get(uuid);
        if (entry == null || !entry.active(System.currentTimeMillis())) return null;
        return entry.copy();
    }

    public synchronized boolean isTemporary(String uuid) {
        BlockEntry entry = getEntry(uuid);
        return entry != null && entry.until > 0L;
    }

    /** Permanent block (old behaviour). Keeps an existing temporary stash. */
    public synchronized void block(String uuid) {
        if (uuid == null || uuid.isBlank()) return;
        BlockEntry entry = entries.get(uuid);
        if (entry == null) {
            entries.put(uuid, new BlockEntry(0L, "", "reset"));
            save();
            return;
        }
        if (entry.until != 0L) {
            entry.until = 0L;
            save();
        }
    }

    /**
     * Temporary block ("ignore"). If already permanently blocked this is a no-op.
     * If already temporarily blocked, the later expiry wins and an existing
     * stashed status is preserved.
     */
    public synchronized void blockTemporary(String uuid, long untilMs, String prevStatus, String prevColor) {
        blockTemporary(uuid, untilMs, prevStatus, prevColor, 0L, "", "reset");
    }

    public synchronized void blockTemporary(String uuid, long untilMs, String prevStatus, String prevColor,
                                            long prevExpiresAtMs, String prevTimedStatus, String prevTimedColor) {
        if (uuid == null || uuid.isBlank() || untilMs <= System.currentTimeMillis()) return;
        BlockEntry entry = entries.get(uuid);
        if (entry == null) {
            entries.put(uuid, new BlockEntry(untilMs, prevStatus, prevColor,
                    prevExpiresAtMs, prevTimedStatus, prevTimedColor));
            save();
            return;
        }
        if (entry.until <= 0L) return; // permanent wins
        boolean changed = false;
        if (untilMs > entry.until) {
            entry.until = untilMs;
            changed = true;
        }
        if ((entry.prevStatus == null || entry.prevStatus.isEmpty())
                && prevStatus != null && !prevStatus.isEmpty()) {
            entry.prevStatus = prevStatus;
            entry.prevColor = prevColor == null || prevColor.isEmpty() ? "reset" : prevColor;
            entry.prevExpiresAtMs = Math.max(0L, prevExpiresAtMs);
            entry.prevTimedStatus = prevTimedStatus == null ? "" : prevTimedStatus;
            entry.prevTimedColor = prevTimedColor == null || prevTimedColor.isEmpty() ? "reset" : prevTimedColor;
            changed = true;
        }
        if (changed) save();
    }

    /** @return removed entry (may carry a status stash), or null. */
    public synchronized BlockEntry unblock(String uuid) {
        if (uuid == null || uuid.isBlank()) return null;
        BlockEntry removed = entries.remove(uuid);
        if (removed != null) save();
        return removed == null ? null : removed.copy();
    }

    /** Active UUIDs only (expired entries stay until {@link #pollExpired()}). */
    public synchronized Set<String> getBlockedPlayers() {
        long now = System.currentTimeMillis();
        Set<String> out = new HashSet<>();
        for (Map.Entry<String, BlockEntry> e : entries.entrySet()) {
            if (e.getValue() != null && e.getValue().active(now)) out.add(e.getKey());
        }
        return out;
    }

    /** Active entries including expiry + stash, used by the sync push. */
    public synchronized Map<String, BlockEntry> getActiveEntries() {
        long now = System.currentTimeMillis();
        Map<String, BlockEntry> out = new LinkedHashMap<>();
        for (Map.Entry<String, BlockEntry> e : entries.entrySet()) {
            if (e.getValue() != null && e.getValue().active(now)) out.put(e.getKey(), e.getValue().copy());
        }
        return out;
    }

    /**
     * Removes entries whose expiry passed and returns them so the caller can
     * restore the stashed status. Permanent entries are never returned.
     */
    public synchronized Map<String, BlockEntry> pollExpired() {
        long now = System.currentTimeMillis();
        Map<String, BlockEntry> expired = new LinkedHashMap<>();
        boolean changed = false;
        java.util.Iterator<Map.Entry<String, BlockEntry>> it = entries.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<String, BlockEntry> e = it.next();
            BlockEntry entry = e.getValue();
            if (entry == null) {
                it.remove();
                changed = true;
                continue;
            }
            if (entry.until > 0L && now >= entry.until) {
                expired.put(e.getKey(), entry.copy());
                it.remove();
                changed = true;
            }
        }
        if (changed) save();
        return expired;
    }

    public synchronized void load() {
        try {
            if (!file.exists()) return;
            Map<String, BlockEntry> loaded = new HashMap<>();
            try (Reader fr = Files.newBufferedReader(file.toPath())) {
                JsonElement root = JsonParser.parseReader(fr);
                if (root != null && root.isJsonArray()) {
                    // Legacy format: ["uuid", ...] -> permanent blocks.
                    for (JsonElement el : root.getAsJsonArray()) {
                        if (el != null && el.isJsonPrimitive()) {
                            String uuid = el.getAsString();
                            if (uuid != null && !uuid.isBlank()) {
                                loaded.put(uuid, new BlockEntry(0L, "", "reset"));
                            }
                        }
                    }
                } else if (root != null && root.isJsonObject()) {
                    JsonObject obj = root.getAsJsonObject();
                    for (Map.Entry<String, JsonElement> e : obj.entrySet()) {
                        if (e.getKey() == null || e.getKey().isBlank()) continue;
                        BlockEntry entry = gson.fromJson(e.getValue(), BlockEntry.class);
                        if (entry == null) entry = new BlockEntry();
                        if (entry.prevStatus == null) entry.prevStatus = "";
                        if (entry.prevColor == null || entry.prevColor.isEmpty()) entry.prevColor = "reset";
                        if (entry.prevExpiresAtMs < 0L) entry.prevExpiresAtMs = 0L;
                        if (entry.prevTimedStatus == null) entry.prevTimedStatus = "";
                        if (entry.prevTimedColor == null || entry.prevTimedColor.isEmpty()) entry.prevTimedColor = "reset";
                        loaded.put(e.getKey(), entry);
                    }
                }
            }
            entries = loaded;
        } catch (Exception e) {
            System.err.println("[StatusMod] Error loading blocked players:");
            e.printStackTrace();
            StorageFiles.backupCorrupted(file.toPath(), "blocked_players.corrupt-" + System.currentTimeMillis() + ".json");
            entries = new HashMap<>();
        }
    }

    public synchronized void save() {
        try {
            File parent = file.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();
            if (entries == null) entries = new HashMap<>();
            Path target = file.toPath();
            Path tmp = target.resolveSibling(target.getFileName().toString() + ".tmp");
            try (Writer fw = Files.newBufferedWriter(tmp)) {
                gson.toJson(entries, fw);
            }
            try {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (Exception ignored) {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (Exception e) {
            System.err.println("[StatusMod] Error saving blocked players:");
            e.printStackTrace();
        }
    }
}
