# Module Player

Browser and any web-compatible environment for tracker music. This repository combines two WebAssembly-backed playback engines behind small ESM APIs:

- **UADE** for Amiga music formats and the bundled UADE player database.
- **webXMP/libxmp** for PC tracker formats such as XM, IT, S3M, and MOD.

It also includes a standalone browser demo at `demo/`. The project is intended for integrating music previews into an application; it does not provide a CLI, build pipeline, or a general-purpose music player UI.

## Background and Design

Tracker music is not one interoperable format. UADE selects replay players from a large Amiga-oriented player database at runtime, while webXMP/libxmp handles many PC tracker families. Both upstream browser ports rely on global runtime state and Web Audio `ScriptProcessorNode`; this wrapper provides an ESM-facing lifecycle, a small common control surface, and browser-friendly metadata/diagnostics.

The wrapper deliberately does not own application UI, queue policy, file pickers, a seek bar, or canvas rendering. Consumers choose which engine to create, host its assets at a stable same-origin URL, initiate audio from a user gesture, and render any metadata or waveform data they need.

## Attribution and Notices

Module Player includes third-party runtimes, data, and demonstration modules. Their licensing and redistribution assessment is complete for this repository. Keep all embedded notices, [uade/LICENSES.md](uade/LICENSES.md), and [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md) with downstream redistributions.

## Acknowledgements

This repository is an integration layer built on the work of upstream projects and their contributors. It does not reimplement their replay engines.

- **UADE (Unix Amiga Delitracker Emulator)** was created by Heikki Orsila and its contributors. It supplies the Amiga replay engine, player database, configuration, and system data used by `uade/`.
- **webUADE** is by Juergen Wothke. It provides the UADE WebAssembly backend integration bundled as `uade/assets/js/backend_uade.min.js` and `uade/assets/uade.wasm`.
- **webXMP** is by Juergen Wothke. It provides the XMP WebAssembly backend integration bundled as `xmp/assets/backend_xmp.js` and `xmp/assets/xmp.wasm`, wrapping the libxmp replay engine.
- **Generic WebAudio Player** and **ChannelStreamer** are by Juergen Wothke. They provide the upstream ScriptProcessor playback path and optional channel waveform support.
- **libxmp** is by Claudio Matsuoka and its contributors. It supplies the tracker replay functionality behind the webXMP backend.
- **Format scout** is an advisory JavaScript port of UADE's `amifilemagic.c` result paths and `eagleplayer.conf` mappings. UADE remains authoritative for replay-player selection; the upstream file-magic source is marked dual GPL/Public Domain.
- **Demo modules**: `GSLINGER.MOD` (`02`) by Jogeir Liljedahl / Noiseless; `di.partyland` by Olof Gustafsson / Digital Illusions; `elw-lock.xm` (`Dead lock`) by Elwood; and `onward.xm` (`Onward`) by Jugi / Complex. See [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md) for the complete credit record.

Names and notices above identify upstream work; they do not replace the licences or required attribution. Retain the bundled file headers, [uade/LICENSES.md](uade/LICENSES.md), and [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md) in redistributions.

## Contents

```
index.js / index.d.ts       ESM umbrella entry: UADE and XMP APIs
uade/                       UADE player, metadata parser, visualization facade, and assets
xmp/                        XMP player and assets
demo/                       Static validation/demo application
demo/assets/music/          Bundled demo modules listed by music-manifest.json
```

The complete `uade/assets/` tree must remain together. UADE dynamically loads player binaries after identifying a module format.

`uade/vendor/format-scout/` is source bundled with this repository. It is used internally for file inspection and UADE format hints; it is not an external npm dependency or a supported package subpath.

## Run the Demo

No build step is required. Serve the repository root using any static HTTP server; opening the HTML file directly will not work because the demo fetches its module manifest and assets.

```powershell
npx serve . -l 4173
```

Open `http://localhost:4173/demo/`. Select **Initialize** from a user gesture, then choose a bundled module or a local file.

The demo lists `di.partyland`, `elw-lock.xm`, `GSLINGER.MOD`, and `onward.xm` in [demo/music-manifest.json](demo/music-manifest.json). It routes PC tracker extensions, including standard MOD files, to XMP first and uses UADE for Amiga formats; if UADE cannot load an unrecognised module, it retries with XMP.

## ESM APIs

The root entry exports both engines:

```js
import {
  createUadePlayer,
  parseUadeSongInfo,
  createXmpPlayer
} from "module-player";
```

Use the specific subpaths when an application needs only one engine:

```js
import { createUadePlayer, parseUadeSongInfo } from "module-player/uade";
import { createXmpPlayer } from "module-player/xmp";
```

### UADE

`assetBaseUrl` must resolve to the complete `uade/assets` directory. Browser audio must be initialized from a user gesture.

```js
const player = await createUadePlayer({
  assetBaseUrl: "/vendor/module-player/uade/assets",
  audioContextSampleRate: 44100,
  processorBufferSize: 4096,
  visualization: false
});

player.on("state", (state) => console.log(state));
player.on("metadata", (metadata) => console.log(parseUadeSongInfo(metadata)));
player.on("error", console.error);

await player.load(file, { track: 0, timeoutSeconds: 180 });
```

`load()` accepts a browser `File` or an `ArrayBuffer`. Supply `filename` when loading an `ArrayBuffer`, because UADE needs the original name/extension during format detection.

```js
await player.load(bytes, {
  filename: "song.mod",
  track: 0,
  timeoutSeconds: 180
});
```

UADE does not provide reliable seeking or playback position. `setPitchCoupledRate()` changes pitch and speed together. Some legacy formats need companion files; the current API mounts one primary file only.

The UADE runtime loads these scripts dynamically from `assetBaseUrl`:

```
js/scriptprocessor_player.min.js
js/backend_uade.min.js
js/channelstreamer.min.js     only when visualization is enabled
```

It preloads `uaerc`, `eagleplayer.conf`, and `system/score`. Other UADE player and system files are requested when a format needs them, so deployment must preserve asset paths and support normal same-origin `fetch` requests.

### XMP

XMP creates a same-origin hidden iframe to isolate the upstream runtime. Its assets must be served at `assetBaseUrl`, and only one XMP player can be active per document.

```js
const player = await createXmpPlayer({
  assetBaseUrl: "/vendor/module-player/xmp",
  audioContextSampleRate: 44100,
  processorBufferSize: 4096
});

await player.load(file, { loop: true });
```

Both players provide `load`, `pause`, `resume`, `stop`, `dispose`, volume, panning, timeout, and pitch-coupled-rate controls. Subscribe with `on("state" | "metadata" | "ended" | "error", listener)` and inspect performance with `getDiagnostics()`.

XMP's iframe sends messages only to its same-origin parent. It loads `xmp/frame.html`, which in turn loads its upstream backend assets. The iframe boundary prevents the UADE and XMP upstream globals from overwriting each other.

## Player Lifecycle

Create a player once per active preview session, attach listeners, then call `load()`. Loading starts playback when successful. `stop()` resets the active session; await it before loading another UADE track. `dispose()` releases the player and removes its active runtime ownership.

Both player types expose these states:

```
initializing -> ready -> loading -> playing <-> paused
                              |          |
                              v          v
                            error      ended

stopped and disposed can be reached by explicit calls.
```

`on(event, listener)` returns an unsubscribe function. UADE supports `state`, `metadata`, `format-scout`, `ended`, and `error`; XMP supports all except `format-scout`. Errors are emitted as `UadePlaybackError` or `XmpPlaybackError`, each with `operation`, optional `filename`, and the original `cause`.

Only one player of a given upstream runtime should be active at a time in one document. Create a new player after disposing the old one when changing UADE's requested sample rate, processor buffer size, or visualization mode.

## Loading and Controls

`load(input, options)` accepts a browser `File` or an `ArrayBuffer`. For raw buffers, `options.filename` is required. Options are:

```ts
{
  filename?: string;       // Required for ArrayBuffer input.
  track?: number;          // Subsong index; defaults to 0.
  timeoutSeconds?: number; // Per-load hard playback limit.
  loop?: boolean;          // Loop the loaded track.
}
```

The common controls are:

```js
player.setVolume(0.8);             // 0..1
player.setLooping(true);
player.setPitchCoupledRate(1.0);   // pitch and speed change together
player.setTimeout(180);            // seconds, or null for unlimited
player.setSilenceTimeout(5);       // seconds; 0 disables silence detection
player.setPanning(-1);             // null or -1..1
player.setUadePanning(0.7);        // UADE mapping: 0..2
```

`setPanning()` is a generic output transform: `null` disables it, `-1` preserves original stereo, `0` moves toward mono, and `1` inverts stereo. `setUadePanning()` maps UADE's native `0..2` affine channel mix to its internal `-1..1` representation; for XMP it is translated to the same generic panning control.

`audioContextSampleRate` requests an immutable Web Audio sample rate. The player rejects initialization if the browser selects a different rate. `processorBufferSize` configures the upstream `ScriptProcessorNode`; practical values are `2048`, `4096`, and `8192`. Smaller values reduce latency but give the main thread less time to generate audio. Start at `4096` and increase it when diagnostics show late callbacks.

## Metadata and Format Detection

UADE returns format-specific raw metadata. Pass it to `parseUadeSongInfo()` for stable display fields:

```js
const rawMetadata = await player.load(file);
const info = parseUadeSongInfo(rawMetadata);

console.log(info.title, info.fileName, info.format, info.player);
console.log(info.subsong, info.instruments, info.unparsedLines);
```

The parser recognises the common `MODINFO` layout and returns a title, filename, file length, player/format, subsong bounds, instrument rows, and unparsed source lines. It intentionally keeps unrecognised fields because UADE has no universal metadata schema.

Before UADE loads a file, it runs the internal format scout over the supplied bytes. The report is emitted as the `format-scout` event and attached to the raw UADE metadata as `formatScout`. It is advisory only: UADE's native file magic and player configuration remain the authority for player selection. Consumers should not depend on the vendored scout's private file path as a package API.

## Visualization

Set `visualization: true` for UADE only when consuming waveform data. It enables ChannelStreamer and additional audio work.

```js
const source = player.visualization;
const samples = source.readChannel(0);
const level = source.readVu(0);
```

UADE normally exposes tracker-channel waveforms. XMP exposes its stereo output scopes, not independent tracker-channel PCM streams. Use `source.streamCount` at runtime rather than assuming a channel count.

Do not enable UADE visualization merely to hide a canvas. It loads ChannelStreamer and performs additional data copying on the audio path. Consumers own the animation loop and should render only after playback has supplied non-silent data.

### XMP Pattern Data

XMP exposes optional decoded pattern data for MOD and XM modules. It can drive a tracker-style, per-channel pattern view:

```js
const tracker = player.tracker;

if (tracker.available) {
  const pattern = tracker.patterns[tracker.orders[0]];
  console.log(tracker.format, tracker.channelCount, pattern.rows);
  console.log(tracker.getPosition());
}
```

The data is static and read-only. `getPosition()` maps webXMP's live playback time onto decoded pattern timing and returns an estimated order, pattern, and row for MOD/XM playback. `tracker.synchronized` remains `false`: the bundled webXMP runtime does not expose libxmp's active frame, so tracker-specific flow quirks can differ from the estimate. Other XMP formats remain unavailable until they have a format-specific decoder or the native runtime bridge is extended.

The demo Pattern modal renders the actual XMP stereo output as `OUT L` and `OUT R` scopes for every supported pattern format. XMP does not expose independent tracker-channel PCM streams.

## Diagnostics

Call `getDiagnostics()` while playing to inspect the selected AudioContext rate, processor buffer size, callback budget, generation timing, late callback count, and audio-clock versus wall-clock measurements.

```js
const diagnostics = player.getDiagnostics();

console.log({
  rate: diagnostics.audioContextSampleRate,
  buffer: diagnostics.processorBufferSize,
  budgetMs: diagnostics.audioCallbackBudgetMs,
  generationMs: diagnostics.audioGenerationAverageMs,
  lateCallbacks: diagnostics.lateAudioCallbackCount
});
```

For stable playback, keep `audioGenerationAverageMs` materially below `audioCallbackBudgetMs`, expect `lateAudioCallbackCount` to stay at zero, and expect `audioClockToWallClockRatio` to approach `1` over a meaningful playback interval. Disable UADE visualization first when investigating glitches, then try `44100` or `48000` Hz and a larger processor buffer.

## Hosted Demo API

The static demo exposes `window.modulePlayerDemo` when hosted directly or in a same-origin iframe:

```js
const demo = document.querySelector("#demo").contentWindow.modulePlayerDemo;

await demo.initialize();
await demo.load(file);
await demo.load(bytes, { filename: "song.xm" });
await demo.stop();
await demo.dispose();
```

Call `initialize()` or `load()` directly from a user action so browser audio permissions can be granted. Cross-origin frames cannot access this API; use a same-origin deployment or design a `postMessage` protocol with explicit origin validation.

## Validation

Run the package checks before publishing:

```powershell
npm run check
npm run pack:check
git diff --check
```

The npm package includes only the ESM entry points and UADE/XMP runtime trees; the static demo and its music assets are excluded. `npm run pack:check` previews the package contents only; it is not a release approval.
