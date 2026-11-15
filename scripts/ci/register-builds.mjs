// Traegt die fertig signierten Release-JARs in die Build-Registry ein.
//
// Jedes JAR enthaelt sein Attest (statusmod-attest.json + .sig). Dieses Skript
// liest beide Entries und POSTet sie an POST /api/builds/register. Das
// Dashboard prueft die Signatur gegen attest_keys und upsertet `builds`.
//
// Damit kann kein Build veroeffentlicht werden, dessen ID nicht in der Registry
// steht: der Workflow laesst diesen Schritt vor Upload/Publish laufen und
// bricht bei einem Fehler ab.
//
// Aufruf (CI):
//   $env:STATUSMOD_BUILD_TOKEN = <Token aus dem GitHub-Secret>
//   node scripts/ci/register-builds.mjs --dir dist/multiversion
//
// Lokal gegen einen Stub:
//   node scripts/ci/register-builds.mjs --dir <verzeichnis> --url http://localhost:3000
//
// Der Token wird nie geloggt.

import path from "node:path";
import { ATTEST_JSON, ATTEST_SIG, collectJars, entryContent, findEntry, readJar } from "./lib/zip.mjs";

const DEFAULT_URL = "https://statusmod-dashboard.vercel.app";
const RETRY_DELAYS_MS = [2000, 6000];
const REQUEST_TIMEOUT_MS = 15000;

function parseArgs(argv) {
  const args = { dir: null, url: DEFAULT_URL, dryRun: false, token: process.env.STATUSMOD_BUILD_TOKEN || "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") args.dir = path.resolve(argv[++i]);
    else if (a === "--url") args.url = argv[++i].replace(/\/+$/, "");
    else if (a === "--token") args.token = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

/** Liest Attest + Signatur aus einem JAR (Header-Format des Mods). */
function readAttest(jarPath) {
  const entries = readJar(jarPath);
  const jsonEntry = findEntry(entries, ATTEST_JSON);
  const sigEntry = findEntry(entries, ATTEST_SIG);
  if (!jsonEntry) throw new Error("statusmod-attest.json missing (JAR not signed?)");
  if (!sigEntry) throw new Error("statusmod-attest.sig missing (JAR not signed?)");

  const jsonBytes = entryContent(jsonEntry);
  let fields;
  try {
    fields = JSON.parse(jsonBytes.toString("utf8"));
  } catch (err) {
    throw new Error(`statusmod-attest.json is not valid JSON: ${err.message}`);
  }
  // Ohne build_id waere die Registry-Zeile wertlos (die ID kommt aus dem
  // Attest, nicht aus dem Dateinamen): frueh und laut abbrechen statt ein
  // "undefined"-Build zu registrieren.
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("statusmod-attest.json is not a JSON object");
  }
  if (typeof fields.build_id !== "string" || fields.build_id.trim() === "") {
    throw new Error("statusmod-attest.json has no build_id");
  }
  return {
    buildId: fields.build_id,
    attest: jsonBytes.toString("base64url"),
    sig: entryContent(sigEntry).toString("utf8").trim(),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 4xx heisst hier fast immer "dein Request ist falsch" (Token abgelaufen,
// Attest ungueltig, Body zu gross) - ein Retry kann das nie reparieren und
// kostet pro JAR nur 8 s. Nur 408/429 sind transient.
function isPermanentStatus(status) {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

async function registerOnce(url, token, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/api/builds/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ attest: payload.attest, sig: payload.sig }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      if (isPermanentStatus(res.status)) err.permanent = true;
      throw err;
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function registerWithRetry(url, token, payload) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await registerOnce(url, token, payload);
    } catch (err) {
      lastError = err;
      if (err.permanent) throw err;
      if (attempt < RETRY_DELAYS_MS.length) {
        console.warn(`[registry] retry ${attempt + 1}/${RETRY_DELAYS_MS.length} after error: ${err.message}`);
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  throw lastError;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) throw new Error("--dir is required");
  if (!args.dryRun && !args.token) {
    throw new Error("STATUSMOD_BUILD_TOKEN not set (or pass --token)");
  }

  const jars = collectJars(args.dir).sort();
  if (jars.length === 0) throw new Error(`no Statusmod-*.jar found in ${args.dir}`);

  const failed = [];
  for (const jar of jars) {
    const name = path.basename(jar);
    let payload;
    try {
      payload = readAttest(jar);
    } catch (err) {
      failed.push(`${name}: ${err.message}`);
      continue;
    }

    if (args.dryRun) {
      console.log(`[registry] (dry-run) ${name} build_id=${payload.buildId}`);
      continue;
    }

    try {
      await registerWithRetry(args.url, args.token, payload);
      console.log(`[registry] ${name} build_id=${payload.buildId} -> ok`);
    } catch (err) {
      failed.push(`${name}: ${err.message}`);
    }
  }

  if (failed.length > 0) {
    for (const f of failed) console.error(`[registry] FAIL ${f}`);
    throw new Error(`${failed.length}/${jars.length} build(s) not registered`);
  }

  console.log(`[registry] ${jars.length}/${jars.length} JARs registered`);
}

try {
  await main();
} catch (err) {
  console.error(`[registry] ERROR: ${err.message}`);
  process.exit(1);
}
