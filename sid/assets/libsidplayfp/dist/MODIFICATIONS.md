# Modifications to upstream sources

The GNU General Public License, version 2, section 2(a) requires that modified
files carry prominent notices stating that they were changed and the date of the
change. This file records every modification this project makes to libsidplayfp
and libresidfp before compiling them, and the in-file notices are inserted by
the scripts named below.

None of these changes are applied to your copy of upstream. They are applied to
a throwaway checkout inside the build container, at the exact commits pinned in
`upstream.json`, and the result is the `.wasm` files this package distributes.

Nothing here alters the emulation. The audio path is upstream's own, unchanged.

---

## 1. Filter-table threads run inline

* **Applied by:** `scripts/apply-thread-guards.py`
* **Changed files:** every `FilterModelConfig*.cpp` in libresidfp (as of
  libsidplayfp v3.x; earlier versions carried these under libsidplayfp's own
  `src/builders/`).
* **Date of change:** 2026-07-28, and unchanged since.

reSIDfp builds its filter lookup tables on helper threads. The Emscripten
runtime used here is single-threaded, so constructing a `std::thread` throws
`std::system_error: thread constructor failed: Not supported` on the first tune
load and the engine never produces a sample.

The patch retargets the `sidThread` type alias at a shim that runs the callable
inline on construction. Upstream's construction and join sites are untouched, so
the same tables are built, in the same order, by the same code — only
sequentially. The script fails the build if it finds thread usage it could not
neutralise, rather than silently producing an artifact that cannot start.

## 2. SID register write-trace hook

* **Applied by:** `scripts/apply-sid-write-hook.py`
* **Changed file:** `src/sidemu.cpp` in libsidplayfp.
* **Date of change:** 2026-07-28, and unchanged since.

Adds a nullable function pointer, consulted in `sidemu::writeReg` immediately
before `write(addr, data)`, so a host can observe SID register writes. The
pointer is null unless a caller explicitly enables tracing, and the hook only
reads — it cannot alter what the emulation receives or produces. With tracing
off, which is the default, the emulation is byte-for-byte upstream's.

## 3. pthread detection made non-fatal

* **Applied by:** `docker/entrypoint.sh`
* **Changed file:** `configure.ac` in libsidplayfp.
* **Date of change:** 2026-07-28, and unchanged since.

`AX_PTHREAD([], [AC_MSG_ERROR("pthreads not found")])` becomes
`AX_PTHREAD([], [])`, so configure does not abort in a single-threaded
WebAssembly target. Combined with modification 1, nothing in the build then
requires threads.

## 4. Optional libresidfp math flags

* **Applied by:** `docker/entrypoint.sh`, only when
  `LIBSIDPLAYFP_WASM_RESIDFP_MATH_FLAGS` is set.
* **Changed files:** generated `Makefile`s in libresidfp.
* **Date of change:** 2026-07-28, and unchanged since.

libresidfp's `configure.ac` hard-codes `-ffast-math
-fno-unsafe-math-optimizations` into `RESIDFP_CXXFLAGS` and appends them after
any value passed to configure, so they cannot be overridden on the configure
line. Rewriting the generated Makefile is the only way to vary them. **This
modification is not applied to released builds**; it exists so a maintainer can
investigate suspected floating-point divergence from a native build.

---

## Additions rather than modifications

The following are this project's own work, added alongside upstream rather than
changing it. They are GPL-2.0-or-later like the rest of the package.

* `src/bindings/bindings.cpp` — the embind wrapper exposing libsidplayfp to
  JavaScript.
* `src/index.ts`, `src/player.ts` — the loader and the `SidAudioEngine` wrapper.
* `docker/Dockerfile`, `docker/entrypoint.sh`, `scripts/build*.sh` — the build.

## Build flags

The distributed binaries are compiled with `-O3 -fwasm-exceptions` and linked
with `-sASSERTIONS=0`. libresidfp, libsidplayfp, and the bindings all use the
same exception ABI, because mixing them across a static archive does not link.
The exact command is in `docker/entrypoint.sh`.
