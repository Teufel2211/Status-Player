// Minimaler ZIP-Leser fuer die CI-Skripte.
//
// Die Release-JARs werden nie neu gepackt (siehe sign-build.mjs), deshalb
// reicht Lesen: zentrale Verzeichnis-Struktur durchlaufen, pro Entry die
// komprimierten Rohdaten zurueckgeben. Kein zip64, keine Verschluesselung -
// beides kommt in unseren JARs nicht vor.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const ATTEST_JSON = "statusmod-attest.json";
export const ATTEST_SIG = "statusmod-attest.sig";

export function readZip(buf) {
  let eocd = -1;
  const minStart = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip (no EOCD)");

  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error("zip64 not supported");

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory at " + p);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const time = buf.readUInt16LE(p + 12);
    const date = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    if (localOff === 0xffffffff) throw new Error("zip64 not supported: " + name);
    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error("bad local header: " + name);
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);

    entries.push({ name, flags, method, time, date, crc, compSize, uncompSize, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readJar(jarPath) {
  return readZip(fs.readFileSync(jarPath));
}

/** Entpackt den Inhalt eines Entries (method 0 = stored, 8 = deflate). */
export function entryContent(entry) {
  if (entry.method === 0) return entry.data;
  if (entry.method === 8) return zlib.inflateRawSync(entry.data);
  throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`);
}

export function findEntry(entries, name) {
  return entries.find((e) => e.name === name);
}

/** Sammelt rekursiv alle JARs, deren Dateiname dem Muster entspricht. */
export function collectJars(dir, pattern = /^Statusmod-.+\.jar$/i) {
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...collectJars(p, pattern));
    else if (item.isFile() && pattern.test(item.name)) out.push(p);
  }
  return out;
}
