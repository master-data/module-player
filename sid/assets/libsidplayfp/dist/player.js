import { loadLibsidplayfp, resolveSidEngine } from "./index.js";
const DEFAULT_CACHE_SECONDS = 600;
/**
 * A cache larger than this is refused outright.
 *
 * Int16 stereo at 44.1 kHz is 176 kB per second, so the default 600 s budget is
 * already ~106 MiB. Anything past an hour is a request to exhaust a mobile
 * browser rather than to cache audio.
 */
const MAX_CACHE_SECONDS = 3600;
/**
 * The furthest `seekSeconds` will go.
 *
 * libsidplayfp cannot skip: reaching a position means emulating every cycle up
 * to it, so the cost of a seek is linear in how far it goes. Without a bound, a
 * caller who passes a wrong number — a millisecond value, a stray multiply —
 * gets no error and no result, just a thread that renders for hours. On a main
 * thread that is a frozen tab.
 *
 * An hour is far past any real SID and matches the cache limit, so the bound
 * only ever catches a mistake.
 */
const MAX_SEEK_SECONDS = 3600;
/**
 * Consecutive empty render() results tolerated before a pull loop gives up.
 *
 * A tune that has ended returns nothing forever, so an unbounded loop would
 * spin. A few calls of slack covers the transient gap between a subtune's init
 * routine and its first play call.
 */
const EMPTY_READ_LIMIT = 64;
export class SidAudioEngine {
    modulePromise;
    module;
    context;
    sampleRate;
    stereo;
    maxCacheSeconds;
    configured = false;
    sidWriteTraceEnabled = false;
    originalSidBuffer = null;
    currentSongIndex = 0;
    cachePromise = null;
    cachedPcm = null;
    cacheSampleRate = 0;
    cacheChannels = 0;
    cacheToken = 0;
    pendingChunk = null;
    pendingChunkOffset = 0;
    kernalRom = null;
    basicRom = null;
    chargenRom = null;
    romSupportDisabled = false;
    romFailureLogged = false;
    // Emulation settings outlive any one context. Loading a tune, selecting a
    // subtune, or injecting ROMs all build a fresh SidPlayerContext, so the
    // configuration has to be re-applied to it or the caller's chosen C64 model,
    // SID model and filter tuning would silently revert on the next load.
    emulationConfig = {};
    filterConfig = {};
    engine;
    logRecoverableFailure(operation, error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.debug(`[SidAudioEngine] ${operation}`, { reason });
    }
    releaseContext(context) {
        const disposableContext = context;
        if (!disposableContext?.delete) {
            return;
        }
        try {
            if (disposableContext.isDeleted?.()) {
                return;
            }
            disposableContext.delete();
        }
        catch (error) {
            // Embind can already have destroyed the object after a failed load.
            this.logRecoverableFailure("Could not release a SID player context", error);
        }
    }
    constructor(options = {}) {
        const { module: moduleOverride, sampleRate, stereo, cacheSecondsLimit, ...loaderOptions } = options;
        // sampleRate is validated by the engine itself in configure(), which
        // reports the accepted range; createConfiguredContext() surfaces that as a
        // thrown error. Keeping the bound in one place stops the two from drifting.
        this.sampleRate = sampleRate ?? 44100;
        this.stereo = stereo ?? true;
        this.maxCacheSeconds = cacheSecondsLimit ?? DEFAULT_CACHE_SECONDS;
        if (!Number.isFinite(this.maxCacheSeconds) ||
            this.maxCacheSeconds <= 0 ||
            this.maxCacheSeconds > MAX_CACHE_SECONDS) {
            throw new Error(`cacheSecondsLimit must be between 0 and ${MAX_CACHE_SECONDS} seconds`);
        }
        // A caller-supplied module has already chosen an engine; reporting the
        // resolved default in that case would be a guess, so record null instead.
        this.engine = moduleOverride ? null : resolveSidEngine(options.engine);
        this.modulePromise = moduleOverride ?? loadLibsidplayfp(loaderOptions);
    }
    async ensureModule() {
        if (this.module) {
            return this.module;
        }
        const capturedPromise = this.modulePromise;
        if (!capturedPromise) {
            throw new Error("SidAudioEngine has been disposed");
        }
        const module = await capturedPromise;
        if (this.modulePromise !== capturedPromise) {
            throw new Error("SidAudioEngine has been disposed");
        }
        if (!this.module) {
            this.module = module;
        }
        return this.module;
    }
    async createConfiguredContext() {
        const module = await this.ensureModule();
        const ctx = new module.SidPlayerContext();
        if (!ctx.configure(this.sampleRate, this.stereo)) {
            throw new Error(`Failed to configure SID player: ${ctx.getLastError()}`);
        }
        if (Object.keys(this.emulationConfig).length > 0) {
            if (!ctx.setEmulationConfig(this.emulationConfig)) {
                throw new Error(`Failed to configure SID player: ${ctx.getLastError()}`);
            }
        }
        if (Object.keys(this.filterConfig).length > 0 && ctx.supportsFilterConfig()) {
            if (!ctx.setFilterConfig(this.filterConfig)) {
                throw new Error(`Failed to configure SID filter: ${ctx.getLastError()}`);
            }
        }
        ctx.setSidWriteTraceEnabled?.(this.sidWriteTraceEnabled);
        return ctx;
    }
    async loadPatchedBuffer(patched) {
        const previousContext = this.context;
        const ctx = await this.createConfiguredContext();
        try {
            // The direct/native contract configures ROMs before a tune is loaded.
            // Reversing that order lets interrupt-driven and multi-SID tunes initialise
            // against built-in ROMs, then hold a frame after the later ROM injection.
            this.applySystemROMs(ctx);
            if (!ctx.loadSidBuffer(patched)) {
                throw new Error(ctx.getLastError());
            }
            if (!ctx.reset()) {
                throw new Error(ctx.getLastError());
            }
            this.context = ctx;
            this.configured = true;
            this.releaseContext(previousContext);
            return ctx;
        }
        catch (error) {
            this.releaseContext(ctx);
            throw error;
        }
    }
    cloneInput(data) {
        if (data instanceof Uint8Array) {
            return new Uint8Array(data);
        }
        return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    }
    /**
     * Push the configured ROM set into one context.
     *
     * The single place that decides what a ROM failure means: disable custom ROMs
     * for this engine, warn once, and fall back to the built-in images.
     */
    pushSystemROMs(ctx) {
        try {
            if (!ctx.setSystemROMs(this.kernalRom ?? null, this.basicRom ?? null, this.chargenRom ?? null)) {
                throw new Error(ctx.getLastError());
            }
            return true;
        }
        catch (error) {
            this.romSupportDisabled = true;
            if (!this.romFailureLogged) {
                this.romFailureLogged = true;
                const reason = error instanceof Error ? error.message : String(error);
                console.warn("[SidAudioEngine] Custom ROM injection failed; falling back to built-in ROMs", { reason });
            }
            try {
                ctx.setSystemROMs(null, null, null);
            }
            catch (fallbackError) {
                const reason = fallbackError instanceof Error
                    ? fallbackError.message
                    : String(fallbackError);
                console.error("[SidAudioEngine] Failed to reset ROM configuration after custom ROM failure", { reason });
            }
            return false;
        }
    }
    applySystemROMs(ctx) {
        if (this.romSupportDisabled) {
            return;
        }
        if (!this.kernalRom && !this.basicRom && !this.chargenRom) {
            return;
        }
        this.pushSystemROMs(ctx);
    }
    /**
     * Whether the ROMs handed to setSystemROMs() are actually in effect.
     *
     * A failed injection is otherwise only a console warning, which leaves a host
     * unable to tell a correct RSID render from a built-in-ROM approximation of
     * one.
     */
    getRomStatus() {
        const requested = !!(this.kernalRom || this.basicRom || this.chargenRom);
        return {
            requested,
            active: requested && !this.romSupportDisabled,
            kernal: !!this.kernalRom,
            basic: !!this.basicRom,
            chargen: !!this.chargenRom,
        };
    }
    patchStartSong(buffer, songIndex) {
        if (buffer.length < 0x12) {
            throw new Error("SID buffer too small");
        }
        const headerOffset = 0x10;
        const patched = buffer.slice();
        const songs = (patched[0x0e] << 8) | patched[0x0f];
        const maxSong = songs > 0 ? songs : 1;
        const applied = Math.min(Math.max(1, Math.trunc(songIndex) + 1), maxSong);
        patched[headerOffset] = (applied >> 8) & 0xff;
        patched[headerOffset + 1] = applied & 0xff;
        return { data: patched, applied: applied - 1 };
    }
    async loadBufferAtSong(buffer, songIndex) {
        const { data, applied } = this.patchStartSong(buffer, songIndex);
        await this.loadPatchedBuffer(data);
        this.originalSidBuffer = buffer;
        this.currentSongIndex = applied;
        return applied;
    }
    async reloadCurrentSong() {
        if (!this.originalSidBuffer) {
            return 0;
        }
        return await this.loadBufferAtSong(this.originalSidBuffer, this.currentSongIndex);
    }
    /**
     * Which engine this instance requested, or null when the caller supplied
     * their own module. For what the loaded artifact actually is, see
     * `getEngineName()`.
     */
    getEngine() {
        return this.engine;
    }
    /** The builder name baked into the loaded artifact, e.g. "WasmSIDLite". */
    async getEngineName() {
        const module = await this.ensureModule();
        return typeof module.getSidEngineName === "function"
            ? module.getSidEngineName()
            : "unknown";
    }
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
    async setSystemROMs(kernal, basic, chargen) {
        this.kernalRom = kernal ? this.cloneInput(kernal) : null;
        this.basicRom = basic ? this.cloneInput(basic) : null;
        this.chargenRom = chargen ? this.cloneInput(chargen) : null;
        // Both flags reset before the early return below, so supplying ROMs before
        // a tune is loaded still re-arms the one-shot warning.
        this.romSupportDisabled = false;
        this.romFailureLogged = false;
        this.resetCacheState();
        this.resetPendingChunk();
        if (!this.context) {
            return;
        }
        this.pushSystemROMs(this.context);
        if (this.originalSidBuffer) {
            await this.reloadCurrentSong();
        }
    }
    async loadSidBuffer(data, songIndex = 0) {
        const candidate = this.cloneInput(data);
        const applied = await this.loadBufferAtSong(candidate, Math.max(0, Math.trunc(songIndex)));
        this.currentSongIndex = applied;
        this.resetCacheState();
        this.resetPendingChunk();
        // Don't start cache during initial load - it conflicts with rendering
        // Cache will be built on-demand for seeking
    }
    async selectSong(songIndex) {
        if (!this.originalSidBuffer) {
            throw new Error("Load a SID before selecting a song");
        }
        const applied = await this.loadBufferAtSong(this.originalSidBuffer, Math.max(0, Math.trunc(songIndex)));
        this.resetCacheState();
        this.resetPendingChunk();
        // Don't start cache during song selection - it conflicts with rendering
        return applied;
    }
    getChannels() {
        if (!this.context) {
            throw new Error("SID player not initialized");
        }
        return this.context.getChannels();
    }
    getSampleRate() {
        if (!this.context) {
            throw new Error("SID player not initialized");
        }
        return this.context.getSampleRate();
    }
    getTuneInfo() {
        if (!this.context) {
            return null;
        }
        return this.context.getTuneInfo();
    }
    /** Engine, driver, ROM and chip details from libsidplayfp's SidInfo. */
    getEngineInfo() {
        if (!this.context) {
            return null;
        }
        return this.context.getEngineInfo();
    }
    hasTune() {
        return this.context?.hasTune() ?? false;
    }
    isStereo() {
        return this.stereo;
    }
    /**
     * Apply any subset of libsidplayfp's SidConfig — C64 and SID model, CIA
     * model, sampling method, digi boost, power-on delay, extra chip addresses.
     * A loaded tune is reloaded so the change takes effect from its start.
     */
    async setEmulationConfig(config) {
        const context = this.requireContext();
        if (!context.setEmulationConfig(config)) {
            throw new Error(context.getLastError());
        }
        // Only remember settings the engine accepted, so a rejected value cannot
        // poison every later context.
        this.emulationConfig = { ...this.emulationConfig, ...config };
        this.resetCacheState();
        this.resetPendingChunk();
        if (this.originalSidBuffer) {
            await this.reloadCurrentSong();
        }
    }
    getEmulationConfig() {
        return this.requireContext().getEmulationConfig();
    }
    /**
     * Apply reSIDfp filter and combined-waveform tuning.
     * Throws on the SIDLite artifact, which has no equivalent.
     */
    setFilterConfig(config) {
        const context = this.requireContext();
        if (!context.setFilterConfig(config)) {
            throw new Error(context.getLastError());
        }
        this.filterConfig = { ...this.filterConfig, ...config };
    }
    supportsFilterConfig() {
        return this.context?.supportsFilterConfig() ?? false;
    }
    /** Mute or unmute voice 0..2 of SID chip `sidNum`. */
    mute(sidNum, voice, enable) {
        const context = this.requireContext();
        if (!context.mute(sidNum, voice, enable)) {
            throw new Error(context.getLastError());
        }
    }
    /** Enable or bypass SID chip `sidNum`'s analogue filter. */
    setFilterEnabled(sidNum, enable) {
        const context = this.requireContext();
        if (!context.setFilterEnabled(sidNum, enable)) {
            throw new Error(context.getLastError());
        }
    }
    /** Emulated playback position, from libsidplayfp's own clock. */
    getTimeMs() {
        return this.requireContext().getTimeMs();
    }
    /** CIA 1 timer A latch — the real rate of a CIA-timed tune. */
    getCia1TimerA() {
        return this.requireContext().getCia1TimerA();
    }
    /** SID chips the player actually instantiated for the loaded tune. */
    getInstalledSids() {
        return this.context?.getInstalledSids() ?? 0;
    }
    /** The 32 current registers of SID chip `sidNum`, for visualisers. */
    getSidStatus(sidNum) {
        return this.context?.getSidStatus(sidNum) ?? null;
    }
    /** HVSC `Songlengths.md5` key for the loaded tune, or null. */
    getTuneMd5() {
        const md5 = this.context?.getTuneMd5();
        return md5 ? md5 : null;
    }
    requireContext() {
        if (!this.context) {
            throw new Error("SID player not initialized");
        }
        return this.context;
    }
    reset() {
        if (!this.context) {
            return;
        }
        this.context.reset();
    }
    setSidWriteTraceEnabled(enabled) {
        this.sidWriteTraceEnabled = enabled;
        this.context?.setSidWriteTraceEnabled?.(enabled);
    }
    getAndClearSidWriteTraces() {
        const traces = this.context?.getAndClearSidWriteTraces?.();
        return Array.isArray(traces) ? traces.slice() : [];
    }
    renderCycles(cycles = 100000) {
        if (!this.context || !this.configured) {
            return null;
        }
        let chunk;
        try {
            chunk = this.context.render(cycles);
        }
        catch (error) {
            this.logRecoverableFailure("renderCycles failed", error);
            return null;
        }
        if (chunk === null) {
            return null;
        }
        if (chunk.length === 0) {
            return new Int16Array(0);
        }
        return chunk.slice();
    }
    async renderSeconds(seconds, cyclesPerChunk = 100000, onProgress) {
        if (!Number.isFinite(seconds) || seconds <= 0) {
            throw new Error("Duration must be a finite number of seconds above zero");
        }
        if (!this.context || !this.configured) {
            return new Int16Array(0);
        }
        const frames = Math.max(1, Math.floor(this.context.getSampleRate() * seconds));
        return this.renderFrames(frames, cyclesPerChunk, onProgress);
    }
    async renderFrames(frames, cyclesPerChunk = 100000, onProgress, { loop = false } = {}) {
        if (!Number.isFinite(frames) || frames <= 0) {
            throw new Error("Frame count must be a finite number above zero");
        }
        if (!this.context || !this.configured) {
            return new Int16Array(0);
        }
        const context = this.context;
        const channels = context.getChannels();
        const totalSamples = frames * channels;
        const buffer = new Int16Array(totalSamples);
        let offset = 0;
        const chunkCycles = Math.max(1, Math.floor(cyclesPerChunk));
        let emptyReads = 0;
        while (offset < totalSamples) {
            const next = this.consumeChunk(chunkCycles);
            const chunk = next?.chunk ?? null;
            const start = next?.start ?? 0;
            if (!chunk || chunk.length <= start) {
                emptyReads += 1;
                if (loop && emptyReads <= EMPTY_READ_LIMIT) {
                    if (!context.reset()) {
                        break;
                    }
                    this.resetPendingChunk();
                    continue;
                }
                break;
            }
            emptyReads = 0;
            const available = Math.min(chunk.length - start, totalSamples - offset);
            if (available <= 0) {
                break;
            }
            buffer.set(chunk.subarray(start, start + available), offset);
            offset += available;
            onProgress?.(offset);
            if (start + available < chunk.length) {
                // Preserve the remainder for the next call
                this.pendingChunk = chunk;
                this.pendingChunkOffset = start + available;
            }
            else {
                this.resetPendingChunk();
            }
        }
        return offset === buffer.length ? buffer : buffer.subarray(0, offset);
    }
    consumeChunk(cyclesPerChunk) {
        if (this.pendingChunk &&
            this.pendingChunkOffset < this.pendingChunk.length) {
            const chunk = this.pendingChunk;
            const start = this.pendingChunkOffset;
            this.pendingChunk = null;
            this.pendingChunkOffset = 0;
            return { chunk, start };
        }
        const chunk = this.renderCycles(cyclesPerChunk);
        if (!chunk || chunk.length === 0) {
            return null;
        }
        return { chunk, start: 0 };
    }
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
    async seekSeconds(seconds, cyclesPerChunk = 100000) {
        if (!Number.isFinite(seconds)) {
            throw new Error("Seek position must be a finite number of seconds");
        }
        if (seconds > MAX_SEEK_SECONDS) {
            throw new RangeError(`Seek position must be at most ${MAX_SEEK_SECONDS} seconds; ` +
                `got ${seconds}. Seeking emulates every cycle up to the target, so a ` +
                `larger value would render for hours rather than fail.`);
        }
        this.resetPendingChunk();
        await this.reloadCurrentSong();
        if (seconds <= 0) {
            return 0;
        }
        return this.fastForwardContext(seconds, cyclesPerChunk);
    }
    async waitForCacheReady() {
        // Cache construction is intentionally opt-in: pre-rendering the default
        // cache can retain over 100 MiB of PCM, which is unsuitable for mobile
        // browsers. Calling this existing readiness method is the explicit signal
        // that a caller intends to use cached seeking or waveform access.
        if (!this.cachePromise &&
            !this.cacheAvailable() &&
            this.originalSidBuffer) {
            this.startCache();
        }
        if (this.cachePromise) {
            try {
                await this.cachePromise;
            }
            catch (error) {
                this.logRecoverableFailure("The asynchronous render cache failed", error);
                return false;
            }
        }
        return this.cacheAvailable();
    }
    getCachedSegment(seconds, durationSeconds) {
        if (!this.cacheAvailable() || seconds < 0 || durationSeconds <= 0) {
            return null;
        }
        const samplesPerSecond = this.cacheSampleRate * this.cacheChannels;
        const start = Math.floor(samplesPerSecond * seconds);
        const length = Math.max(1, Math.floor(samplesPerSecond * durationSeconds));
        if (!this.cachedPcm || start + length > this.cachedPcm.length) {
            return null;
        }
        return this.cachedPcm.subarray(start, start + length).slice();
    }
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
    async fastForwardContext(seconds, cyclesPerChunk) {
        if (!this.context) {
            throw new Error("SID player not initialized");
        }
        const sampleRate = this.context.getSampleRate();
        const channels = this.context.getChannels();
        const targetSamples = Math.floor(sampleRate * channels * seconds);
        let skipped = 0;
        let emptyReads = 0;
        while (skipped < targetSamples) {
            let chunk;
            try {
                chunk = this.context.render(cyclesPerChunk);
            }
            catch (error) {
                this.logRecoverableFailure("Fast-forward render stopped", error);
                break;
            }
            if (chunk === null || chunk.length === 0) {
                // A tune that has ended returns nothing forever. Give the engine a few
                // calls to get past a transient gap, then stop rather than spin.
                if (++emptyReads > EMPTY_READ_LIMIT) {
                    break;
                }
                continue;
            }
            emptyReads = 0;
            skipped += chunk.length;
        }
        return Math.min(skipped, targetSamples);
    }
    resetCacheState() {
        this.cacheToken += 1;
        this.cachePromise = null;
        this.cachedPcm = null;
        this.cacheSampleRate = 0;
        this.cacheChannels = 0;
        this.resetPendingChunk();
    }
    resetPendingChunk() {
        this.pendingChunk = null;
        this.pendingChunkOffset = 0;
    }
    startCache() {
        if (!this.originalSidBuffer) {
            return;
        }
        const { data } = this.patchStartSong(this.originalSidBuffer, this.currentSongIndex);
        const token = this.cacheToken;
        const promise = this.buildCacheBuffer(data, token);
        this.cachePromise = promise;
        promise.finally(() => {
            if (this.cachePromise === promise) {
                this.cachePromise = null;
            }
        });
    }
    async buildCacheBuffer(buffer, token) {
        const module = await this.ensureModule();
        const ctx = new module.SidPlayerContext();
        try {
            if (!ctx.configure(this.sampleRate, this.stereo)) {
                return;
            }
            try {
                this.applySystemROMs(ctx);
            }
            catch (error) {
                this.logRecoverableFailure("Could not apply system ROMs to the render cache", error);
                return;
            }
            if (!ctx.loadSidBuffer(buffer)) {
                return;
            }
            if (!ctx.reset()) {
                return;
            }
            const channels = this.stereo ? 2 : 1;
            const maxSamples = Math.floor(this.sampleRate * channels * this.maxCacheSeconds);
            // One allocation for the whole cache. Accumulating chunks and then
            // concatenating them would hold the entire budget twice at the join —
            // 211 MiB at the 600 s default, on a path that mobile browsers reach.
            const combined = new Int16Array(maxSamples);
            let collected = 0;
            let iterationCount = 0;
            let emptyReads = 0;
            while (collected < maxSamples) {
                // Yield to the event loop periodically so cache construction cannot
                // starve foreground playback.
                if (++iterationCount % 20 === 0) {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
                let chunk;
                try {
                    chunk = ctx.render(100000);
                }
                catch (error) {
                    this.logRecoverableFailure("Render cache construction stopped", error);
                    break;
                }
                if (chunk === null || chunk.length === 0) {
                    if (++emptyReads > EMPTY_READ_LIMIT) {
                        break;
                    }
                    continue;
                }
                emptyReads = 0;
                // render() returns a view into WASM memory; set() copies it out. The
                // final chunk is clamped so the cache cannot exceed its budget just
                // because the renderer returned a large buffer.
                const take = Math.min(chunk.length, maxSamples - collected);
                combined.set(chunk.subarray(0, take), collected);
                collected += take;
            }
            if (this.cacheToken !== token) {
                return;
            }
            // subarray, not slice: a trimming copy would briefly hold the budget
            // twice, which is what this allocation strategy exists to avoid. Peak and
            // steady-state are both exactly the budget the caller asked for.
            this.cachedPcm = combined.subarray(0, collected);
            this.cacheSampleRate = this.sampleRate;
            this.cacheChannels = channels;
        }
        finally {
            this.releaseContext(ctx);
        }
    }
    cacheAvailable() {
        return (!!this.cachedPcm &&
            this.cacheSampleRate === this.sampleRate &&
            this.cacheChannels === (this.stereo ? 2 : 1));
    }
    /**
     * Release the C++ context, the cached PCM, and the WASM module.
     * Call this once the engine instance is finished with.
     */
    dispose() {
        this.releaseContext(this.context);
        this.context = undefined;
        this.configured = false;
        this.resetCacheState();
        this.originalSidBuffer = null;
        // Null module references so the WASM linear-memory ArrayBuffer (~64–128 MB)
        // becomes GC-eligible immediately rather than being held until the engine
        // wrapper object is eventually collected.
        this.module = undefined;
        this.modulePromise = undefined;
    }
}
//# sourceMappingURL=player.js.map