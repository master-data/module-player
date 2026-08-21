import { type LibsidplayfpWasmModule, type SidPlayerContextOptions } from "./libsidplayfp.js";
/**
 * Which SID emulation to load. Both are built from the same bindings and
 * shipped side by side — `dist/` is reSIDfp, `dist/sidlite/` is SIDLite. See
 * LIBSIDPLAYFP_WASM_ENGINE in docker/entrypoint.sh for how they are produced.
 */
export type SidEngine = "residfp" | "sidlite";
/**
 * SIDLite is the default: it sounds good and renders roughly an order of
 * magnitude faster, which is what bulk work such as classifying a corpus needs.
 * Once the mixer defects were fixed it was verified against reSIDfp on real
 * tunes — clean, unclipped, multi-SID included — and most listeners will not
 * hear the difference.
 *
 * Ask for `residfp` explicitly when the last few percent of fidelity is the
 * point. It is the cycle-accurate reference, and the remaining measurable gap
 * is DC offset: 0.003 against SIDLite's 0.10 on Commando.
 */
export declare const DEFAULT_SID_ENGINE: SidEngine;
export interface LoadLibsidplayfpOptions extends SidPlayerContextOptions {
    /**
     * Optional override for locating artifacts when bundlers relocate the WASM binary.
     * Defaults to the sibling dist/ directory.
     */
    locateFile?: SidPlayerContextOptions["locateFile"];
    /** Precedence: this value, then LIBSIDPLAYFP_WASM_ENGINE, then DEFAULT_SID_ENGINE. */
    engine?: SidEngine;
}
export declare function resolveSidEngine(engine?: SidEngine): SidEngine;
export declare function loadLibsidplayfp(options?: LoadLibsidplayfpOptions): Promise<LibsidplayfpWasmModule>;
export type { C64Model, CiaModel, CombinedWaveforms, EmulationConfig, EngineInfo, FilterConfig, LibsidplayfpWasmModule, ResolvedEmulationConfig, SamplingMethod, SidModel, SidPlayerContext, SidPlayerContextOptions, SidTuneInfo, TuneClock, TuneCompatibility, TuneSidModel } from "./libsidplayfp.js";
export { SidAudioEngine } from "./player.js";
export type { SidWriteTrace } from "./player.js";
/**
 * Which upstream releases this build contains.
 *
 * The npm version and the libsidplayfp version are the same number for a mirror
 * release and can differ after a downstream-only fix, so these constants — not
 * the package version — are the authority. See "Versioning" in the README.
 */
export { LIBRESIDFP_VERSION, LIBSIDPLAYFP_VERSION, PACKAGE_VERSION, UPSTREAM_COMMITS } from "./upstream-versions.js";
export default loadLibsidplayfp;
export { SonglengthDatabase } from "./songlengths.js";
//# sourceMappingURL=index.d.ts.map