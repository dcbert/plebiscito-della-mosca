import type { Manifest, Pack } from "./types";

const MAGIC = "BANCpack";

function u64ToDec(view: DataView, offset: number): string {
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  // BANC root IDs fit in 60 bits; use BigInt.
  const v = (BigInt(hi) << 32n) + BigInt(lo);
  return v.toString(10);
}

export function decodePack(buf: ArrayBuffer): Pack {
  const u8 = new Uint8Array(buf);
  const magic = String.fromCharCode(...u8.subarray(0, 8));
  if (magic !== MAGIC) throw new Error(`bad pack magic: ${magic}`);
  const view = new DataView(buf);
  const n = view.getUint32(12, true);
  const nnz = view.getUint32(16, true);
  let o = 20;
  const indptr = new Uint32Array(buf.slice(o, o + (n + 1) * 4));
  o += (n + 1) * 4;
  const indices = new Uint32Array(buf.slice(o, o + nnz * 4));
  o += nnz * 4;
  const weight = new Float32Array(buf.slice(o, o + nnz * 4));
  o += nnz * 4;
  const roots = new BigUint64Array(buf.slice(o, o + n * 8));
  const rootStr: string[] = [];
  const localOf = new Map<string, number>();
  const dv = new DataView(buf);
  for (let i = 0; i < n; i++) {
    const s = u64ToDec(dv, o + i * 8);
    rootStr.push(s);
    localOf.set(s, i);
  }
  o += n * 8;
  const ntSign = new Int8Array(buf.slice(o, o + n));
  o += n;
  const role = new Uint8Array(buf.slice(o, o + n));
  o += n;
  let xyz: Float32Array | undefined;
  if (buf.byteLength >= o + n * 12) {
    xyz = new Float32Array(buf.slice(o, o + n * 12));
  }
  return { n, nnz, indptr, indices, weight, roots, rootStr, ntSign, role, localOf, xyz };
}

export async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const u8 = new Uint8Array(buf);
  if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
    const ds = new DecompressionStream("gzip");
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    return await new Response(stream).arrayBuffer();
  }
  return buf;
}

const IDB_NAME = "plebiscito-della-mosca";
const IDB_STORE = "packs";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheGet(key: string): Promise<ArrayBuffer | null> {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const r = tx.objectStore(IDB_STORE).get(key);
      r.onsuccess = () => resolve((r.result as ArrayBuffer) || null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return null;
  }
}

export async function cachePut(key: string, value: ArrayBuffer): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* private mode */
  }
}

function packCacheKey(packUrl: string, man: Manifest): string {
  return `${packUrl}#n=${man.n}&nnz=${man.nnz}&gz=${man.packBytesGzip ?? 0}`;
}

export async function loadPackAndManifest(
  packUrl: string,
  manifestUrl: string,
): Promise<{ pack: Pack; manifest: Manifest; buffer: ArrayBuffer }> {
  const manRes = await fetch(manifestUrl, { cache: "reload" });
  if (!manRes.ok) throw new Error(`manifest ${manRes.status}`);
  const manifest = (await manRes.json()) as Manifest;
  const key = packCacheKey(packUrl, manifest);
  let raw = await cacheGet(key);
  const stale = (buf: ArrayBuffer) => {
    const p = decodePack(buf);
    return p.n !== manifest.n || p.nnz !== manifest.nnz || !p.xyz;
  };
  if (!raw || stale(raw)) {
    const r = await fetch(packUrl, { cache: "reload" });
    if (!r.ok) throw new Error(`pack ${r.status}`);
    raw = await gunzip(await r.arrayBuffer());
    await cachePut(key, raw);
  }
  return { pack: decodePack(raw), manifest, buffer: raw };
}
