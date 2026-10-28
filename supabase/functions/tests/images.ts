/** Small hand-built images for the photo tests: just enough structure to be what each format's checker looks for. */

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));

export function pngChunk(type: string, data: number[]): number[] {
  const body = new Uint8Array([...text(type), ...data]);
  return [...u32be(data.length), ...body, ...u32be(crc32(body))];
}

/** A PNG with the right chunks (not a drawable picture: the checkers only read structure). */
export function png(width = 2, height = 2, options: { badCrc?: boolean; noEnd?: boolean; firstChunk?: string } = {}): Uint8Array {
  const ihdr = [...u32be(width), ...u32be(height), 8, 2, 0, 0, 0];
  let first = pngChunk(options.firstChunk ?? "IHDR", ihdr);
  if (options.badCrc) first[first.length - 1] ^= 0xFF;
  return new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...first, ...pngChunk("IDAT", [0x78, 0x9C, 0x62, 0x00, 0x00]), ...(options.noEnd ? [] : pngChunk("IEND", []))]);
}

/** A JPEG: SOI, an APP0, a frame header carrying the size, a scan, EOI. */
export function jpeg(width = 2, height = 2, options: { marker?: number; noFrame?: boolean; before?: number[] } = {}): Uint8Array {
  const app0 = [0xFF, 0xE0, 0, 16, ...text("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const dqt = [0xFF, 0xDB, 0, 5, 0, 1, 2];
  const sof = [0xFF, options.marker ?? 0xC0, 0, 11, 8, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 1, 1, 0x11, 0];
  const sos = [0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0x34];
  return new Uint8Array([0xFF, 0xD8, ...app0, ...dqt, ...(options.before ?? []), ...(options.noFrame ? [] : sof), ...sos, 0xFF, 0xD9]);
}

/** A WebP whose first chunk is "VP8X" (extended), "VP8L" (lossless) or "VP8 " (lossy), carrying the size. */
export function webp(kind: "VP8X" | "VP8L" | "VP8 " = "VP8X", width = 2, height = 2, extraBytes = 0): Uint8Array {
  let payload: number[];
  if (kind === "VP8X") payload = [0, 0, 0, 0, (width - 1) & 255, ((width - 1) >> 8) & 255, ((width - 1) >> 16) & 255, (height - 1) & 255, ((height - 1) >> 8) & 255, ((height - 1) >> 16) & 255];
  else if (kind === "VP8L") {
    const w = width - 1;
    const h = height - 1;
    const bits = (w & 0x3FFF) | ((h & 0x3FFF) << 14);
    payload = [0x2F, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >> 24) & 255];
  } else payload = [0x10, 0, 0, 0x9D, 0x01, 0x2A, width & 255, (width >> 8) & 0x3F, height & 255, (height >> 8) & 0x3F];
  if (payload.length % 2) payload.push(0);
  const chunk = [...text(kind), ...u32le(payload.length), ...payload];
  // optionally a second chunk, so the file (and its RIFF size) is as long as a real picture's
  const more = extraBytes ? [...text("JUNK"), ...u32le(extraBytes), ...new Array(extraBytes).fill(0)] : [];
  return new Uint8Array([...text("RIFF"), ...u32le(4 + chunk.length + more.length), ...text("WEBP"), ...chunk, ...more]);
}
