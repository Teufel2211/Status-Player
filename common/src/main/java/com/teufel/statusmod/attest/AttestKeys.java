package com.teufel.statusmod.attest;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Veroeffentlichte Attest-Public-Keys (Ed25519, roh 32 Byte, Base64).
 *
 * <p>Quelle ist {@code scripts/ci/attest-keys.json}. Der Private Key liegt
 * ausschliesslich als GitHub-Secret {@code STATUSMOD_ATTEST_KEY} und wird
 * niemals ins Repo oder ins JAR geschrieben. Der Test
 * {@code tests/verify_attest_keys.py} vergleicht diese Tabelle mit der JSON-
 * Datei und der Dashboard-Migration.</p>
 */
public final class AttestKeys {
    private static final Map<String, String> KEYS = new LinkedHashMap<>();

    static {
        // key_id -> Base64 (rohe 32 Byte Ed25519)
        KEYS.put("2026-11", "9cXmjg4Nn4SoksWeNbCZi6D3HfXLaUmp0fvu9HPU0rM=");
    }

    private AttestKeys() {}

    /** @return Base64-Public-Key oder null, wenn die key_id unbekannt ist. */
    public static String publicKey(String keyId) {
        if (keyId == null) return null;
        return KEYS.get(keyId);
    }
}
