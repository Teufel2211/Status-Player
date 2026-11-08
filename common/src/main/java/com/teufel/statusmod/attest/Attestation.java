package com.teufel.statusmod.attest;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.teufel.statusmod.StatusMod;
import com.teufel.statusmod.util.IdentityCheck;

import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Prueft die Echtheit des eigenen JARs (signiertes Build-Attest).
 *
 * <p>Die Release-Pipeline haengt zwei Root-Entries ins JAR:</p>
 * <pre>
 *   statusmod-attest.json   kanonisches JSON mit Build-ID und Inhalts-Hashes
 *   statusmod-attest.sig    Base64(Ed25519-Signatur ueber die exakten JSON-Bytes)
 * </pre>
 *
 * <p>Beim Start werden die Hashes ueber alle eigenen Entries neu berechnet und
 * die Signatur gegen den eingebetteten Public Key geprueft. Abweichung =
 * Start verweigert (wie bei der Anti-Rebrand-Pruefung).</p>
 *
 * <p>Grenze: Wer das Attest eines echten Builds unveraendert weiterreicht, hat
 * weiter ein gueltiges Attest. Das ist kein DRM, sondern eine Huerde gegen
 * veraenderte/fremdgebaute JARs und eine Spur im Dashboard.</p>
 */
public final class Attestation {
    private static final String ATTEST_JSON = "statusmod-attest.json";
    private static final String ATTEST_SIG = "statusmod-attest.sig";
    private static final Set<String> NOT_HASHED = new HashSet<>(java.util.Arrays.asList(
            "META-INF/MANIFEST.MF", ATTEST_JSON, ATTEST_SIG));

    /** SPKI-Prefix fuer einen rohen 32-Byte-Ed25519-Public-Key. */
    private static final byte[] ED25519_SPKI_PREFIX = {
            0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
    };

    private static volatile AttestResult cached;

    private Attestation() {}

    /** Ergebnis der Pruefung; wird genau einmal berechnet und gecacht. */
    public static AttestResult result() {
        AttestResult r = cached;
        if (r != null) return r;
        synchronized (Attestation.class) {
            if (cached == null) cached = compute();
            return cached;
        }
    }

    private static AttestResult compute() {
        File self = IdentityCheck.ownArtifactFile();
        if (self == null) return AttestResult.dev("own artifact not found");
        if (!self.isFile()) return AttestResult.dev("classes directory");

        try (ZipFile zip = new ZipFile(self)) {
            ZipEntry jsonEntry = zip.getEntry(ATTEST_JSON);
            ZipEntry sigEntry = zip.getEntry(ATTEST_SIG);
            if (jsonEntry == null || sigEntry == null) {
                return AttestResult.dev("no attest entries");
            }

            byte[] jsonBytes = read(zip, jsonEntry);
            byte[] sigBytes = Base64.getDecoder().decode(
                    new String(read(zip, sigEntry), StandardCharsets.UTF_8).trim());

            JsonObject attest;
            try {
                attest = JsonParser.parseString(new String(jsonBytes, StandardCharsets.UTF_8))
                        .getAsJsonObject();
            } catch (Exception e) {
                return AttestResult.invalid("attest JSON is not valid");
            }

            if (intValue(attest, "schema") != 1) return AttestResult.invalid("unsupported attest schema");
            String keyId = stringValue(attest, "key_id");
            String publicKey = AttestKeys.publicKey(keyId);
            if (publicKey == null) return AttestResult.invalid("unknown attest key");

            if (!verifySignature(jsonBytes, sigBytes, publicKey)) {
                return AttestResult.invalid("attest signature invalid");
            }

            String buildId = stringValue(attest, "build_id");
            if (buildId == null || !buildId.equals(StatusMod.BUILD_ID)) {
                return AttestResult.invalid("build id does not match this jar");
            }

            String expectedClasses = stringValue(attest, "classes_sha256");
            if (expectedClasses == null || !expectedClasses.equals(hashEntries(zip, true))) {
                return AttestResult.invalid("class content was modified");
            }

            String expectedResources = stringValue(attest, "resources_sha256");
            if (expectedResources == null || !expectedResources.equals(hashEntries(zip, false))) {
                return AttestResult.invalid("resource content was modified");
            }

            return AttestResult.verified(buildId, keyId, jsonBytes, sigBytes);
        } catch (Throwable t) {
            return AttestResult.invalid("attest check failed (" + t.getClass().getSimpleName() + ")");
        }
    }

    private static boolean verifySignature(byte[] data, byte[] signature, String publicKeyB64)
            throws Exception {
        byte[] raw = Base64.getDecoder().decode(publicKeyB64);
        if (raw.length != 32) return false;

        byte[] spki = new byte[ED25519_SPKI_PREFIX.length + raw.length];
        System.arraycopy(ED25519_SPKI_PREFIX, 0, spki, 0, ED25519_SPKI_PREFIX.length);
        System.arraycopy(raw, 0, spki, ED25519_SPKI_PREFIX.length, raw.length);

        PublicKey key = KeyFactory.getInstance("Ed25519")
                .generatePublic(new X509EncodedKeySpec(spki));
        Signature verifier = Signature.getInstance("Ed25519");
        verifier.initVerify(key);
        verifier.update(data);
        return verifier.verify(signature);
    }

    /**
     * SHA-256 ueber sortierte Zeilen {@code "<name>\0<sha256(inhalt)>\n"}.
     * Muss exakt der Berechnung in {@code scripts/ci/sign-build.mjs} entsprechen.
     */
    private static String hashEntries(ZipFile zip, boolean classes) throws Exception {
        List<String> names = new ArrayList<>();
        Enumeration<? extends ZipEntry> entries = zip.entries();
        while (entries.hasMoreElements()) {
            ZipEntry entry = entries.nextElement();
            if (entry.isDirectory()) continue;
            String name = entry.getName();
            boolean isClass = name.endsWith(".class");
            if (classes != isClass) continue;
            if (!classes && NOT_HASHED.contains(name)) continue;
            names.add(name);
        }
        Collections.sort(names);

        MessageDigest overall = MessageDigest.getInstance("SHA-256");
        for (String name : names) {
            byte[] data = read(zip, zip.getEntry(name));
            String perEntry = hex(MessageDigest.getInstance("SHA-256").digest(data));
            overall.update((name + "\u0000" + perEntry + "\n").getBytes(StandardCharsets.UTF_8));
        }
        return hex(overall.digest());
    }

    private static byte[] read(ZipFile zip, ZipEntry entry) throws Exception {
        try (InputStream in = zip.getInputStream(entry)) {
            return in.readAllBytes();
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static String stringValue(JsonObject obj, String key) {
        try {
            if (obj.has(key) && obj.get(key).isJsonPrimitive()) return obj.get(key).getAsString();
        } catch (Exception ignored) {}
        return null;
    }

    private static int intValue(JsonObject obj, String key) {
        try {
            if (obj.has(key) && obj.get(key).isJsonPrimitive()) return obj.get(key).getAsInt();
        } catch (Exception ignored) {}
        return -1;
    }
}
