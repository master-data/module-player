import createLibsidplayfp from "./libsidplayfp.js";
/**
 * Read a configuration variable, preferring the current name over the SIDFlow
 * alias this package kept for existing callers.
 *
 * Read on demand rather than captured at module load, so a host that configures
 * its environment after importing the loader is still honoured. Browsers and
 * workers have no `process`, which is the case the guard exists for.
 */
function readEnv(name, alias) {
    if (typeof process === "undefined" || typeof process.env !== "object") {
        return undefined;
    }
    return (process.env[name] ?? process.env[alias])?.trim() || undefined;
}
/** Node-like: no DOM window, and a process to read the environment from. */
function isServerLikeEnvironment() {
    return typeof globalThis.window === "undefined"
        && typeof process !== "undefined";
}
/** Explicit path to one specific `.wasm`, for hosts that relocate it. */
function wasmPathOverride() {
    return readEnv("LIBSIDPLAYFP_WASM_PATH", "SIDFLOW_LIBSIDPLAYFP_WASM_PATH");
}
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
export const DEFAULT_SID_ENGINE = "sidlite";
function envEngine() {
    const raw = readEnv("LIBSIDPLAYFP_WASM_ENGINE", "SIDFLOW_SID_ENGINE")?.toLowerCase();
    return raw === "residfp" || raw === "sidlite" ? raw : undefined;
}
export function resolveSidEngine(engine) {
    return engine ?? envEngine() ?? DEFAULT_SID_ENGINE;
}
/**
 * Memoised default modules, keyed by what actually determines the artifact:
 * the engine and the binary path override.
 *
 * The override is read on demand, so a host that changes it must get a module
 * built against the new path rather than whatever was cached under the old one.
 */
const cachedDefaultModulePromises = new Map();
function defaultModuleCacheKey(engine) {
    return `${engine}\u0000${(isServerLikeEnvironment() ? wasmPathOverride() : undefined) ?? ""}`;
}
async function createModulePromise(options) {
    const engine = resolveSidEngine(options.engine);
    // No `locateFile` unless someone asked for one. Emscripten's own default
    // resolves the `.wasm` against the glue module's location, which is right in
    // every layout — beside `dist/index.js`, or wherever a consumer copied those
    // files to. Computing a URL here instead used to hard-code the assumption
    // that the directory is called `dist`, so deploying the files flat broke it.
    //
    // The path override names one specific binary, so it can only apply to the
    // engine the caller actually asked for.
    const override = isServerLikeEnvironment() ? wasmPathOverride() : undefined;
    const locate = options.locateFile ?? (override ? () => override : undefined);
    // reSIDfp keeps the static import so bundlers can see it. SIDLite is loaded
    // dynamically: it is the secondary artifact and must not become a hard
    // dependency of every bundle that only ever wants the default engine.
    const factory = engine === "sidlite"
        ? (await import("./sidlite/libsidplayfp.js")).default
        : createLibsidplayfp;
    const { engine: _engine, ...moduleOptions } = options;
    return await factory({
        ...moduleOptions,
        ...(locate ? { locateFile: locate } : {})
    });
}
function isCacheableDefaultLoad(options) {
    const keys = Object.keys(options);
    return keys.length === 0 || (keys.length === 1 && keys[0] === "engine");
}
export async function loadLibsidplayfp(options = {}) {
    if (isCacheableDefaultLoad(options)) {
        const key = defaultModuleCacheKey(resolveSidEngine(options.engine));
        let cached = cachedDefaultModulePromises.get(key);
        if (!cached) {
            // Evict on failure, or every later caller inherits the rejection and
            // a transient problem becomes permanent for the process.
            cached = createModulePromise(options).catch((error) => {
                cachedDefaultModulePromises.delete(key);
                throw error;
            });
            cachedDefaultModulePromises.set(key, cached);
        }
        return await cached;
    }
    return await createModulePromise(options);
}
export { SidAudioEngine } from "./player.js";
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
//# sourceMappingURL=index.js.map