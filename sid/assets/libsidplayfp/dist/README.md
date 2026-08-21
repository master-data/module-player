# libsidplayfp WebAssembly build

This bundle is produced by `docker/entrypoint.sh` in
[libsidplayfp-wasm](https://github.com/chrisgleissner/libsidplayfp-wasm). It
exposes libsidplayfp's `SidPlayerContext` through an embind wrapper so you can
drive the C64 SID player from JavaScript or TypeScript.

Most callers should use the package's `SidAudioEngine` wrapper instead — it
handles buffer copying, subtune selection, and disposal. Reach for this module
directly when you want the raw engine.

## Quick start

```ts
import createLibsidplayfp from "./libsidplayfp.js";

const module = await createLibsidplayfp();
const player = new module.SidPlayerContext();

try {
  if (!player.configure(48_000, true)) throw new Error(player.getLastError());

  const response = await fetch("Commando.sid");
  if (!player.loadSidBuffer(new Uint8Array(await response.arrayBuffer()))) {
    throw new Error(player.getLastError());
  }

  // render() returns a VIEW into WASM memory. The next render() overwrites it
  // and a heap growth detaches it, so copy before doing anything else.
  const pcm = player.render(20_000).slice();
} finally {
  // embind handles are not garbage collected.
  player.delete();
}
```

## Notes

* `libsidplayfp.d.ts` documents the full surface, including emulation
  configuration (`setEmulationConfig`), reSIDfp filter tuning
  (`setFilterConfig`), per-voice muting (`mute`), register read-back
  (`getSidStatus`), and the HVSC songlength key (`getTuneMd5`).
* Correct RSID and BASIC playback needs the C64 KERNAL, BASIC, and CHARGEN
  ROMs. They are copyrighted and are not distributed here; supply legally
  obtained images through `setSystemROMs()`.
* The module runs in browsers, workers, and Node.js. To use `loadSidFile()`,
  mount the file into Emscripten's virtual filesystem (`module.FS`) first;
  browsers should use `loadSidBuffer()` instead.
