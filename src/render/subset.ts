import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * Per-image font subsetting with HarfBuzz's hb-subset compiled to WebAssembly. Each SVG embeds only
 * the glyphs it draws, which keeps an image with three faces around a few kilobytes of font data.
 */

// Typed locally: lib.dom is not loaded, and @types/node does not declare the WebAssembly global.
interface Wasm {
  Module: new (bytes: Uint8Array) => object;
  Instance: new (mod: object, imports: object) => { exports: unknown };
}
const wasm = (globalThis as unknown as { WebAssembly: Wasm }).WebAssembly;

interface HbSubset {
  memory: { buffer: ArrayBuffer };
  malloc(n: number): number;
  free(p: number): void;
  hb_blob_create(data: number, length: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, cp: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_or_fail(face: number, input: number): number;
}

let hb: HbSubset | null = null;

function load(): HbSubset {
  if (hb) return hb;
  const require = createRequire(import.meta.url);
  const path = require.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm");
  const mod = new wasm.Module(readFileSync(path));
  hb = new wasm.Instance(mod, {}).exports as HbSubset;
  return hb;
}

const HB_MEMORY_MODE_WRITABLE = 2;

/** Returns a TrueType font with only the glyphs needed for `text`, or null if subsetting failed. */
export function subsetFont(font: Uint8Array, text: Iterable<string>): Uint8Array | null {
  const x = load();
  const ptr = x.malloc(font.byteLength);
  new Uint8Array(x.memory.buffer).set(font, ptr);
  const blob = x.hb_blob_create(ptr, font.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = x.hb_face_create(blob, 0);
  x.hb_blob_destroy(blob);
  const input = x.hb_subset_input_create_or_fail();
  try {
    if (!input) return null;
    const set = x.hb_subset_input_unicode_set(input);
    for (const ch of text) x.hb_set_add(set, ch.codePointAt(0)!);
    const sub = x.hb_subset_or_fail(face, input);
    if (!sub) return null;
    const out = x.hb_face_reference_blob(sub);
    const len = x.hb_blob_get_length(out);
    const data = x.hb_blob_get_data(out, 0);
    // Copy before freeing: the WASM heap may grow and detach views.
    const bytes = new Uint8Array(x.memory.buffer, data, len).slice();
    x.hb_blob_destroy(out);
    x.hb_face_destroy(sub);
    return bytes.length ? bytes : null;
  } finally {
    if (input) x.hb_subset_input_destroy(input);
    x.hb_face_destroy(face);
    x.free(ptr);
  }
}
