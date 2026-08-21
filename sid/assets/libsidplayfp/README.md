# libsidplayfp WASM

[![npm](https://img.shields.io/npm/v/libsidplayfp-wasm.svg)](https://www.npmjs.com/package/libsidplayfp-wasm)
[![Build](https://img.shields.io/github/actions/workflow/status/chrisgleissner/libsidplayfp-wasm/ci.yaml)](https://github.com/chrisgleissner/libsidplayfp-wasm/actions/workflows/ci.yaml)
[![Codecov](https://codecov.io/gh/chrisgleissner/libsidplayfp-wasm/graph/badge.svg)](https://app.codecov.io/gh/chrisgleissner/libsidplayfp-wasm)
[![License: GPL v2 or later](https://img.shields.io/badge/License-GPL%20v2%2B-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)
[![Runtime](https://img.shields.io/badge/runtime-Browser%20%7C%20Node.js%20%7C%20Bun-forestgreen)](https://github.com/chrisgleissner/libsidplayfp-wasm#browsers-and-bundlers)

Play Commodore 64 SID music in the browser, Node.js, or Bun.

This is [libsidplayfp](https://github.com/libsidplayfp/libsidplayfp) compiled to
WebAssembly, with TypeScript types and a `SidAudioEngine` wrapper. It runs the
tune's own 6510 code inside a cycle-based emulation of the C64 and its SID chips,
so what you hear is the program playing, not a file being read.

Two SID emulations come with it: **reSIDfp**, which models the 6581 and 8580
chips as faithfully as it can while staying realtime, and **SIDLite**, which
approximates them and renders about an order of magnitude faster.

Every build is compared sample-for-sample against a native build of the same
source before it is published.

```bash
npm install libsidplayfp-wasm
```

## 🎵 Play a SID

```ts
import { SidAudioEngine } from "libsidplayfp-wasm";

const engine = new SidAudioEngine();
await engine.loadSidBuffer(new Uint8Array(sidFileBytes));

const pcm = await engine.renderSeconds(60); // interleaved 16-bit stereo PCM
engine.dispose();
```

`renderSeconds` returns a plain `Int16Array` you own. To stream instead of
rendering ahead, pull fixed-size blocks:

```ts
const block = await engine.renderFrames(4096); // 4096 frames, interleaved
```

Subtunes, seeking, and metadata:

```ts
const info = engine.getTuneInfo();       // songs, chips, clock, format, infoStrings…
await engine.selectSong(2);              // 0-based; clamped to the tune's range
await engine.seekSeconds(30);            // repositions playback, not just the counter
engine.getTimeMs();                      // libsidplayfp's own playback clock
engine.getTuneMd5();                     // key into HVSC Songlengths.md5
```

Call `dispose()` when finished. It deletes the underlying C++ object, which is
not garbage collected, and drops the reference to the WebAssembly heap so it
becomes collectable.

## 〰️ Shaping the sound

A SID sounds different depending on the machine it is played back on. All of
libsidplayfp's emulation settings are available:

```ts
await engine.setEmulationConfig({
  c64Model: "NTSC",      // PAL | NTSC | OLD_NTSC | DREAN | PAL_M
  forceC64Model: true,   // ignore what the tune's header claims
  sidModel: "MOS8580",   // MOS6581 | MOS8580 - audibly very different chips
  forceSidModel: true,
  digiBoost: true,       // improves 8580 digi playback
});
```

Per-voice control and register read-back, for players and visualisers:

```ts
engine.mute(0, 2, true);            // silence voice 3 of the first chip
engine.setFilterEnabled(0, false);  // bypass its analogue filter
engine.getSidStatus(0);             // Uint8Array(32) of live register values
engine.getInstalledSids();          // 1, 2 or 3 for multi-SID tunes
```

The reSIDfp engine additionally models the analogue filter closely enough that
you can tune it toward a particular physical chip:

```ts
if (engine.supportsFilterConfig()) {
  engine.setFilterConfig({
    filter6581Curve: 0.5,         // 0.0 (dark) .. 1.0 (bright)
    filter6581Range: 0.5,
    old6581Caps: true,            // the leakier original capacitors
    combinedWaveforms: "AVERAGE", // AVERAGE | WEAK | STRONG
  });
}
```

> `filter6581Range` and `old6581Caps` are process-global inside reSIDfp: they
> reach a shared model through static methods, so they affect every player in
> the same WebAssembly instance. The rest are per chip.

## ⚙️ Engines

Pick per instance.

| Engine  | Select with | Use it for |
| ------- | ----------- | ---------- |
| SIDLite | `"sidlite"` | The default. Fast, clean playback and bulk corpus work. |
| reSIDfp | `"residfp"` | Cycle-exact 6581/8580 emulation. The only one of the two that supports filter tuning. |

```ts
const accurate = new SidAudioEngine({ engine: "residfp" });
```

`LIBSIDPLAYFP_WASM_ENGINE` sets a process-wide default; an explicit `engine`
option always wins.

## 🔧 Lower-level access

The default export gives you libsidplayfp's `SidPlayerContext` directly. It is
the same object `SidAudioEngine` drives, minus the buffer management.

```ts
import loadLibsidplayfp from "libsidplayfp-wasm";

const module = await loadLibsidplayfp({ engine: "residfp" });
const player = new module.SidPlayerContext();
try {
  player.configure(48_000, true);
  player.loadSidBuffer(new Uint8Array(sidFileBytes));
  // render() returns a view into WebAssembly memory: the next render()
  // overwrites it and a heap growth detaches it. Copy before doing anything else.
  const pcm = player.render(100_000).slice();
} finally {
  player.delete(); // WebAssembly objects are not garbage collected
}
```

`SidAudioEngine` copies for you; the transient-buffer contract applies only
here.

Every method libsidplayfp exposes is reachable, and a check in CI reports it if
a future upstream release adds one this binding has not caught up with.

## ⏱️ How long is this tune?

SID files carry no duration — a tune plays until you stop it. HVSC publishes
`Songlengths.md5`, keyed by the same MD5 the engine computes.

```ts
import { SonglengthDatabase } from "libsidplayfp-wasm";

const songlengths = SonglengthDatabase.parse(
  await (await fetch("/Songlengths.md5")).text(),
);

const md5 = await player.getTuneMd5();
const seconds = songlengths.lengthSeconds(md5, player.getTuneInfo().currentSong);
```

Absent tunes and out-of-range songs return `null`, and a malformed line costs
you that line rather than the database. Parsing matches libsidplayfp's own
`SidDatabase`, down to `.5` meaning 500 ms.

## 🌐 Browsers and bundlers

The loader finds its `.wasm` beside its JavaScript. If your bundler relocates
static assets, say where they went:

```ts
const module = await loadLibsidplayfp({
  locateFile: (asset) => `/wasm/${asset}`,
});
```

Copy both `dist/libsidplayfp.*` and `dist/sidlite/libsidplayfp.*` if your users
can choose an engine. In Node-like runtimes `LIBSIDPLAYFP_WASM_PATH` overrides
the binary path.

The binaries use [WebAssembly exception
handling](https://webassembly.org/features/), so they need a runtime that
supports it. Every browser Playwright ships is verified on each commit, and the
packed package is installed and made to play a SID under **Node 20, 22 and 24**
on every commit. Bun works too - the test suite runs on it.

## 💾 C64 ROMs

Tunes that run as real C64 programs - RSID, and anything driven by interrupts or
BASIC - need the KERNAL, BASIC, and CHARGEN ROMs. Without them libsidplayfp
initialises the tune but never advances it, so it renders as silence or a single
held frame.

Those ROMs are copyrighted and are not distributed here. Supply legally obtained
images (KERNAL 8 KiB, BASIC 8 KiB, CHARGEN 4 KiB) and confirm they took effect:

```ts
await engine.setSystemROMs(kernal, basic, chargen);
engine.getRomStatus(); // { requested: true, active: true, … }
```

## 🔢 Which libsidplayfp am I getting?

The package version and the libsidplayfp version inside it are related but not
always identical, so the build states what it contains:

```ts
import { LIBSIDPLAYFP_VERSION, LIBRESIDFP_VERSION } from "libsidplayfp-wasm";
```

This package versions itself, on its own `1.x` line: an upstream engine bump
takes a minor, a fix of our own takes a patch. So `1.2.0` tells you the binding
changed, not which libsidplayfp is inside it — the constants above do that.

It will switch to mirroring upstream once this distribution has a track record,
and a release that only advances libsidplayfp will then carry upstream's exact
version — `v3.0.2` publishing as `3.0.2`.

Because semver has no version between `3.0.2` and `3.0.3`, a fix to *this*
package takes the next free patch and keeps the same upstream pin, and a mirror
steps over any number already used:

| Version | Contains libsidplayfp | |
| ------- | --------------------- | --- |
| `3.0.2` | `v3.0.2` | exact mirror |
| `3.0.3` | `v3.0.2` | a fix here; upstream unchanged |
| `3.0.4` | `v3.0.3` | mirror, one ahead because `3.0.3` was used |
| `3.1.0` | `v3.1.0` | exact again - drift closes at every upstream minor |

The exported constants are always exact, whichever scheme is in force.

## ✅ How releases are verified

An emulator can sound plausible while being subtly wrong, so correctness here is
settled by comparing the WebAssembly build against a native build of the same
source at the same pinned commits, not by listening.

**Every commit**

- Full unit suite at **100% line coverage**.
- **Native differential parity**: both engines compared sample-for-sample
  against a *native* build of libsidplayfp at the same pinned commit. SIDLite
  matches bit for bit; reSIDfp holds correlation > 0.99999 with an error floor
  of −81 to −90 dBFS, below the SID's own noise floor.
- **Browsers**: Chromium and Firefox on the desktop, Chromium as a Pixel 5,
  WebKit as an iPhone 13 — including playback from module workers.
- **Determinism**: identical audio on repeat and at any chunk size.
- The packed tarball is installed into a clean project and made to play a SID
  under Node 20, 22 and 24.

**Every release**

A release does not repeat the checks above — it refuses to start unless that
commit's own run of them was green. What it adds is everything about the
artifact rather than the source:

- Engines rebuilt from immutable upstream commits; the build aborts if a tag no
  longer resolves to the pinned commit, and each binary is checked to contain the
  engine it claims and not the other.
- The exact tarball that will be published is installed into a clean project and
  made to play a SID **before** it is published.
- After publishing, that exact version is **reinstalled from npm** and made to
  play a SID. The tag and release are created only if that succeeds.

**Weekly, and whenever the engine's own bytes change**

- **1,678 tunes** selected from HVSC #85's 61,157 — every multi-SID, every
  BASIC-driven RSID, every file with 32+ subtunes, plus 400 each sampled from
  the RSID and zero-play-address populations — rendered through both engines and
  compared against native builds. This also runs on any pull request that
  touches the upstream pins, the toolchain or the bindings.
- A soak renders two hours of emulated playback per engine and requires the
  WebAssembly heap to stay flat.

Every release ships an SBOM, SHA-256 checksums, and build provenance.

## ⚖️ Licence and attribution

GPL-2.0-or-later, like libsidplayfp. The binaries also contain MIT components
(`hashlib`, musl, the Emscripten runtime) and LLVM runtime libraries under
Apache-2.0 with LLVM Exceptions.

- [`LICENSE`](LICENSE) — the GPL-2.0 text.
- [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) — every component compiled
  in, with its licence and copyright.
- [`MODIFICATIONS.md`](MODIFICATIONS.md) — what this project changes in
  libsidplayfp and libresidfp. None of it alters the emulation.
- **`dist/complete-source.tar.gz`, inside this package** — the complete
  corresponding source for the binaries, also attached to every release.

**This is an independent redistribution**, not an official libsidplayfp product,
and not endorsed by or affiliated with its authors. Report problems here rather
than upstream, unless a native sidplayfp reproduces them.

No C64 ROMs, SID tunes, or music corpora are distributed.

Contributing? See [`AGENTS.md`](AGENTS.md).
