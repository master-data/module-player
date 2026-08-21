/**
 * Type surface of the generated embind module.
 *
 * This file is the single source of truth for it: `docker/entrypoint.sh` copies
 * it verbatim next to each built artifact as `libsidplayfp.d.ts`.
 *
 * Keep it in step with `src/bindings/bindings.cpp`.
 */

export interface SidPlayerContextOptions {
  locateFile?(path: string, prefix?: string): string | URL;
  [key: string]: unknown;
}

/** C64 variant. Affects clock rate, and therefore tempo and pitch. */
export type C64Model = "PAL" | "NTSC" | "OLD_NTSC" | "DREAN" | "PAL_M";

/** SID revision. 6581 and 8580 sound audibly different. */
export type SidModel = "MOS6581" | "MOS8580";

export type CiaModel = "MOS6526" | "MOS8521" | "MOS6526W4485";

export type SamplingMethod = "INTERPOLATE" | "RESAMPLE_INTERPOLATE";

/** Strength of reSIDfp's combined-waveform tables. */
export type CombinedWaveforms = "AVERAGE" | "WEAK" | "STRONG";

/** As reported by the tune's own header, which is often "UNKNOWN". */
export type TuneClock = "UNKNOWN" | "PAL" | "NTSC" | "ANY";
export type TuneSidModel = "UNKNOWN" | "MOS6581" | "MOS8580" | "ANY";
export type TuneCompatibility = "C64" | "PSID" | "R64" | "BASIC";

/**
 * Any subset of libsidplayfp's `SidConfig`. Omitted keys keep their current
 * value, so this composes with `configure()` in either order.
 */
export interface EmulationConfig {
  /** Output sample rate in Hz, 4000..192000. */
  frequency?: number;
  /** Mix to two channels. Equivalent to the second argument of `configure`. */
  stereo?: boolean;
  /** Model assumed when the tune does not say, or when `forceC64Model` is set. */
  c64Model?: C64Model;
  forceC64Model?: boolean;
  /** Model assumed when the tune does not say, or when `forceSidModel` is set. */
  sidModel?: SidModel;
  forceSidModel?: boolean;
  ciaModel?: CiaModel;
  /** Boost digi playback on 8580. Defaults to true. */
  digiBoost?: boolean;
  samplingMethod?: SamplingMethod;
  /**
   * Power-on delay in cycles. Values at or below 8191 are deterministic;
   * 8192 asks libsidplayfp to randomise it. Defaults to 8191 so renders are
   * reproducible.
   */
  powerOnDelay?: number;
  /** I/O address of a second SID chip, or 0 to disable. */
  secondSidAddress?: number;
  /** I/O address of a third SID chip, or 0 to disable. */
  thirdSidAddress?: number;
}

export interface ResolvedEmulationConfig
  extends Required<Omit<EmulationConfig, "stereo">> {
  stereo: boolean;
  channels: number;
}

/**
 * reSIDfp analogue tuning. Rejected by the SIDLite artifact.
 *
 * `filter6581Range` and `old6581Caps` are **process-global**: reSIDfp applies
 * them to a `FilterModelConfig6581` singleton through static methods, so they
 * affect every SID instance sharing this WASM module, including ones created
 * earlier. The other three are per-chip. Load a separate module instance if two
 * players in one process need different values.
 */
export interface FilterConfig {
  /** 6581 filter cutoff curve, 0.0..1.0. Per chip. */
  filter6581Curve?: number;
  /** 6581 filter cutoff range, 0.0..1.0, default 0.5. Process-global. */
  filter6581Range?: number;
  /** 8580 filter cutoff curve, 0.0..1.0. Per chip. */
  filter8580Curve?: number;
  /** Emulate the original, leakier 6581 filter capacitors. Process-global. */
  old6581Caps?: boolean;
  /** Strength of the combined-waveform tables. Per chip. */
  combinedWaveforms?: CombinedWaveforms;
}

export interface SidTuneInfo {
  songs: number;
  startSong: number;
  currentSong: number;
  loadAddress: number;
  initAddress: number;
  playAddress: number;
  dataFileLen: number;
  /** Empty unless the tune was loaded with `loadSidFile`. */
  dataFileName: string;
  /** Empty unless the tune was loaded with `loadSidFile`. */
  infoFileName: string;
  /** Empty unless the tune was loaded with `loadSidFile`. */
  path: string;
  c64dataLen: number;
  /** Raw `SidTuneInfo::clock_t` ordinal. Prefer `clock`. */
  clockSpeed: number;
  clock: TuneClock;
  format: string;
  compatibility: TuneCompatibility;
  /** `0` for VBI, `60` for CIA 1 timer A. */
  songSpeed: number;
  relocStartPage: number;
  relocPages: number;
  fixLoad: boolean;
  /** Number of SID chips the tune declares. */
  sidChips: number;
  /** I/O base address of each declared chip. */
  sidChipBases: number[];
  /** Declared model of each chip. */
  sidModels: TuneSidModel[];
  infoStrings: string[];
  commentStrings: string[];
}

export interface EngineInfo {
  name: string;
  version: string;
  channels: number;
  driverAddress: number;
  driverLength: number;
  powerOnDelay: number;
  speed: string;
  credits: string[];
  kernal: string;
  basic: string;
  chargen: string;
  /** Chips the tune declares. */
  sidChips: number;
  /** Chips the player actually instantiated. */
  installedSids: number;
  sidModels: TuneSidModel[];
  /** `"WasmReSIDfp"` or `"WasmSIDLite"`. */
  builder: string;
  supportsFilterConfig: boolean;
}

export interface SidWriteTrace {
  sidNumber: number;
  address: number;
  value: number;
  cyclePhi1: number;
}

export class SidPlayerContext {
  constructor();

  /**
   * Set sample rate and channel count and apply the emulation configuration.
   * Returns false and sets `getLastError()` for a rate outside 4000..192000 Hz.
   */
  configure(sampleRate: number, stereo: boolean): boolean;

  /** Apply any subset of libsidplayfp's `SidConfig`. */
  setEmulationConfig(config: EmulationConfig): boolean;
  getEmulationConfig(): ResolvedEmulationConfig;

  /** reSIDfp only; returns false on the SIDLite artifact. */
  setFilterConfig(config: FilterConfig): boolean;
  supportsFilterConfig(): boolean;

  loadSidBuffer(buffer: Uint8Array | ArrayBufferView): boolean;
  /** Loads through Emscripten's virtual FS. Not usable in a browser. */
  loadSidFile(path: string): boolean;

  /** Returns the selected subtune, or 0 on failure — check `hasError()`. */
  selectSong(song: number): number;

  /**
   * Render up to `cycles` C64 cycles.
   *
   * The returned `Int16Array` is a **view into WASM linear memory**, not a
   * copy: the next `render()` overwrites it, and a heap growth detaches it.
   * Copy it (`chunk.slice()`) before calling anything else on this context.
   * `SidAudioEngine` does this for you.
   *
   * libsidplayfp clamps internally to 20 000 cycles, so one call advances at
   * most ~20 ms of PAL time however large `cycles` is.
   */
  render(cycles: number): Int16Array | null;

  reset(): boolean;

  /** Mute or unmute voice 0..2 of chip `sidNum`. */
  mute(sidNum: number, voice: number, enable: boolean): boolean;
  /** Enable or bypass chip `sidNum`'s analogue filter. */
  setFilterEnabled(sidNum: number, enable: boolean): boolean;

  /** Emulated playback position, from libsidplayfp's own clock. */
  getTimeMs(): number;
  getTimeSeconds(): number;
  /** CIA 1 timer A latch — the real rate of a CIA-timed tune. */
  getCia1TimerA(): number;
  getInstalledSids(): number;
  /** Samples one `render(cycles)` call would produce. */
  getBufferSize(cycles: number): number;
  /** Current 32 registers of chip `sidNum`, or null. A fresh copy. */
  getSidStatus(sidNum: number): Uint8Array | null;
  /** HVSC `Songlengths.md5` key for the loaded tune; empty on failure. */
  getTuneMd5(): string;

  hasTune(): boolean;
  isStereo(): boolean;
  getChannels(): number;
  getSampleRate(): number;
  getTuneInfo(): SidTuneInfo | null;
  getEngineInfo(): EngineInfo;

  getLastError(): string;
  hasError(): boolean;
  clearError(): void;

  /**
   * Supply the C64 system ROMs. Without them libsidplayfp initialises a tune
   * but never advances it. Sizes are exact: KERNAL 8192, BASIC 8192,
   * CHARGEN 4096 bytes. Pass nulls to clear.
   */
  setSystemROMs(
    kernal?: Uint8Array | ArrayBufferView | null,
    basic?: Uint8Array | ArrayBufferView | null,
    chargen?: Uint8Array | ArrayBufferView | null,
  ): boolean;

  /** Record every SID register write during render(). */
  setSidWriteTraceEnabled(enabled: boolean): void;
  getAndClearSidWriteTraces(): SidWriteTrace[];
  /**
   * The same records as a flat `Float64Array` of
   * `[sidNumber, address, value, cyclePhi1]` quadruples — one copy instead of
   * four cross-boundary property writes per record. A fresh copy.
   */
  getAndClearSidWriteTracesPacked(): Float64Array;
  /** Records dropped since the last drain because the buffer hit its cap. */
  getDroppedSidWriteTraceCount(): number;

  /** Release the C++ object. Embind handles are not garbage collected. */
  delete(): void;
  isDeleted(): boolean;
}

export interface LibsidplayfpWasmModule {
  FS: any;
  PATH: any;
  SidPlayerContext: typeof SidPlayerContext;
  /** Builder baked into this artifact: "WasmReSIDfp" or "WasmSIDLite". */
  getSidEngineName(): string;
}

export default function createLibsidplayfp(
  moduleConfig?: SidPlayerContextOptions,
): Promise<LibsidplayfpWasmModule>;
