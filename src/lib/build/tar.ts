/** Minimal ustar/GNU tar reader for build artifacts (regular files only; links and devices ignored). */
export interface TarFile { path: string; bytes: Uint8Array }

const dec = new TextDecoder();
const str = (b: Uint8Array) => { const z = b.indexOf(0); return dec.decode(z >= 0 ? b.subarray(0, z) : b); };
const oct = (b: Uint8Array) => parseInt(str(b).trim() || "0", 8);

export function readTar(buf: Uint8Array, limits = { maxFiles: 20_000, maxBytes: 500 * 1024 * 1024 }): TarFile[] {
  const out: TarFile[] = [];
  let off = 0;
  let total = 0;
  let longName: string | null = null;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const size = oct(h.subarray(124, 136));
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("bad tar header");
    const type = String.fromCharCode(h[156] || 48);
    const prefix = str(h.subarray(345, 500));
    let name = longName ?? (prefix ? `${prefix}/${str(h.subarray(0, 100))}` : str(h.subarray(0, 100)));
    longName = null;
    const start = off + 512;
    if (start + size > buf.length) throw new Error("truncated tar");
    const data = buf.subarray(start, start + size);
    off = start + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = str(data); continue; }
    if (type !== "0" && type !== "\0") continue;
    name = name.replace(/^\.\//, "");
    if (!name || name.startsWith("/") || name.split("/").some((p) => p === "..")) continue;
    total += size;
    if (out.length >= limits.maxFiles) throw new Error("too_many_files");
    if (total > limits.maxBytes) throw new Error("too_large");
    out.push({ path: name, bytes: data.slice() });
  }
  return out;
}

/** Minimal ustar writer (regular files only). Paths must be relative without `..`. */
export function writeTar(files: TarFile[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const pad = (n: number) => (512 - (n % 512)) % 512;
  for (const f of files) {
    const name = f.path.replace(/^\.\//, "");
    if (!name || name.startsWith("/") || name.split("/").some((p) => p === "..") || name.length > 100) continue;
    const header = new Uint8Array(512);
    header.set(enc.encode(name).subarray(0, 100), 0);
    header.set(enc.encode("0000644\0"), 100);
    header.set(enc.encode("0000000\0"), 108);
    header.set(enc.encode("0000000\0"), 116);
    header.set(enc.encode(f.bytes.length.toString(8).padStart(11, "0") + "\0"), 124);
    header.set(enc.encode("00000000000\0"), 136);
    header.set(enc.encode("        "), 148);
    header[156] = 48;
    header.set(enc.encode("ustar\0"), 257);
    header.set(enc.encode("00"), 263);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    header.set(enc.encode(sum.toString(8).padStart(6, "0") + "\0 "), 148);
    chunks.push(header);
    chunks.push(f.bytes);
    const p = pad(f.bytes.length);
    if (p) chunks.push(new Uint8Array(p));
  }
  chunks.push(new Uint8Array(1024));
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
