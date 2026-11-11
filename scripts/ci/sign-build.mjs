// Signiert die Release-JARs (Status Player).
//
// Fuegt jedem JAR zwei Root-Entries hinzu:
//   statusmod-attest.json  kanonisches JSON mit Build-ID und Inhalts-Hashes
//   statusmod-attest.sig   Base64(Ed25519-Signatur ueber die exakten JSON-Bytes)
//
// Das JAR wird dabei NICHT neu gepackt: bestehende Entries werden byte-identisch
// (gleiche komprimierte Daten, gleicher CRC, gleiche Zeitstempel) uebernommen,
// META-INF/MANIFEST.MF bleibt zuerst. Nur die beiden Attest-Entries kommen hinzu.
//
// Aufruf (CI):
//   $env:STATUSMOD_ATTEST_KEY = <base64 PKCS#8 aus dem GitHub-Secret>
//   node scripts/ci/sign-build.mjs --dir dist/multiversion
//
// Lokal (ohne Secret, nur zum Testen):
//   node scripts/ci/sign-build.mjs --dir <verzeichnis> --key-file <pfad> [--dry-run]
//
// Der Private Key wird nie geloggt und nie geschrieben. Vor dem Signieren wird
// geprueft, dass der Secret-Key zum veroeffentlichten Public Key
// (scripts/ci/attest-keys.json) passt - sonst koennte kein Mod die Signatur
// verifizieren.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ATTEST_JSON, ATTEST_SIG, collectJars, entryContent, readZip } from "./lib/zip.mjs";

const EXCLUDED_FROM_RESOURCES = new Set(["META-INF/MANIFEST.MF", ATTEST_JSON, ATTEST_SIG]);

// ---------------------------------------------------------------- CRC32

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- ZIP schreiben

function dosDateTime(date) {
  const d = date instanceof Date ? date : new Date();
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
  };
}

function needsUtf8Flag(name) {
  return Buffer.byteLength(name, "utf8") !== name.length;
}

function writeZip(entries, outPath) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const flags = needsUtf8Flag(e.name) ? 0x0800 : 0x0000;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(e.method, 8);
    local.writeUInt16LE(e.time, 10);
    local.writeUInt16LE(e.date, 12);
    local.writeUInt32LE(e.crc, 14);
    local.writeUInt32LE(e.compSize, 18);
    local.writeUInt32LE(e.uncompSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, e.data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(e.method, 10);
    cd.writeUInt16LE(e.time, 12);
    cd.writeUInt16LE(e.date, 14);
    cd.writeUInt32LE(e.crc, 16);
    cd.writeUInt32LE(e.compSize, 20);
    cd.writeUInt32LE(e.uncompSize, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);

    central.push(Buffer.concat([cd, nameBuf]));
    offset += local.length + nameBuf.length + e.data.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const tmp = outPath + ".attest-tmp";
  fs.writeFileSync(tmp, Buffer.concat([...chunks, cdBuf, eocd]));
  fs.renameSync(tmp, outPath);
}

// ---------------------------------------------------------------- Hashes

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function hashEntries(entries) {
  const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
  const lines = sorted.map((e) => `${e.name}\u0000${sha256(entryContent(e))}\n`);
  return sha256(Buffer.from(lines.join(""), "utf8"));
}

// ---------------------------------------------------------------- Metadaten

function readBuildId(entries) {
  const entry = entries.find((e) => e.name === "statusmod-build.txt");
  if (!entry) throw new Error("statusmod-build.txt missing - run stamp-build.ps1 first");
  return entryContent(entry).toString("utf8").trim();
}

function parseBuildId(buildId) {
  const parts = buildId.split("-");
  if (parts.length !== 4 || !/^[0-9a-f]{8}$/i.test(parts[3])) {
    throw new Error(`unexpected build id: ${buildId}`);
  }
  const [version, loader, minecraft] = parts;
  const loaders = new Set(["fabric", "forge", "neoforge", "quilt"]);
  if (!loaders.has(loader)) throw new Error(`unknown loader in build id: ${buildId}`);
  return { version, loader, minecraft };
}

function canonicalJson(fields) {
  const order = [
    "schema",
    "build_id",
    "version",
    "loader",
    "minecraft",
    "classes_sha256",
    "resources_sha256",
    "key_id",
    "issued_at",
  ];
  return JSON.stringify(fields, order);
}

// Roh-32-Byte-Ed25519-Public-Key in den SPKI-Wrapper packen, damit Node/Java
// ihn ohne Zusatzbibliothek importieren koennen.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function publicKeyFromRaw(rawB64) {
  const raw = Buffer.from(rawB64, "base64");
  if (raw.length !== 32) throw new Error("public key must be 32 raw bytes");
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

/**
 * Prueft ein JAR gegen seine eigenen Attest-Entries und die veroeffentlichten
 * Keys. Wird von verify-jars.ps1 und check-a4.ps1 aufgerufen.
 */
function verifyJar(jar, keys) {
  const entries = readZip(fs.readFileSync(jar));
  const jsonEntry = entries.find((e) => e.name === ATTEST_JSON);
  const sigEntry = entries.find((e) => e.name === ATTEST_SIG);
  if (!jsonEntry) throw new Error("statusmod-attest.json missing");
  if (!sigEntry) throw new Error("statusmod-attest.sig missing");

  const jsonText = entryContent(jsonEntry).toString("utf8");
  const fields = JSON.parse(jsonText);
  if (canonicalJson(fields) !== jsonText) throw new Error("attest JSON is not canonical");

  const key = keys.find((k) => k.key_id === fields.key_id);
  if (!key) throw new Error(`unknown key_id: ${fields.key_id}`);
  const ok = crypto.verify(
    null,
    Buffer.from(jsonText, "utf8"),
    publicKeyFromRaw(key.public_key),
    Buffer.from(entryContent(sigEntry).toString("utf8"), "base64")
  );
  if (!ok) throw new Error("signature invalid");

  const buildId = readBuildId(entries);
  if (fields.build_id !== buildId) {
    throw new Error(`build_id mismatch: attest=${fields.build_id} jar=${buildId}`);
  }

  const classEntries = entries.filter((e) => e.name.endsWith(".class"));
  const resourceEntries = entries.filter(
    (e) => !e.name.endsWith(".class") && !EXCLUDED_FROM_RESOURCES.has(e.name)
  );
  if (hashEntries(classEntries) !== fields.classes_sha256) throw new Error("class hash mismatch");
  if (hashEntries(resourceEntries) !== fields.resources_sha256) throw new Error("resource hash mismatch");

  return fields;
}

// ---------------------------------------------------------------- Keys

function loadKeys(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (raw.schema !== 1 || !Array.isArray(raw.keys)) throw new Error("bad attest-keys.json");
  return raw.keys;
}

function rawPublicFromPrivate(privateKey) {
  const spki = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
  return Buffer.from(spki).subarray(spki.length - 32).toString("base64");
}

function loadPrivateKey(args) {
  if (args.keyFile) {
    return crypto.createPrivateKey({
      key: Buffer.from(fs.readFileSync(args.keyFile, "utf8").trim(), "base64"),
      format: "der",
      type: "pkcs8",
    });
  }
  const fromEnv = (process.env.STATUSMOD_ATTEST_KEY || "").replace(/\s+/g, "");
  if (!fromEnv) throw new Error("STATUSMOD_ATTEST_KEY not set (or pass --key-file)");
  return crypto.createPrivateKey({
    key: Buffer.from(fromEnv, "base64"),
    format: "der",
    type: "pkcs8",
  });
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const args = { jars: [], dryRun: false, verify: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--jar") args.jars.push(path.resolve(argv[++i]));
    else if (a === "--dir") args.dir = path.resolve(argv[++i]);
    else if (a === "--key-file") args.keyFile = path.resolve(argv[++i]);
    else if (a === "--key-id") args.keyId = argv[++i];
    else if (a === "--keys-json") args.keysJson = path.resolve(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--verify") args.verify = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..", "..");
  const args = parseArgs(process.argv.slice(2));

  const jars = [...args.jars];
  if (args.dir) jars.push(...collectJars(args.dir));
  if (jars.length === 0) throw new Error("no JARs given (--jar or --dir)");

  const keysJson = args.keysJson || path.join(repoRoot, "scripts", "ci", "attest-keys.json");
  const keys = loadKeys(keysJson);

  if (args.verify) {
    let failures = 0;
    for (const jar of jars.sort()) {
      try {
        const fields = verifyJar(jar, keys);
        console.log(`[attest] OK ${path.basename(jar)} build_id=${fields.build_id} key=${fields.key_id}`);
      } catch (err) {
        failures++;
        console.error(`[attest] FAIL ${path.basename(jar)}: ${err.message}`);
      }
    }
    if (failures > 0) throw new Error(`${failures} JAR(s) failed attest verification`);
    console.log(`[attest] ${jars.length}/${jars.length} JARs verified`);
    return;
  }

  const keyId = args.keyId || keys.find((k) => k.active)?.key_id;
  if (!keyId) throw new Error("no active key in attest-keys.json");
  const published = keys.find((k) => k.key_id === keyId);
  if (!published) throw new Error(`key ${keyId} not in attest-keys.json`);

  const privateKey = loadPrivateKey(args);
  const derived = rawPublicFromPrivate(privateKey);
  if (derived !== published.public_key) {
    throw new Error(
      `private key does not match published public key for ${keyId} (check STATUSMOD_ATTEST_KEY)`
    );
  }

  const issuedAt = new Date();
  const dos = dosDateTime(issuedAt);

  for (const jar of jars.sort()) {
    const buf = fs.readFileSync(jar);
    const entries = readZip(buf).filter((e) => e.name !== ATTEST_JSON && e.name !== ATTEST_SIG);

    const buildId = readBuildId(entries);
    const meta = parseBuildId(buildId);

    const classEntries = entries.filter((e) => e.name.endsWith(".class"));
    const resourceEntries = entries.filter((e) => !e.name.endsWith(".class") && !EXCLUDED_FROM_RESOURCES.has(e.name));
    if (classEntries.length === 0) throw new Error(`no classes in ${jar}`);

    const fields = {
      schema: 1,
      build_id: buildId,
      version: meta.version,
      loader: meta.loader,
      minecraft: meta.minecraft,
      classes_sha256: hashEntries(classEntries),
      resources_sha256: hashEntries(resourceEntries),
      key_id: keyId,
      issued_at: issuedAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    };

    const jsonBuf = Buffer.from(canonicalJson(fields), "utf8");
    const sigBuf = crypto.sign(null, jsonBuf, privateKey);

    const attestEntry = {
      name: ATTEST_JSON,
      method: 8,
      time: dos.time,
      date: dos.date,
      data: zlib.deflateRawSync(jsonBuf, { level: 9 }),
      uncompSize: jsonBuf.length,
    };
    attestEntry.crc = crc32(jsonBuf);
    attestEntry.compSize = attestEntry.data.length;

    const sigRaw = Buffer.from(sigBuf.toString("base64"), "utf8");
    const sigEntry = {
      name: ATTEST_SIG,
      method: 0,
      time: dos.time,
      date: dos.date,
      data: sigRaw,
      crc: crc32(sigRaw),
      compSize: sigRaw.length,
      uncompSize: sigRaw.length,
    };

    // MANIFEST.MF bleibt zuerst, Attest-Entries ans Ende.
    const out = [...entries, attestEntry, sigEntry];

    if (!args.dryRun) writeZip(out, jar);
    console.log(
      `[attest] ${args.dryRun ? "(dry-run) " : ""}${path.basename(jar)} build_id=${buildId} key=${keyId}`
    );
  }
}

try {
  main();
} catch (err) {
  console.error(`[attest] ERROR: ${err.message}`);
  process.exit(1);
}
