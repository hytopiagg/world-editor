/* tslint:disable */
/* eslint-disable */
export function start(): void;
export class McWorld {
  free(): void;
  constructor();
  read_region(region_pos: Vec2, min_chunk_pos: Vec2 | null | undefined, max_chunk_pos: Vec2 | null | undefined, bytes: Uint8Array): void;
  convert(min_pos: Vec3 | null | undefined, max_pos: Vec3 | null | undefined, rules: any): any;
}
export class Vec2 {
  free(): void;
  constructor(x: number, z: number);
  x: number;
  z: number;
}
export class Vec3 {
  free(): void;
  constructor(x: number, y: number, z: number);
  x: number;
  y: number;
  z: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly start: () => void;
  readonly __wbg_vec2_free: (a: number, b: number) => void;
  readonly __wbg_get_vec2_x: (a: number) => number;
  readonly __wbg_set_vec2_x: (a: number, b: number) => void;
  readonly __wbg_get_vec2_z: (a: number) => number;
  readonly __wbg_set_vec2_z: (a: number, b: number) => void;
  readonly vec2_new: (a: number, b: number) => number;
  readonly __wbg_vec3_free: (a: number, b: number) => void;
  readonly __wbg_get_vec3_z: (a: number) => number;
  readonly __wbg_set_vec3_z: (a: number, b: number) => void;
  readonly vec3_new: (a: number, b: number, c: number) => number;
  readonly __wbg_mcworld_free: (a: number, b: number) => void;
  readonly mcworld_new: () => number;
  readonly mcworld_read_region: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
  readonly mcworld_convert: (a: number, b: number, c: number, d: any) => [number, number, number];
  readonly __wbg_get_vec3_x: (a: number) => number;
  readonly __wbg_get_vec3_y: (a: number) => number;
  readonly __wbg_set_vec3_x: (a: number, b: number) => void;
  readonly __wbg_set_vec3_y: (a: number, b: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_4: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
