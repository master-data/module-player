import type { EmulationConfig, EngineInfo, FilterConfig, LibsidplayfpWasmModule, ResolvedEmulationConfig, SidEngine, SidPlayerContextOptions, SidTuneInfo } from "./index.js";
export interface SidAudioEngineOptions extends SidPlayerContextOptions {
    sampleRate?: number;
    stereo?: boolean;
    module?: Promise<LibsidplayfpWasmModule>;
    /** Seconds of PCM the optional render cache may hold. 1..3600, default 600. */
    cacheSecondsLimit?: number;
    /**
     * SID emulation to render with. Defaults to DEFAULT_SID_ENGINE (SIDLite);
     * pass `residfp` for the cycle-accurate reference. Ignored when `module` is
     * supplied, since that module has already picked an engine.
     */
    engine?: SidEngine;
}
export interface SidWriteTrace {
    sidNumber: number;
    address: number;
    value: number;
    cyclePhi1: number;
}
export declare class SidAudioEngine {
    private modulePromise;
    private module;
    private context;
    private readonly sampleRate;
    private readonly stereo;
    private readonly maxCacheSeconds;
    private configured;
    private sidWriteTraceEnabled;
    private originalSidBuffer;
    private currentSongIndex;
    private cachePromise;
    private cachedPcm;
    private cacheSampleRate;
    private cacheChannels;
    private cacheToken;
    private pendingChunk;
    private pendingChunkOffset;
    private kernalRom;
    private basicRom;
    private chargenRom;
    private romSupportDisabled;
    private romFailureLogged;
    private emulationConfig;
    private filterConfig;
    private readonly engine;
    private logRecoverableFailure;
    private releaseContext;
    constructor(options?: SidAudioEngineOptions);
    private ensureModule;
    private createConfiguredContext;
    private loadPatchedBuffer;
    private cloneInput;
    /**
     * Push the configured ROM set into one context.
     *
     * The single place that decides what a ROM failure means: disable custom ROMs
     * for this engine, warn once, and fall back to the built-in images.
     */
    private pushSystemROMs;
    private applySystemROMs;
    /**
     * Whether the ROMs handed to setSystemROMs() are actually in effect.
     *
     * A failed injection is otherwise only a console warning, which leaves a host
     * unable to tell a correct RSID render from a built-in-ROM approximation of
     * one.
     */
    getRomStatus(): {
        requested: boolean;
        active: boolean;
        kernal: boolean;
        basic: boolean;
        chargen: boolean;
    };
    private patchStartSong;
    private loadBufferAtSong;
    private reloadCurrentSong;
    /**
     * Which engine this instance requested, or null when the caller supplied
     * their own module. For what the loaded artifact actually is, see
     * `getEngineName()`.
     */
    getEngine(): SidEngine | null;
    /** The builder name baked into the loaded artifact, e.g. "WasmSIDLite". */
    getEngineName(): Promise<string>;
    /**
     * Supply the C64 system ROMs.
     *
     * Strongly recommended: without them libsidplayfp initialises a tune but
     * never advances it, so many tunes render as silence or as a single held
     * frame. Sizes are exact — KERNAL 8192, BASIC 8192, CHARGEN 4096 bytes.
     *
     * The ROMs are copyrighted and are not shipped with this package. Dump them
     * from a real Commodore 64, and see the repository README ("System ROMs")
     * for the file names and search paths SIDFlow itself uses.
     */
    setSystemROMs(kernal?: Uint8Array | ArrayBufferView | null, basic?: Uint8Array | ArrayBufferView | null, chargen?: Uint8Array | ArrayBufferView | null): Promise<void>;
    loadSidBuffer(data: Uint8Array | ArrayBufferView, songIndex?: number): Promise<void>;
    selectSong(songIndex: number): Promise<number>;
    getChannels(): number;
    getSampleRate(): number;
    getTuneInfo(): SidTuneInfo | null;
    /** Engine, driver, ROM and chip details from libsidplayfp's SidInfo. */
    getEngineInfo(): EngineInfo | null;
    hasTune(): boolean;
    isStereo(): boolean;
    /**
     * Apply any subset of libsidplayfp's SidConfig — C64 and SID model, CIA
     * model, sampling method, digi boost, power-on delay, extra chip addresses.
     * A loaded tune is reloaded so the change takes effect from its start.
     */
    setEmulationConfig(config: EmulationConfig): Promise<void>;
    getEmulationConfig(): ResolvedEmulationConfig;
    /**
     * Apply reSIDfp filter and combined-waveform tuning.
     * Throws on the SIDLite artifact, which has no equivalent.
     */
    setFilterConfig(config: FilterConfig): void;
    supportsFilterConfig(): boolean;
    /** Mute or unmute voice 0..2 of SID chip `sidNum`. */
    mute(sidNum: number, voice: number, enable: boolean): void;
    /** Enable or bypass SID chip `sidNum`'s analogue filter. */
    setFilterEnabled(sidNum: number, enable: boolean): void;
    /** Emulated playback position, from libsidplayfp's own clock. */
    getTimeMs(): number;
    /** CIA 1 timer A latch — the real rate of a CIA-timed tune. */
    getCia1TimerA(): number;
    /** SID chips the player actually instantiated for the loaded tune. */
    getInstalledSids(): number;
    /** The 32 current registers of SID chip `sidNum`, for visualisers. */
    getSidStatus(sidNum: number): Uint8Array | null;
    /** HVSC `Songlengths.md5` key for the loaded tune, or null. */
    getTuneMd5(): string | null;
    private requireContext;
    reset(): void;
    setSidWriteTraceEnabled(enabled: boolean): void;
    getAndClearSidWriteTraces(): SidWriteTrace[];
    renderCycles(cycles?: number): Int16Array | null;
    renderSeconds(seconds: number, cyclesPerChunk?: number, onProgress?: (samplesWritten: number) => void): Promise<Int16Array>;
    renderFrames(frames: number, cyclesPerChunk?: number, onProgress?: (samplesWritten: number) => void, { loop }?: {
        loop?: boolean;
    }): Promise<Int16Array>;
    private consumeChunk;
    /**
     * Move playback to `seconds` from the start of the current subtune.
     *
     * Seeking always reloads and fast-forwards the live context, so the audio
     * returned by the next renderSeconds()/renderFrames() genuinely starts at the
     * requested position. The render cache is a separate, independently reset
     * render pass; serving playback from it would splice two different emulation
     * timelines. Its role is random-access read-out through getCachedSegment().
     *
     * @returns the number of samples actually skipped. This equals
     *   `floor(sampleRate * channels * seconds)` on success, and is smaller when
     *   the subtune ends first.
     */
    seekSeconds(seconds: number, cyclesPerChunk?: number): Promise<number>;
    waitForCacheReady(): Promise<boolean>;
    getCachedSegment(seconds: number, durationSeconds: number): Int16Array | null;
    /**
     * Advance the live context by `seconds` without retaining the audio.
     *
     * The loop is budgeted on samples actually produced, plus a consecutive
     * empty-read stall detector. Cycles and samples are not interchangeable and
     * the ratio is not constant: libsidplayfp clamps every play() call to 20 000
     * cycles, so one render() yields roughly 20 ms of audio whatever chunk size is
     * requested. A budget derived from the requested cycle count would stop an
     * order of magnitude short of the target.
     */
    private fastForwardContext;
    private resetCacheState;
    private resetPendingChunk;
    private startCache;
    private buildCacheBuffer;
    private cacheAvailable;
    /**
     * Release the C++ context, the cached PCM, and the WASM module.
     * Call this once the engine instance is finished with.
     */
    dispose(): void;
}
//# sourceMappingURL=player.d.ts.map