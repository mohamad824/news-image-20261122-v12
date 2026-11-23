// news-image-20261122 v12 — "Sunday 22 November 2026" — one-page world news broadsheet.
// Original code written for this entry. Renders 1024x1024 PNG to /output/entry.png.
// Self-contained: TrueType parser + rasterizer + PNG encoder, Node stdlib only, no network.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const W = 1024, H = 1024;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(process.env.MAKEFUN_OUTPUT_DIR || "/output", "entry.png");

// ---------- palette (v12 "best colours": calm cream + black ink + newspaper red + dark navy;
// saturation concentrated in atmospheric illustrations, never a rainbow per card) ----------
const CREAM = [246, 238, 220];
const CREAM2 = [238, 228, 203];
const INK = [16, 14, 12];
const RED = [200, 16, 46];
const RED_DK = [160, 12, 36];
const NAVY = [11, 16, 32];
const NAVY2 = [27, 42, 74];
const PAPER = [250, 244, 230];
const GOLD = [242, 194, 48];
const ORANGE = [232, 106, 28];
const CREAM_TXT = [246, 238, 220];
const MUTED_LINE = [120, 105, 80];
const OLIVE = [122, 139, 111];
const TERRA = [196, 112, 74];
const TEAL = [46, 107, 107];
const DUSK = [232, 220, 200];
const SAND = [214, 196, 158];

// ---------- tiny helpers ----------
type RGB = [number, number, number];
function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------- CRC32 + PNG ----------
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(rgb: Uint8ClampedArray, w: number, h: number): Buffer {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 3, d = y * (1 + w * 3) + 1 + x * 3;
      raw[d] = rgb[s]; raw[d + 1] = rgb[s + 1]; raw[d + 2] = rgb[s + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- TrueType parsing ----------
interface Pt { x: number; y: number; on: boolean }
interface Font {
  name: string; buf: Buffer; unitsPerEm: number; numGlyphs: number;
  cmap: Map<number, number>; loca: Uint32Array; glyfOff: number;
  advances: Uint16Array; indexToLoc: number; numHMetrics: number;
}
function u16(b: Buffer, o: number): number { return b.readUInt16BE(o); }
function i16(b: Buffer, o: number): number { return b.readInt16BE(o); }
function u32(b: Buffer, o: number): number { return b.readUInt32BE(o); }
function i32(b: Buffer, o: number): number { return b.readInt32BE(o); }

function loadFont(name: string, path: string): Font {
  const buf = readFileSync(path);
  const numTables = u16(buf, 4);
  const tables = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables.set(buf.toString("ascii", o, o + 4), u32(buf, o + 8));
  }
  const need = ["head", "maxp", "hhea", "hmtx", "cmap", "loca", "glyf"];
  for (const t of need) if (!tables.has(t)) throw new Error(`font ${name} missing table ${t}`);
  const head = tables.get("head")!, maxp = tables.get("maxp")!, hhea = tables.get("hhea")!;
  const unitsPerEm = u16(buf, head + 18);
  const indexToLoc = i16(buf, head + 50);
  const numGlyphs = u16(buf, maxp + 4);
  const numHMetrics = u16(buf, hhea + 34);
  const hmtx = tables.get("hmtx")!;
  const advances = new Uint16Array(numGlyphs);
  for (let i = 0; i < numGlyphs; i++) advances[i] = i < numHMetrics ? u16(buf, hmtx + i * 4) : u16(buf, hmtx + (numHMetrics - 1) * 4);
  // cmap: prefer format 12, else format 4
  const cmapOff = tables.get("cmap")!;
  const cmap = new Map<number, number>();
  const nSub = u16(buf, cmapOff + 2);
  let fmt12 = -1, fmt4 = -1;
  for (let i = 0; i < nSub; i++) {
    const rec = cmapOff + 4 + i * 8;
    const sub = cmapOff + u32(buf, rec + 4);
    const fmt = u16(buf, sub);
    if (fmt === 12) fmt12 = sub; else if (fmt === 4) fmt4 = sub;
  }
  if (fmt12 >= 0) {
    const n = u32(buf, fmt12 + 12);
    for (let i = 0; i < n; i++) {
      const o = fmt12 + 16 + i * 12;
      const s = u32(buf, o), e = u32(buf, o + 4), g = u32(buf, o + 8);
      for (let cp = s; cp <= e; cp++) cmap.set(cp, g + (cp - s));
    }
  } else if (fmt4 >= 0) {
    const segCount = u16(buf, fmt4 + 6) / 2;
    const endOff = fmt4 + 14, startOff = endOff + segCount * 2 + 2, deltaOff = startOff + segCount * 2, rangeOff = deltaOff + segCount * 2;
    for (let i = 0; i < segCount; i++) {
      const end = u16(buf, endOff + i * 2), start = u16(buf, startOff + i * 2);
      const delta = i16(buf, deltaOff + i * 2), range = u16(buf, rangeOff + i * 2);
      for (let cp = start; cp <= end; cp++) {
        if (cp === 0xffff) break;
        let g: number;
        if (range === 0) g = (cp + delta) & 0xffff;
        else {
          const gi = rangeOff + i * 2 + range + (cp - start) * 2;
          g = u16(buf, gi); if (g !== 0) g = (g + delta) & 0xffff;
        }
        cmap.set(cp, g);
      }
    }
  } else throw new Error(`font ${name}: no cmap 4/12`);
  const locaOff = tables.get("loca")!;
  const loca = new Uint32Array(numGlyphs + 1);
  for (let i = 0; i <= numGlyphs; i++) loca[i] = indexToLoc === 0 ? u16(buf, locaOff + i * 2) * 2 : u32(buf, locaOff + i * 4);
  return { name, buf, unitsPerEm, numGlyphs, cmap, loca, glyfOff: tables.get("glyf")!, advances, indexToLoc, numHMetrics };
}

function glyphContours(f: Font, gid: number, depth: number): Pt[][] {
  if (gid >= f.numGlyphs || f.loca[gid] === f.loca[gid + 1]) return [];
  const b = f.buf, o = f.glyfOff + f.loca[gid];
  const nCont = i16(b, o);
  if (nCont >= 0) {
    const endPtsOff = o + 10;
    const nPts = nCont === 0 ? 0 : u16(b, endPtsOff + (nCont - 1) * 2) + 1;
    const instrOff = endPtsOff + nCont * 2;
    const instrLen = u16(b, instrOff);
    let p = instrOff + 2 + instrLen;
    const flags: number[] = [];
    while (flags.length < nPts) {
      const fl = b[p++];
      flags.push(fl);
      if (fl & 8) { const rep = b[p++]; for (let i = 0; i < rep; i++) flags.push(fl); }
    }
    const xs: number[] = new Array(nPts); const ys: number[] = new Array(nPts);
    let x = 0;
    for (let i = 0; i < nPts; i++) {
      const fl = flags[i];
      if (fl & 2) { const d = b[p++]; x += (fl & 16) ? d : -d; }
      else if (!(fl & 16)) { x += i16(b, p); p += 2; }
      xs[i] = x;
    }
    let y = 0;
    for (let i = 0; i < nPts; i++) {
      const fl = flags[i];
      if (fl & 4) { const d = b[p++]; y += (fl & 32) ? d : -d; }
      else if (!(fl & 32)) { y += i16(b, p); p += 2; }
      ys[i] = y;
    }
    const contours: Pt[][] = [];
    let start = 0;
    for (let c = 0; c < nCont; c++) {
      const end = u16(b, endPtsOff + c * 2);
      const pts: Pt[] = [];
      for (let i = start; i <= end; i++) pts.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
      contours.push(pts);
      start = end + 1;
    }
    return contours;
  }
  // composite glyph
  if (depth > 4) return [];
  const contours: Pt[][] = [];
  let p = o + 10;
  for (;;) {
    const flags = u16(b, p); const comp = u16(b, p + 2); p += 4;
    let dx = 0, dy = 0;
    if (flags & 1) { dx = i16(b, p); dy = i16(b, p + 2); p += 4; }
    else { dx = i8(b, p); dy = i8(b, p + 1); p += 2; }
    let a = 1, bb = 0, cc = 0, d = 1;
    if (flags & 8) { a = f2dot14(b, p); d = a; p += 2; }
    else if (flags & 64) { a = f2dot14(b, p); bb = f2dot14(b, p + 2); p += 4; }
    else if (flags & 128) { a = f2dot14(b, p); bb = f2dot14(b, p + 2); cc = f2dot14(b, p + 4); d = f2dot14(b, p + 6); p += 8; }
    const sub = glyphContours(f, comp, depth + 1);
    for (const cn of sub) contours.push(cn.map(pt => ({ x: pt.x * a + pt.y * cc + dx, y: pt.x * bb + pt.y * d + dy, on: pt.on })));
    if (!(flags & 32)) break;
  }
  return contours;
}
function i8(b: Buffer, o: number): number { const v = b[o]; return v > 127 ? v - 256 : v; }
function f2dot14(b: Buffer, o: number): number { return i16(b, o) / 16384; }

// Flatten one contour (quadratic splines) to a polyline in font units.
function flatten(contour: Pt[]): { x: number; y: number }[] {
  if (contour.length === 0) return [];
  // Expand implied on-curve midpoints between consecutive off-curve points (incl. wrap).
  const n = contour.length;
  const seq: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const cur = contour[i];
    const nxt = contour[(i + 1) % n];
    seq.push(cur);
    if (!cur.on && !nxt.on) seq.push({ x: (cur.x + nxt.x) / 2, y: (cur.y + nxt.y) / 2, on: true });
  }
  // Rotate so sequence starts on an on-curve point, then append the start point to close it.
  let start = 0;
  while (start < seq.length && !seq[start].on) start++;
  if (start >= seq.length) return [];
  const rot = seq.slice(start).concat(seq.slice(0, start));
  rot.push(rot[0]);
  const out: { x: number; y: number }[] = [{ x: rot[0].x, y: rot[0].y }];
  let i = 0;
  while (i < rot.length - 1) {
    const cur = rot[i];
    const nxt = rot[i + 1];
    if (nxt.on) { out.push({ x: nxt.x, y: nxt.y }); i++; }
    else {
      const end = rot[i + 2];
      const steps = 10;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps, mt = 1 - t;
        out.push({ x: mt * mt * cur.x + 2 * mt * t * nxt.x + t * t * end.x, y: mt * mt * cur.y + 2 * mt * t * nxt.y + t * t * end.y });
      }
      i += 2;
    }
  }
  return out;
}

// ---------- glyph rasterization (2x supersampled, non-zero winding) ----------
interface GlyphBmp { w: number; h: number; x0: number; y0: number; data: Uint8Array }
const glyphCache = new Map<string, GlyphBmp>();
const missingGlyphs = new Set<string>();
function rasterizeGlyph(f: Font, cp: number, size: number): GlyphBmp {
  const key = `${f.name}|${cp}|${size}`;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const gid = f.cmap.get(cp);
  const scale = size / f.unitsPerEm;
  if (gid === undefined || gid === 0) {
    if (gid === undefined && !missingGlyphs.has(`${f.name}:${cp}`)) {
      missingGlyphs.add(`${f.name}:${cp}`);
      console.error(`MISSING GLYPH U+${cp.toString(16).toUpperCase()} in ${f.name}`);
    }
    const empty: GlyphBmp = { w: 0, h: 0, x0: 0, y0: 0, data: new Uint8Array(0) };
    glyphCache.set(key, empty);
    return empty;
  }
  const contours = glyphContours(f, gid, 0);
  const polys = contours.map(c => flatten(c).map(p => ({ x: p.x * scale, y: -p.y * scale })));
  // bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const poly of polys) for (const p of poly) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) { const e: GlyphBmp = { w: 0, h: 0, x0: 0, y0: 0, data: new Uint8Array(0) }; glyphCache.set(key, e); return e; }
  const SS = 2;
  const x0 = Math.floor(minX), x1 = Math.ceil(maxX), y0 = Math.floor(minY), y1 = Math.ceil(maxY);
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const data = new Uint8Array(w * h);
  // edges
  const edges: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (a.y !== b.y) edges.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
    }
  }
  for (let sy = 0; sy < h * SS; sy++) {
    const y = y0 + (sy + 0.5) / SS;
    const xs: { x: number; dir: number }[] = [];
    for (const e of edges) {
      if ((y >= Math.min(e.y0, e.y1)) && (y < Math.max(e.y0, e.y1))) {
        const t = (y - e.y0) / (e.y1 - e.y0);
        xs.push({ x: e.x0 + t * (e.x1 - e.x0), dir: e.y1 > e.y0 ? 1 : -1 });
      }
    }
    if (xs.length === 0) continue;
    xs.sort((a, b) => a.x - b.x);
    let winding = 0;
    for (let i = 0; i < xs.length; i++) {
      winding += xs[i].dir;
      const nextX = i + 1 < xs.length ? xs[i + 1].x : xs[i].x;
      if (winding !== 0) {
        const xa = Math.max(xs[i].x, x0), xb = Math.min(nextX, x1);
        for (let sx = Math.floor(xa * SS); sx < Math.ceil(xb * SS); sx++) {
          const px = sx / SS;
          if (px >= xa && px < xb) {
            const gx = Math.floor(px - x0), gy = Math.floor(y - y0);
            if (gx >= 0 && gx < w && gy >= 0 && gy < h) data[gy * w + gx]++;
          }
        }
      }
    }
  }
  const bmp: GlyphBmp = { w, h, x0, y0, data };
  glyphCache.set(key, bmp);
  return bmp;
}
function glyphAdvance(f: Font, cp: number, size: number): number {
  const gid = f.cmap.get(cp);
  if (gid === undefined) return size * 0.5;
  return (f.advances[gid] / f.unitsPerEm) * size;
}
function textWidth(f: Font, text: string, size: number, tracking = 0): number {
  let w = 0;
  for (const ch of text) { w += glyphAdvance(f, ch.codePointAt(0)!, size) + tracking; }
  return w - (text.length > 0 ? tracking : 0);
}

// ---------- fonts ----------
const F = {
  playBlack: loadFont("Playfair-Black", join(HERE, "fonts", "PlayfairDisplay-Black.ttf")),
  playBold: loadFont("Playfair-Bold", join(HERE, "fonts", "PlayfairDisplay-Bold.ttf")),
  barSemi: loadFont("Barlow-SemiBold", join(HERE, "fonts", "BarlowCondensed-SemiBold.ttf")),
  barReg: loadFont("Barlow-Regular", join(HERE, "fonts", "BarlowCondensed-Regular.ttf")),
  barBold: loadFont("Barlow-Bold", join(HERE, "fonts", "BarlowCondensed-Bold.ttf")),
  barMed: loadFont("Barlow-Medium", join(HERE, "fonts", "BarlowCondensed-Medium.ttf")),
};

// ---------- canvas ----------
interface Clip { x0: number; y0: number; x1: number; y1: number }
class Canvas {
  data = new Uint8ClampedArray(W * H * 3);
  clip: Clip = { x0: 0, y0: 0, x1: W, y1: H };
  clipStack: Clip[] = [];
  constructor() { this.fill(CREAM); }
  fill(c: RGB) { for (let i = 0; i < W * H; i++) { this.data[i * 3] = c[0]; this.data[i * 3 + 1] = c[1]; this.data[i * 3 + 2] = c[2]; } }
  setClip(x: number, y: number, w: number, h: number) {
    this.clipStack.push(this.clip);
    const c = this.clip;
    this.clip = { x0: Math.max(c.x0, Math.floor(x)), y0: Math.max(c.y0, Math.floor(y)), x1: Math.min(c.x1, Math.ceil(x + w)), y1: Math.min(c.y1, Math.ceil(y + h)) };
  }
  resetClip() { const c = this.clipStack.pop(); if (c) this.clip = c; }
  px(x: number, y: number, c: RGB, a: number) {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < this.clip.x0 || xi >= this.clip.x1 || yi < this.clip.y0 || yi >= this.clip.y1) return;
    const i = (yi * W + xi) * 3;
    const ia = 1 - a;
    this.data[i] = Math.round(c[0] * a + this.data[i] * ia);
    this.data[i + 1] = Math.round(c[1] * a + this.data[i + 1] * ia);
    this.data[i + 2] = Math.round(c[2] * a + this.data[i + 2] * ia);
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1) {
    const x0 = Math.max(Math.floor(x), this.clip.x0), y0 = Math.max(Math.floor(y), this.clip.y0);
    const x1 = Math.min(Math.ceil(x + w), this.clip.x1), y1 = Math.min(Math.ceil(y + h), this.clip.y1);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.px(xx, yy, c, a);
  }
  // Sutherland–Hodgman clip of a polygon to a rect
  clipPoly(poly: { x: number; y: number }[], r: Clip): { x: number; y: number }[] {
    let out = poly;
    const clipEdge = (pts: { x: number; y: number }[], inside: (p: { x: number; y: number }) => boolean, inter: (a: { x: number; y: number }, b: { x: number; y: number }) => { x: number; y: number }) => {
      const res: { x: number; y: number }[] = [];
      for (let i = 0; i < pts.length; i++) {
        const cur = pts[i], prev = pts[(i + pts.length - 1) % pts.length];
        const ci = inside(cur), pi = inside(prev);
        if (ci) { if (!pi) res.push(inter(prev, cur)); res.push(cur); }
        else if (pi) res.push(inter(prev, cur));
      }
      return res;
    };
    out = clipEdge(out, p => p.x >= r.x0, (a, b) => ({ x: r.x0, y: a.y + (b.y - a.y) * (r.x0 - a.x) / (b.x - a.x || 1e-9) }));
    out = clipEdge(out, p => p.x < r.x1, (a, b) => ({ x: r.x1, y: a.y + (b.y - a.y) * (r.x1 - a.x) / (b.x - a.x || 1e-9) }));
    out = clipEdge(out, p => p.y >= r.y0, (a, b) => ({ x: a.x + (b.x - a.x) * (r.y0 - a.y) / (b.y - a.y || 1e-9), y: r.y0 }));
    out = clipEdge(out, p => p.y < r.y1, (a, b) => ({ x: a.x + (b.x - a.x) * (r.y1 - a.y) / (b.y - a.y || 1e-9), y: r.y1 }));
    return out;
  }
  poly(poly: { x: number; y: number }[], c: RGB, a = 1) {
    if (poly.length < 3) return;
    const cp = this.clipPoly(poly, this.clip);
    if (cp.length < 3) return;
    let minY = Infinity, maxY = -Infinity;
    for (const p of cp) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
    for (let y = Math.max(Math.floor(minY), this.clip.y0); y < Math.min(Math.ceil(maxY), this.clip.y1); y++) {
      const yc = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < cp.length; i++) {
        const p0 = cp[i], p1 = cp[(i + 1) % cp.length];
        if ((yc >= Math.min(p0.y, p1.y)) && (yc < Math.max(p0.y, p1.y))) {
          xs.push(p0.x + (yc - p0.y) * (p1.x - p0.x) / (p1.y - p0.y));
        }
      }
      xs.sort((x, y) => x - y);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xa = Math.max(Math.ceil(xs[i]), this.clip.x0), xb = Math.min(Math.floor(xs[i + 1]), this.clip.x1);
        for (let x = xa; x < xb; x++) this.px(x, y, c, a);
      }
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, w = 1) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len * w / 2, ny = dx / len * w / 2;
    this.poly([{ x: x0 + nx, y: y0 + ny }, { x: x1 + nx, y: y1 + ny }, { x: x1 - nx, y: y1 - ny }, { x: x0 - nx, y: y0 - ny }], c);
  }
  circle(cx: number, cy: number, r: number, c: RGB, a = 1) {
    const pts: { x: number; y: number }[] = [];
    const n = 28;
    for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; pts.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r }); }
    this.poly(pts, c, a);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1) {
    const pts: { x: number; y: number }[] = [];
    const n = 28;
    for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; pts.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry }); }
    this.poly(pts, c, a);
  }
  ring(cx: number, cy: number, r: number, c: RGB, w = 1.5) {
    const pts: { x: number; y: number }[] = [];
    const n = 28;
    for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; pts.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r }); }
    for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; pts.push({ x: cx + Math.cos(t) * (r - w), y: cy + Math.sin(t) * (r - w) }); }
    // draw as polyline of small segments
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      this.line(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, c, w);
    }
  }
  rrect(x: number, y: number, w: number, h: number, r: number, c: RGB, a = 1) {
    this.rect(x + r, y, w - 2 * r, h, c, a);
    this.rect(x, y + r, w, h - 2 * r, c, a);
    this.circle(x + r, y + r, r, c, a); this.circle(x + w - r, y + r, r, c, a);
    this.circle(x + r, y + h - r, r, c, a); this.circle(x + w - r, y + h - r, r, c, a);
  }
  strokeRect(x: number, y: number, w: number, h: number, c: RGB, t = 1.5) {
    this.rect(x, y, w, t, c); this.rect(x, y + h - t, w, t, c);
    this.rect(x, y, t, h, c); this.rect(x + w - t, y, t, h, c);
  }
  // blit a rasterized glyph bitmap at baseline (bx, baselineY)
  blit(bmp: GlyphBmp, bx: number, baselineY: number, c: RGB) {
    for (let gy = 0; gy < bmp.h; gy++) {
      for (let gx = 0; gx < bmp.w; gx++) {
        const cov = bmp.data[gy * bmp.w + gx];
        if (cov === 0) continue;
        this.px(bx + bmp.x0 + gx, baselineY + bmp.y0 + gy, c, cov / 4);
      }
    }
  }
  text(str: string, x: number, baselineY: number, f: Font, size: number, c: RGB, tracking = 0, align: "left" | "center" | "right" = "left"): number {
    const w = textWidth(f, str, size, tracking);
    let bx = x;
    if (align === "center") bx = x - w / 2;
    else if (align === "right") bx = x - w;
    let cx = bx;
    for (const ch of str) {
      const cp = ch.codePointAt(0)!;
      const bmp = rasterizeGlyph(f, cp, size);
      this.blit(bmp, Math.round(cx), Math.round(baselineY), c);
      cx += glyphAdvance(f, cp, size) + tracking;
    }
    return w;
  }
  // wrap text into lines that fit maxWidth; returns lines (no truncation)
  wrap(str: string, f: Font, size: number, maxWidth: number, tracking = 0): string[] {
    const words = str.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const wd of words) {
      const trial = cur === "" ? wd : cur + " " + wd;
      if (textWidth(f, trial, size, tracking) <= maxWidth || cur === "") cur = trial;
      else { lines.push(cur); cur = wd; }
    }
    if (cur !== "") lines.push(cur);
    return lines;
  }
  // draw wrapped block; returns y after last line (baseline of next line would be y+lh)
  textBlock(str: string, x: number, topY: number, f: Font, size: number, c: RGB, maxWidth: number, lh: number, maxLines = 99, tracking = 0): number {
    const lines = this.wrap(str, f, size, maxWidth, tracking);
    const n = Math.min(lines.length, maxLines);
    for (let i = 0; i < n; i++) this.text(lines[i], x, topY + i * lh + size * 0.78, f, size, c, tracking);
    return topY + n * lh;
  }
  // deterministic fine grain over a rect (subtle paper texture)
  grain(x: number, y: number, w: number, h: number, seed: number, n: number) {
    const rnd = lcg(seed);
    for (let i = 0; i < n; i++) {
      const gx = x + rnd() * w, gy = y + rnd() * h;
      this.px(gx, gy, rnd() > 0.5 ? [0, 0, 0] : [255, 255, 255], 0.05);
    }
  }
}

// ---------- illustration helpers ----------
function stars(cv: Canvas, x: number, y: number, w: number, h: number, seed: number, n: number) {
  const rnd = lcg(seed);
  for (let i = 0; i < n; i++) {
    const sx = x + rnd() * w, sy = y + rnd() * h * 0.7;
    cv.circle(sx, sy, 0.9 + rnd() * 0.8, [250, 244, 220], 0.9);
  }
}
function smoke(cv: Canvas, cx: number, cy: number, s: number, col: RGB = [90, 88, 84]) {
  cv.circle(cx, cy, 5 * s, col, 0.85); cv.circle(cx + 6 * s, cy - 4 * s, 4 * s, col, 0.8);
  cv.circle(cx - 6 * s, cy - 3 * s, 3.5 * s, col, 0.8); cv.circle(cx + 2 * s, cy - 8 * s, 3 * s, col, 0.75);
}
function flame(cv: Canvas, cx: number, cy: number, s: number) {
  cv.poly([{ x: cx - 5 * s, y: cy }, { x: cx - 2 * s, y: cy - 7 * s }, { x: cx, y: cy - 3 * s }, { x: cx + 2 * s, y: cy - 8 * s }, { x: cx + 5 * s, y: cy }], ORANGE);
  cv.poly([{ x: cx - 2.5 * s, y: cy }, { x: cx - 1 * s, y: cy - 4 * s }, { x: cx + 1 * s, y: cy - 4 * s }, { x: cx + 2.5 * s, y: cy }], GOLD);
}
function litWin(cv: Canvas, x: number, y: number, w: number, h: number) { cv.rect(x, y, w, h, GOLD); }
function person(cv: Canvas, x: number, y: number, s: number, shirt: RGB, skin: RGB = [214, 178, 140]) {
  cv.circle(x, y - 6 * s, 3.4 * s, skin);
  cv.poly([{ x: x - 5 * s, y: y + 8 * s }, { x: x - 4 * s, y: y - 2 * s }, { x: x + 4 * s, y: y - 2 * s }, { x: x + 5 * s, y: y + 8 * s }], shirt);
}
function begin(cv: Canvas, x: number, y: number, w: number, h: number, bg: RGB) {
  cv.rect(x, y, w, h, bg);
  cv.setClip(x, y, w, h);
}
function end(cv: Canvas) { cv.resetClip(); }

// ---------- lead illustrations ----------
function sceneCOP31(cv: Canvas, x: number, y: number, w: number, h: number) {
  begin(cv, x, y, w, h, [227, 211, 179]);
  // hall wall + floor
  cv.rect(x, y + h * 0.72, w, h * 0.28, [178, 152, 112]);
  // globe on pedestal (left)
  cv.rect(x + w * 0.05, y + h * 0.52, w * 0.09, h * 0.2, [120, 96, 66]);
  cv.circle(x + w * 0.095, y + h * 0.38, w * 0.055, [46, 107, 107]);
  cv.circle(x + w * 0.08, y + h * 0.36, w * 0.02, OLIVE); cv.circle(x + w * 0.115, y + h * 0.42, w * 0.018, OLIVE);
  // wall clock (right)
  cv.circle(x + w * 0.88, y + h * 0.24, w * 0.055, PAPER);
  cv.ring(x + w * 0.88, y + h * 0.24, w * 0.055, INK, 1.5);
  cv.line(x + w * 0.88, y + h * 0.24, x + w * 0.88, y + h * 0.19, INK, 1.5);
  cv.line(x + w * 0.88, y + h * 0.24, x + w * 0.905, y + h * 0.26, INK, 1.5);
  // NO DEAL sign (big red placard on the wall)
  cv.rect(x + w * 0.30, y + h * 0.10, w * 0.40, h * 0.22, RED);
  cv.text("NO DEAL", x + w * 0.50, y + h * 0.27, F.barBold, Math.round(h * 0.17), PAPER, 0.5, "center");
  // long conference table
  cv.rect(x + w * 0.08, y + h * 0.62, w * 0.84, h * 0.10, [138, 107, 74]);
  cv.rect(x + w * 0.08, y + h * 0.72, w * 0.84, h * 0.03, [110, 84, 56]);
  // five delegates behind the table
  const shirts: RGB[] = [[46, 107, 107], [196, 112, 74], [122, 139, 111], [27, 42, 74], [168, 130, 63]];
  for (let i = 0; i < 5; i++) {
    const dx = x + w * (0.17 + i * 0.16);
    person(cv, dx, y + h * 0.62, 1.15, shirts[i]);
    // name plates + papers on the table
    cv.rect(dx - w * 0.035, y + h * 0.665, w * 0.07, h * 0.035, PAPER);
  }
  end(cv);
}
function sceneDymer(cv: Canvas, x: number, y: number, w: number, h: number) {
  begin(cv, x, y, w, h, DUSK);
  // dusk sun + smoke
  cv.circle(x + w * 0.86, y + h * 0.18, w * 0.05, GOLD);
  smoke(cv, x + w * 0.62, y + h * 0.20, 1.1);
  // damaged 5-storey apartment block
  const bx = x + w * 0.08, by = y + h * 0.24, bw = w * 0.52, bh = h * 0.62;
  cv.poly([{ x: bx, y: by + bh }, { x: bx, y: by }, { x: bx + bw * 0.72, y: by }, { x: bx + bw * 0.55, y: by + bh * 0.22 }, { x: bx + bw, y: by + bh * 0.34 }, { x: bx + bw, y: by + bh }, { x: bx, y: by + bh }], [176, 160, 130]);
  cv.line(bx, by + bh, bx + bw, by + bh, INK, 1.5);
  // windows: 5 floors x 3, some lit, some dark/broken
  for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
    const wx = bx + bw * (0.10 + c * 0.30), wy = by + bh * (0.06 + r * 0.18);
    if ((r === 1 && c === 1) || (r === 3 && c === 0)) litWin(cv, wx, wy, bw * 0.16, bh * 0.10);
    else if (r === 0 && c === 2) cv.rect(wx, wy, bw * 0.16, bh * 0.10, [40, 36, 32]);
    else cv.rect(wx, wy, bw * 0.16, bh * 0.10, [74, 70, 64]);
  }
  // rubble pile at the broken corner
  cv.poly([{ x: bx + bw * 0.42, y: by + bh }, { x: bx + bw * 0.62, y: by + bh * 0.62 }, { x: bx + bw * 0.86, y: by + bh * 0.78 }, { x: bx + bw * 1.0, y: by + bh }, { x: bx + bw * 0.42, y: by + bh }], [140, 122, 96]);
  cv.poly([{ x: bx + bw * 0.55, y: by + bh * 0.72 }, { x: bx + bw * 0.68, y: by + bh * 0.62 }, { x: bx + bw * 0.78, y: by + bh * 0.74 }, { x: bx + bw * 0.62, y: by + bh * 0.82 }], [110, 94, 72]);
  // red rescue ladder leaning on the block
  cv.line(bx + bw * 0.78, by + bh, bx + bw * 0.60, by + bh * 0.30, RED, 3);
  cv.line(bx + bw * 0.88, by + bh, bx + bw * 0.70, by + bh * 0.30, RED, 3);
  for (let i = 0; i < 4; i++) {
    const t = 0.2 + i * 0.2;
    cv.line(bx + bw * (0.78 - 0.18 * t), by + bh * (1 - 0.7 * t), bx + bw * (0.88 - 0.18 * t), by + bh * (1 - 0.7 * t), RED, 1.5);
  }
  end(cv);
}
function sceneBahrain(cv: Canvas, x: number, y: number, w: number, h: number) {
  begin(cv, x, y, w, h, NAVY2);
  stars(cv, x, y, w, h, 42, 14);
  cv.circle(x + w * 0.88, y + h * 0.16, w * 0.045, GOLD);
  // control room block (bottom)
  cv.rect(x + w * 0.55, y + h * 0.74, w * 0.42, h * 0.26, [16, 20, 36]);
  for (let i = 0; i < 4; i++) litWin(cv, x + w * (0.58 + i * 0.09), y + h * 0.79, w * 0.05, h * 0.07);
  cv.rect(x + w * 0.55, y + h * 0.74, w * 0.42, h * 0.02, RED);
  // BIG radar dish (left): tilted parabolic dish — rotated ellipse + mast + feed horn
  const dx = x + w * 0.30, dy = y + h * 0.52;
  const dishPts = (rx: number, ry: number, ang: number): { x: number; y: number }[] => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      const px = Math.cos(t) * rx, py = Math.sin(t) * ry;
      pts.push({ x: dx + px * Math.cos(ang) - py * Math.sin(ang), y: dy + px * Math.sin(ang) + py * Math.cos(ang) });
    }
    return pts;
  };
  cv.poly(dishPts(w * 0.21, h * 0.085, -0.55), [120, 124, 132]);
  cv.poly(dishPts(w * 0.19, h * 0.07, -0.55), [226, 228, 232]);
  cv.line(dx - w * 0.06, dy + h * 0.10, dx - w * 0.02, dy + h * 0.24, [200, 202, 208], 4);
  cv.line(dx - w * 0.07, dy + h * 0.24, dx + w * 0.03, dy + h * 0.24, [200, 202, 208], 4);
  // feed arm + horn, then straight beams from the horn (never curved)
  cv.line(dx, dy, dx + w * 0.10, dy - h * 0.16, [200, 202, 208], 2.5);
  cv.circle(dx + w * 0.10, dy - h * 0.16, w * 0.018, GOLD);
  cv.line(dx + w * 0.10, dy - h * 0.16, dx + w * 0.38, dy - h * 0.44, GOLD, 2);
  cv.line(dx + w * 0.10, dy - h * 0.16, dx + w * 0.16, dy - h * 0.48, GOLD, 2);
  cv.line(dx + w * 0.10, dy - h * 0.16, dx - w * 0.06, dy - h * 0.44, GOLD, 2);
  // second smaller dish (right), same tilted-ellipse construction
  const ex = x + w * 0.72, ey = y + h * 0.60;
  const dish2Pts = (rx: number, ry: number, ang: number): { x: number; y: number }[] => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = (i / 20) * Math.PI * 2;
      const px = Math.cos(t) * rx, py = Math.sin(t) * ry;
      pts.push({ x: ex + px * Math.cos(ang) - py * Math.sin(ang), y: ey + px * Math.sin(ang) + py * Math.cos(ang) });
    }
    return pts;
  };
  cv.poly(dish2Pts(w * 0.12, h * 0.05, -0.55), [200, 202, 208]);
  cv.line(ex - w * 0.03, ey + h * 0.05, ex - w * 0.01, ey + h * 0.15, [200, 202, 208], 3);
  // orange impact glow on the horizon
  flame(cv, x + w * 0.52, y + h * 0.76, 1.0);
  end(cv);
}

// ---------- grid illustrations ----------
function sceneSparta(cv: Canvas, x: number, y: number, w: number, h: number) {
  begin(cv, x, y, w, h, DUSK);
  cv.rect(x, y + h * 0.58, w, h * 0.42, TEAL);
  cv.line(x, y + h * 0.62, x + w, y + h * 0.60, [255, 255, 255], 1);
  cv.line(x + w * 0.1, y + h * 0.78, x + w * 0.5, y + h * 0.76, [255, 255, 255], 1);
  // cargo ship hull + containers
  cv.poly([{ x: x + w * 0.08, y: y + h * 0.52 }, { x: x + w * 0.92, y: y + h * 0.52 }, { x: x + w * 0.86, y: y + h * 0.72 }, { x: x + w * 0.14, y: y + h * 0.72 }], [27, 42, 74]);
  cv.rect(x + w * 0.12, y + h * 0.52, w * 0.8, h * 0.05, RED);
  cv.rect(x + w * 0.16, y + h * 0.30, w * 0.16, h * 0.20, [196, 112, 74]);
  cv.rect(x + w * 0.34, y + h * 0.30, w * 0.16, h * 0.20, [122, 139, 111]);
  cv.rect(x + w * 0.52, y + h * 0.30, w * 0.16, h * 0.20, [168, 130, 63]);
  // bridge tower + flames + smoke
  cv.rect(x + w * 0.74, y + h * 0.18, w * 0.12, h * 0.34, PAPER);
  cv.rect(x + w * 0.76, y + h * 0.22, w * 0.08, h * 0.08, [27, 42, 74]);
  flame(cv, x + w * 0.44, y + h * 0.32, 1.1); flame(cv, x + w * 0.62, y + h * 0.32, 0.9);
  smoke(cv, x + w * 0.52, y + h * 0.14, 0.8);
  // small rescue boat
  cv.poly([{ x: x + w * 0.06, y: y + h * 0.86 }, { x: x + w * 0.22, y: y + h * 0.86 }, { x: x + w * 0.19, y: y + h * 0.94 }, { x: x + w * 0.09, y: y + h * 0.94 }], ORANGE);
  end(cv);
}
function scenePeru(cv: Canvas, x: number, y: number, w: number, h: number) {
  begin(cv, x, y, w, h, OLIVE);
  // Andes peaks
  cv.poly([{ x: x, y: y + h * 0.55 }, { x: x + w * 0.22, y: y + h * 0.12 }, { x: x + w * 0.42, y: y + h * 0.55 }], [90, 104, 80]);
  cv.poly([{ x: x + w * 0.30, y: y + h * 0.55 }, { x: x + w * 0.58, y: y + h * 0.05 }, { x: x + w * 0.86, y: y + h * 0.55 }], [74, 86, 64]);
  cv.poly([{ x: x + w * 0.52, y: y + h * 0.16 }, { x: x + w * 0.58, y: y + h * 0.05 }, { x: x + w * 0.64, y: y + h * 0.16 }], PAPER);
  // cracked ground
  cv.rect(x, y + h * 0.55, w, h * 0.45, [196, 176, 140]);
  cv.poly([{ x: x + w * 0.30, y: y + h * 0.55 }, { x: x + w * 0.36, y: y + h * 0.68 }, { x: x + w * 0.28, y: y + h * 0.78 }, { x: x + w * 0.38, y: y + h * 0.92 }, { x: x + w * 0.32, y: y + h }, { x: x + w * 0.42, y: y + h }, { x: x + w * 0.48, y: y + h * 0.90 }, { x: x + w * 0.40, y: y + h * 0.76 }, { x: x + w * 0.46, y: y + h * 0.66 }, { x: x + w * 0.40, y: y + h * 0.55 }], [60, 52, 44]);
  cv.poly([{ x: x + w * 0.72, y: y + h * 0.55 }, { x: x + w * 0.76, y: y + h * 0.70 }, { x: x + w * 0.70, y: y + h * 0.84 }, { x: x + w * 0.78, y: y + h }, { x: x + w * 0.84, y: y + h }, { x: x + w * 0.78, y: y + h * 0.82 }, { x: x + w * 0.84, y: y + h * 0.68 }, { x: x + w * 0.78, y: y + h * 0.55 }], [60, 52, 44]);
  // shaking tilted building
  cv.poly([{ x: x + w * 0.08, y: y + h * 0.62 }, { x: x + w * 0.13, y: y + h * 0.30 }, { x: x + w * 0.33, y: y + h * 0.34 }, { x: x + w * 0.30, y: y + h * 0.62 }], [214, 196, 158]);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
    cv.rect(x + w * (0.14 + c * 0.08), y + h * (0.38 + r * 0.09), w * 0.04, h * 0.05, [74, 70, 64]);
  }
  // THICK red seismograph zigzag
  const zy = y + h * 0.48;
  cv.line(x, zy, x + w * 0.15, zy, RED, 3);
  cv.line(x + w * 0.15, zy, x + w * 0.22, zy - h * 0.10, RED, 3);
  cv.line(x + w * 0.22, zy - h * 0.10, x + w * 0.30, zy + h * 0.12, RED, 3);
  cv.line(x + w * 0.30, zy + h * 0.12, x + w * 0.38, zy - h * 0.14, RED, 3);
  cv.line(x + w * 0.38, zy - h * 0.14, x + w * 0.46, zy + h * 0.10, RED, 3);
  cv.line(x + w * 0.46, zy + h * 0.10, x + w * 0.54, zy - h * 0.08, RED, 3);
  cv.line(x + w * 0.54, zy - h * 0.08, x + w * 0.62, zy + h * 0.06, RED, 3);
  cv.line(x + w * 0.62, zy + h * 0.06, x + w, zy, RED, 3);
  end(cv);
}
function sceneJerusalem(cv: Canvas, x: number, y: number, w: number, h: number) {
  begin(cv, x, y, w, h, DUSK);
  cv.circle(x + w * 0.85, y + h * 0.16, w * 0.045, GOLD);
  // domed building
  cv.rect(x + w * 0.14, y + h * 0.52, w * 0.72, h * 0.40, PAPER);
  cv.ellipse(x + w * 0.50, y + h * 0.52, w * 0.20, h * 0.20, [212, 164, 60]);
  cv.rect(x + w * 0.485, y + h * 0.28, w * 0.03, h * 0.08, [212, 164, 60]);
  cv.circle(x + w * 0.50, y + h * 0.26, w * 0.015, GOLD);
  for (let i = 0; i < 4; i++) cv.rect(x + w * (0.20 + i * 0.16), y + h * 0.60, w * 0.07, h * 0.28, [196, 176, 140]);
  cv.rect(x + w * 0.14, y + h * 0.52, w * 0.72, h * 0.04, [168, 130, 63]);
  // flag pole + blue-white flag
  cv.line(x + w * 0.88, y + h * 0.30, x + w * 0.88, y + h * 0.92, INK, 2);
  cv.poly([{ x: x + w * 0.88, y: y + h * 0.30 }, { x: x + w * 0.98, y: y + h * 0.36 }, { x: x + w * 0.88, y: y + h * 0.42 }], [70, 110, 170]);
  // cypress trees
  cv.poly([{ x: x + w * 0.02, y: y + h * 0.92 }, { x: x + w * 0.06, y: y + h * 0.58 }, { x: x + w * 0.10, y: y + h * 0.92 }], [46, 90, 60]);
  cv.poly([{ x: x + w * 0.90, y: y + h * 0.92 }, { x: x + w * 0.94, y: y + h * 0.66 }, { x: x + w * 0.98, y: y + h * 0.92 }], [46, 90, 60]);
  end(cv);
}
function sceneKryvyi(cv: Canvas, x: number, y: number, w: number, h: number) {
  begin(cv, x, y, w, h, NAVY2);
  stars(cv, x, y, w, h, 77, 8);
  // missile with trail + flame
  cv.line(x + w * 0.10, y + h * 0.06, x + w * 0.52, y + h * 0.42, [200, 202, 208], 2);
  cv.poly([{ x: x + w * 0.50, y: y + h * 0.38 }, { x: x + w * 0.60, y: y + h * 0.46 }, { x: x + w * 0.56, y: y + h * 0.52 }, { x: x + w * 0.46, y: y + h * 0.44 }], [226, 228, 232]);
  flame(cv, x + w * 0.48, y + h * 0.40, 0.9);
  // damaged hospital/block
  cv.poly([{ x: x + w * 0.10, y: y + h }, { x: x + w * 0.10, y: y + h * 0.42 }, { x: x + w * 0.38, y: y + h * 0.42 }, { x: x + w * 0.30, y: y + h * 0.56 }, { x: x + w * 0.46, y: y + h * 0.62 }, { x: x + w * 0.46, y: y + h }, { x: x + w * 0.10, y: y + h }], [176, 160, 130]);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
    if (r === 1 && c === 0) litWin(cv, x + w * (0.15 + c * 0.12), y + h * (0.50 + r * 0.14), w * 0.07, h * 0.08);
    else cv.rect(x + w * (0.15 + c * 0.12), y + h * (0.50 + r * 0.14), w * 0.07, h * 0.08, [74, 70, 64]);
  }
  // second block + rubble + smoke + red impact flash
  cv.rect(x + w * 0.58, y + h * 0.62, w * 0.34, h * 0.38, [140, 122, 96]);
  cv.rect(x + w * 0.62, y + h * 0.68, w * 0.08, h * 0.10, [74, 70, 64]);
  cv.rect(x + w * 0.76, y + h * 0.68, w * 0.08, h * 0.10, [74, 70, 64]);
  smoke(cv, x + w * 0.70, y + h * 0.30, 0.9);
  cv.circle(x + w * 0.52, y + h * 0.78, w * 0.07, ORANGE, 0.9);
  cv.circle(x + w * 0.52, y + h * 0.78, w * 0.035, GOLD);
  end(cv);
}
function sceneMexico(cv: Canvas, x: number, y: number, w: number, h: number) {
  begin(cv, x, y, w, h, [232, 210, 168]);
  cv.circle(x + w * 0.88, y + h * 0.16, w * 0.05, [232, 106, 28]);
  // desert ground + dunes
  cv.rect(x, y + h * 0.62, w, h * 0.38, [206, 178, 132]);
  cv.ellipse(x + w * 0.15, y + h * 0.62, w * 0.30, h * 0.10, [196, 164, 116]);
  cv.ellipse(x + w * 0.85, y + h * 0.66, w * 0.28, h * 0.09, [196, 164, 116]);
  // cactus (left)
  cv.rect(x + w * 0.06, y + h * 0.28, w * 0.045, h * 0.36, [74, 120, 74]);
  cv.rect(x + w * 0.105, y + h * 0.40, w * 0.04, h * 0.10, [74, 120, 74]);
  cv.rect(x + w * 0.105, y + h * 0.40, w * 0.05, h * 0.04, [74, 120, 74]);
  cv.rect(x + w * 0.015, y + h * 0.46, w * 0.045, h * 0.04, [74, 120, 74]);
  // BIG handcuffs (centre, the arrest)
  const cy0 = y + h * 0.42;
  cv.ring(x + w * 0.36, cy0, w * 0.105, [200, 202, 208], 4);
  cv.ring(x + w * 0.36, cy0, w * 0.105, INK, 1);
  cv.ring(x + w * 0.62, cy0, w * 0.105, [200, 202, 208], 4);
  cv.ring(x + w * 0.62, cy0, w * 0.105, INK, 1);
  cv.line(x + w * 0.46, cy0, x + w * 0.52, cy0, [200, 202, 208], 4);
  cv.circle(x + w * 0.49, cy0, w * 0.02, RED);
  // pickup vehicle (right)
  cv.rect(x + w * 0.72, y + h * 0.60, w * 0.24, h * 0.16, [27, 42, 74]);
  cv.poly([{ x: x + w * 0.78, y: y + h * 0.60 }, { x: x + w * 0.82, y: y + h * 0.50 }, { x: x + w * 0.90, y: y + h * 0.50 }, { x: x + w * 0.94, y: y + h * 0.60 }], [27, 42, 74]);
  cv.rect(x + w * 0.83, y + h * 0.52, w * 0.06, h * 0.07, [200, 220, 230]);
  cv.circle(x + w * 0.78, y + h * 0.78, w * 0.035, INK); cv.circle(x + w * 0.90, y + h * 0.78, w * 0.035, INK);
  // arrested figure, hands up (left of cuffs)
  person(cv, x + w * 0.20, y + h * 0.82, 0.9, [120, 96, 66]);
  cv.line(x + w * 0.17, y + h * 0.72, x + w * 0.13, y + h * 0.58, [214, 178, 140], 2.5);
  cv.line(x + w * 0.23, y + h * 0.72, x + w * 0.27, y + h * 0.58, [214, 178, 140], 2.5);
  end(cv);
}
function sceneHongKong(cv: Canvas, x: number, y: number, w: number, h: number) {
  begin(cv, x, y, w, h, [222, 206, 178]);
  // skyline
  const bcol: RGB[] = [27, 42, 74, 60, 70, 96, 90, 80, 110];
  for (let i = 0; i < 5; i++) {
    const bx = x + w * (0.02 + i * 0.20), bw = w * 0.17, bh = h * (0.42 + (i % 3) * 0.12);
    cv.rect(bx, y + h - bh - h * 0.08, bw, bh, bcol[i % bcol.length]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      if ((i + r + c) % 3 === 0) litWin(cv, bx + bw * (0.18 + c * 0.42), y + h - bh - h * 0.08 + bh * (0.12 + r * 0.26), bw * 0.2, bh * 0.12);
    }
  }
  // big red ballot box (centre foreground)
  cv.rect(x + w * 0.30, y + h * 0.48, w * 0.40, h * 0.40, RED);
  cv.rect(x + w * 0.30, y + h * 0.48, w * 0.40, h * 0.07, RED_DK);
  cv.rect(x + w * 0.44, y + h * 0.50, w * 0.12, h * 0.03, INK);
  // white ballot paper going into the slot + big check
  cv.poly([{ x: x + w * 0.44, y: y + h * 0.50 }, { x: x + w * 0.50, y: y + h * 0.34 }, { x: x + w * 0.58, y: y + h * 0.38 }, { x: x + w * 0.52, y: y + h * 0.52 }], PAPER);
  cv.line(x + w * 0.38, y + h * 0.70, x + w * 0.46, y + h * 0.80, PAPER, 3);
  cv.line(x + w * 0.46, y + h * 0.80, x + w * 0.62, y + h * 0.58, PAPER, 3);
  end(cv);
}
function sceneHormuz(cv: Canvas, x: number, y: number, w: number, h: number) {
  begin(cv, x, y, w, h, TEAL);
  cv.rect(x, y, w, h * 0.42, [232, 220, 200]);
  cv.circle(x + w * 0.85, y + h * 0.14, w * 0.045, GOLD);
  cv.line(x, y + h * 0.46, x + w, y + h * 0.44, [255, 255, 255], 1);
  // tanker 1 (upright, burning)
  cv.poly([{ x: x + w * 0.06, y: y + h * 0.52 }, { x: x + w * 0.52, y: y + h * 0.52 }, { x: x + w * 0.48, y: y + h * 0.70 }, { x: x + w * 0.10, y: y + h * 0.70 }], [27, 42, 74]);
  cv.rect(x + w * 0.06, y + h * 0.52, w * 0.46, h * 0.05, RED);
  cv.rect(x + w * 0.40, y + h * 0.36, w * 0.10, h * 0.16, PAPER);
  flame(cv, x + w * 0.24, y + h * 0.54, 1.0); flame(cv, x + w * 0.36, y + h * 0.54, 0.8);
  smoke(cv, x + w * 0.30, y + h * 0.22, 0.9);
  // tanker 2 (listing, burning at stern)
  cv.poly([{ x: x + w * 0.58, y: y + h * 0.58 }, { x: x + w * 0.96, y: y + h * 0.50 }, { x: x + w * 0.94, y: y + h * 0.66 }, { x: x + w * 0.60, y: y + h * 0.72 }], [60, 66, 80]);
  flame(cv, x + w * 0.88, y + h * 0.52, 0.9);
  smoke(cv, x + w * 0.86, y + h * 0.26, 0.7);
  // orange lifeboat + waves
  cv.poly([{ x: x + w * 0.10, y: y + h * 0.84 }, { x: x + w * 0.24, y: y + h * 0.84 }, { x: x + w * 0.21, y: y + h * 0.92 }, { x: x + w * 0.13, y: y + h * 0.92 }], ORANGE);
  cv.line(x + w * 0.3, y + h * 0.82, x + w * 0.7, y + h * 0.80, [255, 255, 255], 1);
  end(cv);
}
function sceneMQ1(cv: Canvas, x: number, y: number, w: number, h: number) {
  begin(cv, x, y, w, h, NAVY2);
  stars(cv, x, y, w, h, 99, 10);
  cv.rect(x, y + h * 0.72, w, h * 0.28, TEAL);
  // smoke trail from the falling drone
  smoke(cv, x + w * 0.30, y + h * 0.22, 0.9);
  smoke(cv, x + w * 0.42, y + h * 0.32, 0.8);
  // MQ-1 drone silhouette, nose-down
  cv.poly([{ x: x + w * 0.52, y: y + h * 0.42 }, { x: x + w * 0.62, y: y + h * 0.50 }, { x: x + w * 0.58, y: y + h * 0.54 }, { x: x + w * 0.48, y: y + h * 0.48 }], [226, 228, 232]);
  cv.line(x + w * 0.40, y + h * 0.44, x + w * 0.66, y + h * 0.56, [226, 228, 232], 3);
  cv.line(x + w * 0.52, y + h * 0.52, x + w * 0.44, y + h * 0.58, [226, 228, 232], 2.5);
  cv.line(x + w * 0.52, y + h * 0.52, x + w * 0.60, y + h * 0.60, [226, 228, 232], 2.5);
  // explosion burst on the sea + waves
  cv.circle(x + w * 0.70, y + h * 0.74, w * 0.09, ORANGE, 0.95);
  cv.circle(x + w * 0.70, y + h * 0.74, w * 0.045, GOLD);
  cv.line(x + w * 0.1, y + h * 0.82, x + w * 0.5, y + h * 0.80, [255, 255, 255], 1);
  cv.line(x + w * 0.6, y + h * 0.90, x + w * 0.95, y + h * 0.88, [255, 255, 255], 1);
  end(cv);
}
function sceneBrussels(cv: Canvas, x: number, y: number, w: number, h: number) {
  begin(cv, x, y, w, h, DUSK);
  // Berlaymont-style building
  cv.rect(x + w * 0.06, y + h * 0.42, w * 0.56, h * 0.50, [176, 170, 158]);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
    cv.rect(x + w * (0.10 + c * 0.105), y + h * (0.48 + r * 0.13), w * 0.06, h * 0.08, [74, 80, 96]);
  }
  cv.rect(x + w * 0.06, y + h * 0.42, w * 0.56, h * 0.05, [27, 42, 74]);
  // EU circle of stars (navy disc + gold stars)
  cv.circle(x + w * 0.80, y + h * 0.34, w * 0.15, NAVY);
  for (let i = 0; i < 12; i++) {
    const t = -Math.PI / 2 + (i / 12) * Math.PI * 2;
    cv.circle(x + w * 0.80 + Math.cos(t) * w * 0.10, y + h * 0.34 + Math.sin(t) * h * 0.22, 1.6, GOLD);
  }
  // signed document + pen + red seal
  cv.poly([{ x: x + w * 0.68, y: y + h * 0.62 }, { x: x + w * 0.92, y: y + h * 0.62 }, { x: x + w * 0.92, y: y + h * 0.92 }, { x: x + w * 0.68, y: y + h * 0.92 }], PAPER);
  cv.line(x + w * 0.71, y + h * 0.70, x + w * 0.89, y + h * 0.70, INK, 1);
  cv.line(x + w * 0.71, y + h * 0.77, x + w * 0.89, y + h * 0.77, INK, 1);
  cv.line(x + w * 0.71, y + h * 0.84, x + w * 0.82, y + h * 0.84, INK, 1);
  cv.circle(x + w * 0.86, y + h * 0.86, w * 0.03, RED);
  cv.line(x + w * 0.94, y + h * 0.60, x + w * 0.98, y + h * 0.74, INK, 2);
  end(cv);
}
function sceneSomalia(cv: Canvas, x: number, y: number, w: number, h: number) {
  begin(cv, x, y, w, h, DUSK);
  cv.circle(x + w * 0.86, y + h * 0.16, w * 0.045, GOLD);
  // embassy building with columns
  cv.rect(x + w * 0.10, y + h * 0.36, w * 0.60, h * 0.56, PAPER);
  cv.poly([{ x: x + w * 0.08, y: y + h * 0.36 }, { x: x + w * 0.40, y: y + h * 0.20 }, { x: x + w * 0.72, y: y + h * 0.36 }], [196, 176, 140]);
  for (let i = 0; i < 4; i++) cv.rect(x + w * (0.15 + i * 0.14), y + h * 0.48, w * 0.06, h * 0.44, [168, 150, 118]);
  cv.rect(x + w * 0.34, y + h * 0.72, w * 0.12, h * 0.20, [74, 70, 64]);
  // Somalia flag: light blue + white star
  cv.line(x + w * 0.80, y + h * 0.24, x + w * 0.80, y + h * 0.92, INK, 2);
  cv.rect(x + w * 0.80, y + h * 0.24, w * 0.16, h * 0.16, [90, 140, 200]);
  cv.circle(x + w * 0.88, y + h * 0.32, w * 0.025, PAPER);
  // departing envoy with suitcase
  person(cv, x + w * 0.24, y + h * 0.94, 0.85, [27, 42, 74]);
  cv.rect(x + w * 0.30, y + h * 0.88, w * 0.10, h * 0.08, [120, 84, 50]);
  cv.rect(x + w * 0.33, y + h * 0.86, w * 0.04, h * 0.02, INK);
  end(cv);
}
function sceneGaza(cv: Canvas, x: number, y: number, w: number, h: number) {
  begin(cv, x, y, w, h, DUSK);
  // tents row
  for (let i = 0; i < 3; i++) {
    const tx = x + w * (0.06 + i * 0.20);
    cv.poly([{ x: tx, y: y + h * 0.52 }, { x: tx + w * 0.09, y: y + h * 0.30 }, { x: tx + w * 0.18, y: y + h * 0.52 }], PAPER);
    cv.poly([{ x: tx + w * 0.07, y: y + h * 0.52 }, { x: tx + w * 0.09, y: y + h * 0.42 }, { x: tx + w * 0.11, y: y + h * 0.52 }], INK);
  }
  // aid truck with boxes
  cv.rect(x + w * 0.58, y + h * 0.42, w * 0.34, h * 0.26, PAPER);
  cv.rect(x + w * 0.58, y + h * 0.42, w * 0.34, h * 0.04, RED);
  cv.rect(x + w * 0.92, y + h * 0.50, w * 0.06, h * 0.18, [232, 106, 28]);
  cv.rect(x + w * 0.93, y + h * 0.52, w * 0.04, h * 0.06, [200, 220, 230]);
  cv.circle(x + w * 0.64, y + h * 0.70, w * 0.03, INK); cv.circle(x + w * 0.86, y + h * 0.70, w * 0.03, INK);
  // stacked aid boxes
  cv.rect(x + w * 0.58, y + h * 0.30, w * 0.10, h * 0.12, [196, 164, 116]);
  cv.rect(x + w * 0.70, y + h * 0.30, w * 0.10, h * 0.12, [168, 130, 63]);
  cv.rect(x + w * 0.64, y + h * 0.18, w * 0.10, h * 0.12, [214, 196, 158]);
  // flood water (bottom) with waves
  cv.rect(x, y + h * 0.72, w, h * 0.28, [70, 110, 150]);
  cv.line(x + w * 0.05, y + h * 0.80, x + w * 0.35, y + h * 0.78, [255, 255, 255], 1.5);
  cv.line(x + w * 0.45, y + h * 0.88, x + w * 0.80, y + h * 0.86, [255, 255, 255], 1.5);
  cv.line(x + w * 0.10, y + h * 0.94, x + w * 0.40, y + h * 0.92, [255, 255, 255], 1.5);
  end(cv);
}
function sceneVegas(cv: Canvas, x: number, y: number, w: number, h: number) {
  begin(cv, x, y, w, h, NAVY2);
  stars(cv, x, y, w, h, 55, 6);
  // neon skyline
  const cols: RGB[] = [[27, 42, 74], [60, 70, 96], [90, 80, 110], [46, 107, 107]];
  for (let i = 0; i < 5; i++) {
    const bx = x + w * (0.02 + i * 0.20), bw = w * 0.16, bh = h * (0.30 + (i % 3) * 0.12);
    cv.rect(bx, y + h * 0.62 - bh, bw, bh, cols[i % cols.length]);
    for (let r = 0; r < 2; r++) litWin(cv, bx + bw * 0.2, y + h * 0.62 - bh + bh * (0.2 + r * 0.4), bw * 0.18, bh * 0.14);
    if (i === 2) { cv.rect(bx, y + h * 0.62 - bh - h * 0.06, bw, h * 0.06, GOLD); }
  }
  // checkered flag
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    cv.rect(x + w * (0.06 + c * 0.045), y + h * (0.10 + r * 0.045), w * 0.045, h * 0.045, (r + c) % 2 === 0 ? PAPER : INK);
  }
  cv.line(x + w * 0.06, y + h * 0.10, x + w * 0.06, y + h * 0.34, INK, 2);
  // F1 race car (red, low, with wing + wheels)
  const cy0 = y + h * 0.74;
  cv.poly([{ x: x + w * 0.30, y: cy0 }, { x: x + w * 0.38, y: cy0 - h * 0.10 }, { x: x + w * 0.62, y: cy0 - h * 0.10 }, { x: x + w * 0.72, y: cy0 }], RED);
  cv.rect(x + w * 0.24, y + h * 0.62, w * 0.05, h * 0.10, RED);
  cv.rect(x + w * 0.70, y + h * 0.60, w * 0.05, h * 0.12, RED);
  cv.circle(x + w * 0.50, cy0 - h * 0.12, w * 0.035, [250, 244, 220]);
  cv.circle(x + w * 0.36, cy0 + h * 0.02, w * 0.045, INK); cv.circle(x + w * 0.36, cy0 + h * 0.02, w * 0.02, [200, 202, 208]);
  cv.circle(x + w * 0.66, cy0 + h * 0.02, w * 0.045, INK); cv.circle(x + w * 0.66, cy0 + h * 0.02, w * 0.02, [200, 202, 208]);
  // speed lines + headlight glow
  cv.line(x + w * 0.08, cy0 - h * 0.06, x + w * 0.22, cy0 - h * 0.06, GOLD, 2);
  cv.line(x + w * 0.06, cy0 + h * 0.04, x + w * 0.20, cy0 + h * 0.04, GOLD, 2);
  cv.line(x + w * 0.74, cy0 - h * 0.04, x + w * 0.94, cy0 - h * 0.04, GOLD, 2);
  end(cv);
}

// ---------- content (brief-v8 full-day facts; do not change) ----------
const STATUS_COL: Record<string, RGB> = {
  CONFIRMED: [47, 107, 79], CLAIM: RED, REPORTED: [176, 126, 46], PENDING: [110, 110, 110],
};
interface Story {
  n: number; loc: string; cat: string; status: string; head: string; body: string; src: string;
  scene: (cv: Canvas, x: number, y: number, w: number, h: number) => void;
}
const LEADS: Story[] = [
  { n: 1, loc: "ANTALYA, TÜRKIYE", cat: "CLIMATE", status: "CONFIRMED",
    head: "COP31 collapses with no deal",
    body: "After two days of overtime, the summit ends Sunday with no deal. The EU and ~130 nations reject a text that drops fossil fuels; President Kurum admits no consensus.",
    src: "Reuters · CNN · AP", scene: sceneCOP31 },
  { n: 2, loc: "DYMER, UKRAINE", cat: "WAR", status: "CONFIRMED",
    head: "Strike on Dymer block kills at least 10",
    body: "A drone hits a five-storey block 45 km north of Kyiv early on Sunday; the building partly collapses. A boy of seven is pulled alive after 14 hours; a 79-year-old woman is rescued.",
    src: "Kyiv regional officials · SES", scene: sceneDymer },
  { n: 3, loc: "MANAMA, BAHRAIN", cat: "IRAN", status: "CLAIM",
    head: "Iran claims two US radars hit; US denies damage",
    body: "The IRGC claims a missile + drone operation destroyed two US Patriot radars at Al-Riffa and Awali. US: no damage to its personnel or facilities. Bahrain: intercepts; fire at a civilian site; 2 hurt.",
    src: "IRIB / Al Jazeera · CBS · Bahrain", scene: sceneBahrain },
];
const GRID: Story[] = [
  { n: 4, loc: "GULF OF FINLAND", cat: "SEA", status: "REPORTED",
    head: "Russian cargo ship Sparta II still ablaze",
    body: "Sanctioned ship, linked to Russia's defence ministry, hit by a suspected Ukrainian drone; fire raged overnight.",
    src: "AP · Finnish Border Guard", scene: sceneSparta },
  { n: 5, loc: "PERU", cat: "EARTHQUAKE", status: "REPORTED",
    head: "Magnitude 6.8 quake shakes Peru's Andes",
    body: "Tremors send Lima residents fleeing; early reports cite no damage or casualties.",
    src: "Wire reports", scene: scenePeru },
  { n: 6, loc: "JERUSALEM", cat: "POLITICS", status: "REPORTED",
    head: "Eisenkot asked to form Israel's government",
    body: "President Herzog passes over Netanyahu; mandate ceremony on Sunday.",
    src: "Brief-v1", scene: sceneJerusalem },
  { n: 7, loc: "UKRAINE", cat: "WAR", status: "REPORTED",
    head: "Missiles hit Zelenskyy's hometown, 2 dead",
    body: "Kryvyi Rih: 60 hurt, a hospital and 25 blocks hit.",
    src: "AP", scene: sceneKryvyi },
  { n: 8, loc: "MEXICO", cat: "CARTELS", status: "REPORTED",
    head: "11 killed after cartel boss is captured",
    body: "'El Chapo Isidro' Meza Flores seized in Sinaloa.",
    src: "France 24", scene: sceneMexico },
  { n: 9, loc: "HONG KONG", cat: "ELECTION", status: "CONFIRMED",
    head: "Hong Kong votes fill all 723 seats",
    body: "723 seats from 856 candidates, 31 subsectors; record 98.79% turnout; 5,640 voters.",
    src: "Xinhua · China Daily", scene: sceneHongKong },
  { n: 10, loc: "HORMUZ", cat: "SEA", status: "REPORTED",
    head: "Two tankers hit and set ablaze near Hormuz",
    body: "Two tankers hit near Khasab, Oman; crews evacuated, no casualties. Iran claims both hit mines — unverified.",
    src: "UKMTO · IRNA / IRIB", scene: sceneHormuz },
  { n: 11, loc: "HORMUZ", cat: "AIR", status: "CLAIM",
    head: "Iran claims 20th US MQ-1 drone downed",
    body: "IRGC claims a US MQ-1 downed east of Hormuz, the 20th of the war and 4th in 24 hours.",
    src: "IRIB / Al Jazeera", scene: sceneMQ1 },
  { n: 12, loc: "BRUSSELS", cat: "TRADE", status: "CONFIRMED",
    head: "EU and Indonesia sign landmark trade deal",
    body: "Signed Saturday in Brussels after ~10 years of talks; removes 98.5% of tariffs.",
    src: "European Commission · Reuters", scene: sceneBrussels },
  { n: 13, loc: "SOMALIA", cat: "DIPLOMACY", status: "REPORTED",
    head: "Somalia orders UAE envoy to leave",
    body: "Mogadishu withdraws its ambassador too.",
    src: "Brief-v1", scene: sceneSomalia },
  { n: 14, loc: "GAZA", cat: "AID", status: "REPORTED",
    head: "Four nations press Israel on Gaza aid",
    body: "Australia, Canada, Italy and Britain cite flood suffering.",
    src: "Brief-v1", scene: sceneGaza },
  { n: 15, loc: "LAS VEGAS", cat: "FORMULA 1", status: "CONFIRMED",
    head: "Verstappen wins the Las Vegas Grand Prix",
    body: "Third win in four years; 35 lead changes; beats Antonelli and Russell.",
    src: "F1", scene: sceneVegas },
];
const WIRE: string[] = [
  "US: Court backs $7.25bn Roundup settlement",
  "Rugby: England thrash the All Blacks 37-12",
  "Football: Arsenal held 2-2; Leeds stun Chelsea 4-1",
  "Estonia to close its Russia border; Moscow cries \"Iron Curtain\"",
  "France: police jailed for racist violence, a landmark ruling",
  "France: 6th straight Saturday of cost-of-living protests",
  "US: Trump warns of a \"tremendous tax\" on AI centres abroad",
  "US: man convicted of starting the 2025 Palisades fire",
  "US: State Dept details $12bn of Venezuelan oil revenue",
  "US: Trump ousts cyber director after outage criticism",
  "Ebola: the death toll passes 5,700, containment goes on",
  "Myanmar: France seeks UN action on the genocide ruling",
  "India-China: commanders meet on the Arunachal frontier",
  "Japan: forces to train live-fire at Indian facilities, a first",
  "India: Air India extends Jeddah suspension to 24 Nov",
  "India: ICMR signs off 100 health technology transfers",
  "Cricket: Rahul's century headlines India's Test in NZ",
  "Cricket: Cummins wins unanimous backing as Australia captain",
  "Switzerland: 4,000-year-old bronze ring found in melting ice",
  "Australia: bystanders pull driver from burning car, Canberra",
  "Football: PSG win 3-2 at Nice; Doue hurt badly",
];
const DATE_CHECK = "DATE CHECK — FULL-DAY EDITION: wires through the end of Sunday 22 November 2026. Left out as Saturday 21 November news: the Kyiv bridge strikes, the Shenzhen summit and India's Nitish Setu opening — and the Lviv strike (Friday 20 Nov). Now included (22 November): COP31's collapse, the Dymer strike, Iran's Bahrain radar claim, Hong Kong's vote count, the Hormuz tanker fires, the MQ-1 claim. COP31's vote is no longer pending — the summit ended with no deal.";
const NUMBERS: [string, string][] = [
  ["186", "drones at Ukraine overnight"],
  ["10", "Dymer dead, at least"],
  ["2", "US radars claimed hit"],
  ["723", "Hong Kong seats filled"],
  ["98.5%", "tariffs removed, EU–Indonesia"],
  ["$7.25bn", "Roundup settlement"],
];
const CHIPS: [string, string, RGB][] = [
  ["EUROPE", "10", [95, 122, 114]], ["MIDDLE EAST", "5", [168, 84, 74]],
  ["AMERICAS", "8", [91, 110, 140]], ["ASIA-PACIFIC", "7", [168, 130, 63]],
  ["AFRICA", "2", [122, 139, 111]], ["OCEANIA", "2", [122, 110, 140]],
  ["WORLD", "2", [110, 110, 110]],
];

// ---------- world map ----------
const CONTINENTS: [number, number][][] = [
  [[-168, 65], [-140, 70], [-125, 71], [-110, 68], [-95, 69], [-85, 66], [-75, 62], [-65, 60], [-60, 52], [-55, 47], [-65, 44], [-70, 41], [-74, 39], [-76, 35], [-80, 32], [-81, 26], [-84, 30], [-90, 21], [-97, 16], [-90, 14], [-83, 9], [-79, 9], [-85, 11], [-92, 15], [-97, 16], [-105, 20], [-110, 23], [-114, 29], [-117, 33], [-122, 37], [-124, 42], [-124, 48], [-127, 52], [-132, 56], [-140, 60], [-152, 58], [-158, 56], [-165, 60], [-168, 65]],
  [[-55, 60], [-43, 60], [-40, 64], [-32, 68], [-22, 70], [-25, 74], [-35, 76], [-50, 75], [-58, 72], [-58, 66], [-55, 60]],
  [[-79, 9], [-72, 12], [-62, 10], [-52, 5], [-50, 0], [-44, -3], [-35, -8], [-38, -15], [-40, -22], [-48, -27], [-53, -33], [-58, -38], [-65, -41], [-68, -47], [-70, -52], [-73, -50], [-73, -44], [-72, -37], [-71, -30], [-70, -20], [-75, -15], [-79, -8], [-81, -4], [-80, 1], [-79, 9]],
  [[-17, 15], [-17, 21], [-12, 27], [-9, 31], [-5, 35], [0, 36], [9, 37], [11, 34], [19, 32], [25, 32], [30, 31], [34, 28], [36, 24], [39, 21], [40, 16], [43, 12], [48, 11], [51, 12], [46, 6], [42, 2], [40, -4], [40, -10], [38, -16], [35, -22], [32, -28], [28, -33], [20, -35], [17, -32], [14, -24], [12, -18], [13, -12], [12, -6], [9, 0], [9, 4], [4, 6], [-3, 5], [-8, 5], [-13, 8], [-16, 12], [-17, 15]],
  [[-10, 36], [-9, 43], [-4, 48], [-1, 49], [2, 51], [5, 53], [8, 57], [10, 59], [6, 62], [12, 66], [18, 70], [25, 71], [30, 70], [35, 68], [42, 68], [50, 69], [58, 69], [66, 71], [73, 72], [80, 73], [90, 75], [100, 76], [110, 74], [120, 73], [130, 72], [140, 72], [150, 71], [158, 69], [162, 66], [170, 66], [178, 65], [170, 62], [162, 60], [158, 52], [150, 59], [142, 54], [140, 48], [135, 43], [130, 42], [127, 40], [122, 38], [120, 33], [115, 27], [110, 20], [108, 15], [105, 10], [103, 7], [100, 8], [98, 10], [97, 15], [94, 17], [92, 21], [88, 22], [85, 19], [80, 15], [80, 8], [77, 8], [75, 12], [73, 16], [71, 20], [68, 23], [66, 25], [62, 25], [58, 26], [56, 27], [54, 26], [52, 25], [50, 26], [50, 29], [48, 30], [44, 29], [41, 28], [39, 24], [38, 21], [35, 20], [34, 24], [33, 28], [30, 31], [27, 36], [23, 36], [22, 38], [20, 40], [19, 42], [15, 44], [12, 44], [8, 44], [6, 43], [3, 43], [0, 40], [-2, 37], [-6, 36], [-9, 37], [-10, 36]],
  [[114, -22], [114, -30], [115, -34], [118, -35], [124, -33], [129, -32], [132, -32], [135, -35], [138, -35], [140, -38], [145, -38], [150, -37], [153, -32], [153, -27], [150, -22], [146, -19], [142, -15], [142, -11], [137, -12], [135, -15], [132, -12], [130, -13], [126, -14], [122, -17], [118, -20], [114, -22]],
  [[-5, 50], [-3, 53], [-5, 56], [-3, 58], [-1, 57], [0, 53], [-2, 51], [-5, 50]],
  [[130, 31], [132, 33], [134, 34], [137, 35], [139, 36], [140, 38], [141, 40], [142, 42], [144, 44], [141, 43], [140, 40], [138, 37], [136, 35], [133, 34], [130, 32], [130, 31]],
  [[95, 5], [98, 2], [102, -2], [105, -5], [104, -6], [100, -2], [96, 2], [95, 5]],
  [[109, 1], [112, 3], [116, 5], [118, 2], [117, -2], [114, -4], [110, -3], [109, 1]],
  [[105, -6], [110, -7], [114, -8], [113, -9], [108, -8], [105, -7]],
  [[131, -1], [136, -2], [141, -3], [146, -6], [150, -8], [147, -9], [142, -8], [137, -6], [132, -4], [131, -1]],
];
// story number -> [lat, lon, dx, dy] pin nudge in px
const PINS: Record<number, [number, number, number, number]> = {
  1: [36.9, 30.7, -6, 17], 2: [50.8, 30.3, -19, 7], 3: [26.2, 50.6, 21, -16],
  4: [60.0, 24.0, -11, -6], 5: [-12.0, -77.0, 0, 0], 6: [31.8, 35.2, 22, -2],
  7: [47.9, 33.4, 18, -12], 8: [25.0, -107.9, 0, 0], 9: [22.3, 114.2, 0, 0],
  10: [26.5, 56.3, 23, 2], 11: [25.5, 57.5, -9, 19], 12: [50.8, 4.4, -24, -7],
  13: [2.0, 45.3, 22, 13], 14: [31.5, 34.5, -5, 29], 15: [36.2, -115.1, -10, -8],
};
function drawMap(cv: Canvas, mx: number, my: number, mw: number, mh: number) {
  cv.rect(mx, my, mw, mh, [233, 222, 196]);
  cv.setClip(mx, my, mw, mh);
  const proj = (lat: number, lon: number): [number, number] => [
    mx + ((lon + 170) / 350) * mw,
    my + ((72 - lat) / 127) * mh,
  ];
  for (const cont of CONTINENTS) {
    const poly = cont.map(([lon, lat]) => { const [px, py] = proj(lat, lon); return { x: px, y: py }; });
    cv.poly(poly, [186, 172, 122]);
  }
  cv.resetClip();
  cv.strokeRect(mx, my, mw, mh, [120, 105, 80], 1.5);
  // pins with leader lines
  for (let n = 1; n <= 15; n++) {
    const [lat, lon, dx, dy] = PINS[n];
    const [tx, ty] = proj(lat, lon);
    const px = tx + dx, py = ty + dy;
    if (dx !== 0 || dy !== 0) cv.line(tx, ty, px, py, INK, 1);
    cv.circle(tx, ty, 2, RED);
    cv.circle(px, py, 7, RED);
    cv.ring(px, py, 7, PAPER, 1);
    cv.text(String(n), px, py + 3, F.barBold, 9, PAPER, 0, "center");
  }
}

// ---------- page layout ----------
function chip(cv: Canvas, x: number, y: number, label: string, bg: RGB, size = 9): number {
  const w = textWidth(F.barBold, label, size) + 10;
  cv.rrect(x, y, w, 13, 2, bg);
  cv.text(label, x + w / 2, y + 10.5, F.barBold, size, PAPER, 0, "center");
  return w;
}
function render(): Canvas {
  const cv = new Canvas();
  // --- top bar ---
  const topLeft = "36 STORIES · 7 REGIONS · ALL FROM THIS ONE DAY";
  cv.text(topLeft, 14, 18, F.barSemi, 12.5, INK, 0.3);
  let cx = 14 + textWidth(F.barSemi, topLeft, 12.5, 0.3) + 10;
  for (const [name, count, col] of CHIPS) {
    cx += chip(cv, cx, 5, `${name} ${count}`, col, 10) + 4;
  }
  cv.text("PRESS TIME 23:59 UTC", 1010, 18, F.barBold, 12, RED, 0.3, "right");
  // --- masthead ---
  cv.text("Sunday 22 November 2026", 512, 82, F.playBlack, 58, INK, 0, "center");
  cv.rect(14, 90, 996, 2, RED);
  // --- timeline (navy) ---
  cv.rect(14, 98, 996, 20, NAVY);
  const tl: [string, string][] = [
    ["03:00", "COP31 objections due"], ["05:30", "Verstappen wins Vegas"],
    ["06:00", "COP31 plenary — no deal"], ["MORNING", "Dymer strike"],
    ["EVENING", "Hong Kong results"], ["NIGHT", "COP31 collapses"],
  ];
  let tlW = textWidth(F.barBold, "UTC", 11, 0.5);
  for (const [t, l] of tl) tlW += textWidth(F.barBold, "  " + t + " ", 11) + textWidth(F.barReg, l + "  · ", 11);
  let tx = 512 - tlW / 2;
  tx += cv.text("UTC", tx, 112, F.barBold, 11, GOLD, 0.5);
  for (const [t, l] of tl) {
    tx += cv.text("  " + t + " ", tx, 112, F.barBold, 11, GOLD);
    tx += cv.text(l + "  · ", tx, 112, F.barReg, 11, CREAM_TXT);
  }
  // --- leads + numbers sidebar ---
  LEADS.forEach((s, i) => {
    const x = 14 + i * 251, w = 242;
    s.scene(cv, x, 120, w, 96);
    cv.strokeRect(x, 120, w, 96, MUTED_LINE, 1);
    cv.circle(x + 13, 132, 10, RED); cv.ring(x + 13, 132, 10, PAPER, 1);
    cv.text(String(s.n), x + 13, 136, F.barBold, 12, PAPER, 0, "center");
    cv.text(`${s.loc} — ${s.cat}`, x, 232, F.barSemi, 11, RED, 0.3);
    const sw = textWidth(F.barBold, s.status, 9) + 10;
    cv.rrect(x + w - sw, 222, sw, 13, 2, STATUS_COL[s.status]);
    cv.text(s.status, x + w - sw / 2, 231.5, F.barBold, 9, PAPER, 0, "center");
    cv.textBlock(s.head, x, 238, F.playBold, 19, INK, w, 20, 2);
    cv.textBlock(s.body, x, 280, F.barReg, 11, INK, w, 12.5, 4);
    cv.text(s.src, x, 338, F.barReg, 8.5, [110, 100, 85]);
  });
  // sidebar: THE DAY IN NUMBERS (all figures red, one accent colour)
  cv.rect(767, 120, 243, 220, NAVY);
  cv.text("THE DAY IN NUMBERS", 779, 142, F.barBold, 14, PAPER, 0.3);
  cv.rect(779, 148, 219, 1.5, GOLD);
  NUMBERS.forEach(([num, label], i) => {
    const y0 = 158 + i * 30;
    cv.text(num, 779, y0 + 17, F.playBold, 20, RED);
    cv.text(label, 779, y0 + 29, F.barReg, 9.5, CREAM_TXT);
  });
  // --- grid (4–15), two rows of six ---
  GRID.forEach((s, i) => {
    const row = Math.floor(i / 6), col = i % 6;
    const x = 14 + col * 167.4, y0 = 344 + row * 148, w = 159;
    s.scene(cv, x, y0, w, 58);
    cv.strokeRect(x, y0, w, 58, MUTED_LINE, 1);
    cv.circle(x + 10, y0 + 10, 8, RED); cv.ring(x + 10, y0 + 10, 8, PAPER, 1);
    cv.text(String(s.n), x + 10, y0 + 13.5, F.barBold, 10, PAPER, 0, "center");
    const sw = textWidth(F.barBold, s.status, 8) + 8;
    cv.rrect(x + w - sw - 3, y0 + 3, sw, 11, 2, STATUS_COL[s.status]);
    cv.text(s.status, x + w - sw / 2 - 3, y0 + 11.5, F.barBold, 8, PAPER, 0, "center");
    cv.text(`${s.loc} — ${s.cat}`, x, y0 + 70, F.barSemi, 10, RED, 0.2);
    cv.textBlock(s.head, x, y0 + 74, F.playBold, 13, INK, w, 14, 2);
    cv.textBlock(s.body, x, y0 + 104, F.barReg, 10.5, INK, w, 11.5, 3);
  });
  cv.rect(14, 490, 996, 1, [200, 190, 170]);
  cv.rect(14, 638, 996, 1, [200, 190, 170]);
  // --- wire list (16–36) ---
  cv.text("ALSO ON SUNDAY 22 NOVEMBER — 21 MORE STORIES", 14, 655, F.barBold, 13, RED, 0.3);
  cv.rect(14, 660, 996, 1.5, RED);
  WIRE.forEach((t, i) => {
    const col = Math.floor(i / 7), row = i % 7;
    const x = 14 + col * 334, base = 675 + row * 14.5;
    cv.text(String(16 + i), x, base, F.barBold, 11, RED);
    cv.text(t, x + 18, base, F.barReg, 11, INK);
  });
  // --- map + DATE CHECK ---
  cv.text("WHERE IT HAPPENED", 14, 778, F.barBold, 12, INK, 0.3);
  cv.text("pins = story numbers", 600, 778, F.barReg, 9.5, [110, 100, 85], 0, "right");
  drawMap(cv, 14, 782, 586, 128);
  cv.text("1 ANTALYA · 2 DYMER · 3 BAHRAIN · 4 GULF OF FINLAND · 5 PERU · 6 JERUSALEM · 7 KRYVYI RIH · 8 SINALOA", 14, 924, F.barSemi, 9.5, INK);
  cv.text("9 HONG KONG · 10 HORMUZ · 11 HORMUZ (MQ-1) · 12 BRUSSELS · 13 MOGADISHU · 14 GAZA · 15 LAS VEGAS", 14, 937, F.barSemi, 9.5, INK);
  cv.rect(608, 764, 402, 180, PAPER);
  cv.strokeRect(608, 764, 402, 180, RED, 2);
  cv.rrect(620, 774, 96, 16, 2, RED);
  cv.text("DATE CHECK", 668, 786, F.barBold, 11.5, PAPER, 0, "center");
  cv.text("FULL-DAY EDITION", 998, 786, F.barBold, 11, RED, 0.3, "right");
  cv.textBlock(DATE_CHECK, 620, 796, F.barReg, 11.5, INK, 378, 14.5, 12);
  // --- sources / certainty / note ---
  cv.text("Sources: Reuters · CNN · AP · Le Monde · Xinhua · UKMTO · IRIB / Al Jazeera · CBS · European Commission · F1 · France 24 · Finnish Border Guard · wire reports", 14, 956, F.barReg, 9.5, [90, 82, 68]);
  let lx = 14;
  lx += cv.text("CERTAINTY: ", lx, 970, F.barBold, 9.5, RED);
  lx += cv.text("CONFIRMED", lx, 970, F.barBold, 9.5, [47, 107, 79]);
  lx += cv.text(" — official / 2+ outlets · ", lx, 970, F.barReg, 9.5, [90, 82, 68]);
  lx += cv.text("CLAIM", lx, 970, F.barBold, 9.5, RED);
  lx += cv.text(" — one side's claim · ", lx, 970, F.barReg, 9.5, [90, 82, 68]);
  lx += cv.text("REPORTED", lx, 970, F.barBold, 9.5, [176, 126, 46]);
  lx += cv.text(" — witnesses / one source · ", lx, 970, F.barReg, 9.5, [90, 82, 68]);
  lx += cv.text("PENDING", lx, 970, F.barBold, 9.5, [110, 110, 110]);
  lx += cv.text(" — not settled yet", lx, 970, F.barReg, 9.5, [90, 82, 68]);
  cv.text("Scenes are drawn illustrations — no photographs. All stories happened or were first reported on Sunday 22 November 2026 (UTC).", 14, 984, F.barReg, 9.5, [90, 82, 68]);
  // --- bottom bar ---
  cv.rect(0, 998, 1024, 26, NAVY);
  cv.text("THE WORLD IN ONE DAY", 14, 1015, F.barBold, 12, GOLD, 0.5);
  cv.text("SUNDAY 22 NOVEMBER 2026 · ONE PAGE", 1010, 1015, F.barBold, 11, CREAM_TXT, 0.3, "right");
  // --- subtle paper grain ---
  cv.grain(0, 0, W, H, 7, 5000);
  return cv;
}

function main() {
  const cv = render();
  const png = encodePNG(cv.data, W, H);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, png);
  const sha = createHash("sha256").update(png).digest("hex");
  console.log(`wrote ${OUT} bytes=${png.length} sha256=${sha}`);
  if (missingGlyphs.size > 0) console.error(`missing glyphs: ${[...missingGlyphs].join(", ")}`);
}
main();
