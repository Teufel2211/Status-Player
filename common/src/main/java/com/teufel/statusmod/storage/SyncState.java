package com.teufel.statusmod.storage;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import java.io.File;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/**
 * Persistenter Sync-Zustand fuer den Offline-Fallback.
 *
 * <p>Der eigentliche Puffer ist der lokale JSON-Speicher (Source of Truth).
 * Diese Datei merkt sich nur, ob ein Push noch aussteht und wann der naechste
 * Versuch sinnvoll ist - damit ein Server-Neustart waehrend eines Ausfalls den
 * Nachhol-Push nicht vergisst.</p>
 *
 * <p>Wird ausschliesslich vom Sync-Thread gelesen/geschrieben. Fehlende oder
 * kaputte Datei = Defaults, niemals ein Abbruch.</p>
 */
public final class SyncState {
    /** Erster fehlgeschlagener Push seit dem letzten Erfolg (0 = nichts offen). */
    public long pendingSince;
    /** Zeitpunkt des letzten erfolgreichen Push/Pull. */
    public long lastSuccessAt;
    /** Aufeinanderfolgende Fehlversuche (Reset bei Erfolg). */
    public int consecutiveFailures;
    /** Backoff: vor diesem Zeitpunkt keinen neuen Versuch starten. */
    public long nextAttemptAt;
    /** Letzte Fehlerklasse (network/http_5xx/attest/unauthorized/not_found/rate_limited). */
    public String lastError;
    /** Build-ID des zuletzt erfolgreich verifizierten Attests. */
    public String lastAttestBuildId;

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    public static SyncState load() {
        SyncState state = null;
        File file = file();
        if (file.isFile()) {
            try (Reader reader = Files.newBufferedReader(file.toPath())) {
                state = GSON.fromJson(reader, SyncState.class);
            } catch (Exception e) {
                StorageFiles.backupCorrupted(file.toPath(), "sync_state.corrupt.json");
            }
        }
        if (state == null) state = new SyncState();
        if (state.consecutiveFailures < 0) state.consecutiveFailures = 0;
        if (state.pendingSince < 0L) state.pendingSince = 0L;
        if (state.nextAttemptAt < 0L) state.nextAttemptAt = 0L;
        if (state.lastSuccessAt < 0L) state.lastSuccessAt = 0L;
        return state;
    }

    /** Merkt den ersten fehlgeschlagenen Push; ein laufender Ausfall bleibt stehen. */
    public void markPending(long now) {
        if (pendingSince == 0L) pendingSince = now;
    }

    public void recordFailure(long now, String error, long nextAttempt) {
        markPending(now);
        consecutiveFailures++;
        lastError = error;
        nextAttemptAt = nextAttempt;
    }

    public void recordSuccess(long now) {
        pendingSince = 0L;
        consecutiveFailures = 0;
        nextAttemptAt = 0L;
        lastError = null;
        lastSuccessAt = now;
    }

    /** Dauer des letzten Ausfalls in ms (0, wenn kein Ausfall offen war). */
    public long lastOutageMs(long now) {
        return pendingSince == 0L ? 0L : Math.max(0L, now - pendingSince);
    }

    public void save() {
        try {
            File file = file();
            File dir = file.getParentFile();
            if (dir != null) dir.mkdirs();
            Path target = file.toPath();
            Path tmp = target.resolveSibling(target.getFileName().toString() + ".tmp");
            try (Writer writer = Files.newBufferedWriter(tmp)) {
                GSON.toJson(this, writer);
            }
            try {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
            } catch (Exception moveFailed) {
                Files.copy(tmp, target, StandardCopyOption.REPLACE_EXISTING);
                Files.deleteIfExists(tmp);
            }
        } catch (Exception ignored) {
            // Der Sync funktioniert auch ohne Zustandsdatei (nur ohne Merker).
        }
    }

    private static File file() {
        return new File(new File("config/statusmod"), "sync_state.json");
    }
}
