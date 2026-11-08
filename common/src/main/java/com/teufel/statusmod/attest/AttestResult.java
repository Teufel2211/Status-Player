package com.teufel.statusmod.attest;

import java.util.Base64;

/**
 * Ergebnis der Attest-Pruefung (siehe {@link Attestation}).
 *
 * <p>Drei Zustaende bewusst getrennt:</p>
 * <ul>
 *   <li>{@link Status#VERIFIED} - Release-JAR mit gueltiger Signatur und
 *       passenden Hashes. Nur dieser Zustand darf mit dem Dashboard syncen.</li>
 *   <li>{@link Status#DEV} - kein Attest vorhanden (Klassenverzeichnis oder
 *       selbst gebautes JAR). Startet, aber ohne Attest-Header.</li>
 *   <li>{@link Status#INVALID} - Attest vorhanden, aber falsch. Start wird
 *       verweigert (wie bei der Anti-Rebrand-Pruefung).</li>
 * </ul>
 */
public final class AttestResult {
    public enum Status { VERIFIED, DEV, INVALID }

    public final Status status;
    /** Kurze Begruendung (englisch), nur bei DEV/INVALID gesetzt. */
    public final String reason;
    /** Build-ID aus dem Attest, sonst null. */
    public final String buildId;
    /** Key-ID aus dem Attest, sonst null. */
    public final String keyId;
    /** Exakte Bytes von statusmod-attest.json (nur bei VERIFIED). */
    final byte[] attestJson;
    /** Signatur-Bytes aus statusmod-attest.sig (nur bei VERIFIED). */
    final byte[] signature;

    private AttestResult(Status status, String reason, String buildId, String keyId,
                         byte[] attestJson, byte[] signature) {
        this.status = status;
        this.reason = reason;
        this.buildId = buildId;
        this.keyId = keyId;
        this.attestJson = attestJson;
        this.signature = signature;
    }

    static AttestResult verified(String buildId, String keyId, byte[] json, byte[] signature) {
        return new AttestResult(Status.VERIFIED, null, buildId, keyId, json, signature);
    }

    static AttestResult dev(String reason) {
        return new AttestResult(Status.DEV, reason, null, null, null, null);
    }

    static AttestResult invalid(String reason) {
        return new AttestResult(Status.INVALID, reason, null, null, null, null);
    }

    public boolean isVerified() {
        return status == Status.VERIFIED;
    }

    /**
     * Attest-JSON fuer den Header {@code x-mod-attest} (Base64url ohne Padding,
     * damit der Wert ohne Escaping in einen HTTP-Header passt).
     */
    public String headerValue() {
        return attestJson == null ? null
                : Base64.getUrlEncoder().withoutPadding().encodeToString(attestJson);
    }

    /** Signatur fuer den Header {@code x-mod-attest-sig} (Standard-Base64). */
    public String signatureValue() {
        return signature == null ? null : Base64.getEncoder().encodeToString(signature);
    }

    /** Kurzform fuer Logzeilen und /modinfo. */
    public String describe() {
        switch (status) {
            case VERIFIED:
                return "verified (key " + keyId + ")";
            case DEV:
                return "dev build, unsigned (" + reason + ")";
            default:
                return "INVALID (" + reason + ")";
        }
    }
}
