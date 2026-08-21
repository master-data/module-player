# Third-party notices

`libsidplayfp-wasm` distributes compiled WebAssembly binaries
(`dist/libsidplayfp.wasm`, `dist/sidlite/libsidplayfp.wasm`) and their generated
JavaScript loaders. Those files incorporate the third-party components listed
below. This file records their licences and copyright notices as those licences
require.

The package as a whole is distributed under **GPL-2.0-or-later**. See
[`LICENSE`](LICENSE) for the licence text, and "Complete corresponding source"
below for how to obtain the source of the distributed binaries.

---

## 1. libsidplayfp

* **Licence:** GNU General Public License, version 2 or (at your option) any
  later version.
* **Source:** <https://github.com/libsidplayfp/libsidplayfp>
* **Version distributed:** see `LIBSIDPLAYFP_VERSION` and `UPSTREAM_COMMITS` in
  the package, and `upstream.json` in the repository.

```
Copyright (c) 2000 Simon White
Copyright (c) 2007-2010 Antti Lankila
Copyright (c) 2010-2026 Leandro Nini
```

Contributed or derived work, as recorded in the upstream `AUTHORS.md`:

```
Dag Lem           - reSID library
Michael Schwendt  - initial implementation of SidTune library,
                    SidTune Wrapper, MD5 (based on work by L. Peter Deutsch)
Simon White       - Majority of LIBSIDPLAY2 Code
Antti Lankila     - SID distortion simulation (reSID-fp), emulation improvements
Leandro Nini      - build system rewrite, code refactoring,
                    backporting fixes from jsidplay2 and VICE,
                    emulation improvements
LaLa              - stilview
André Fachat      - reloc65
Jarno Paananen    - HardSID UNIX builder
```

This project modifies libsidplayfp before compiling it. See
[`MODIFICATIONS.md`](MODIFICATIONS.md).

## 2. SIDLite

* **Licence:** GNU General Public License, version 2 or later.
* **Source:** distributed within libsidplayfp, at
  `src/builders/sidlite-builder/`.

```
Copyright (C) 2025-2026 Leandro Nini
```

SIDLite is the emulation in `dist/sidlite/libsidplayfp.wasm` and is absent from
`dist/libsidplayfp.wasm`.

## 3. libresidfp (reSIDfp)

* **Licence:** GNU General Public License, version 2 or later.
* **Source:** <https://github.com/libsidplayfp/libresidfp>
* **Version distributed:** see `LIBRESIDFP_VERSION` in the package.

From the upstream `AUTHORS`:

```
Dag Lem            - designed and programmed the complete emulation engine
Antti S. Lankila   - distortion simulation and calculation of combined waveforms
Ken Händel         - source code conversion to Java
Leandro Nini       - port back to C++, merge with reSID 1.0, further improvements
```

reSIDfp is the emulation in `dist/libsidplayfp.wasm` and is absent from
`dist/sidlite/libsidplayfp.wasm`. This project modifies libresidfp before
compiling it; see [`MODIFICATIONS.md`](MODIFICATIONS.md).

## 4. hashlib

Bundled inside libsidplayfp at `src/libs/hashlib/` and linked into both
binaries. It implements the MD5 used by `getTuneMd5()`.

* **Licence:** MIT
* **Source:** bundled in libsidplayfp; upstream is Cra3z's `hashlib`.

```
MIT License

Copyright (c) 2025 Cra3z

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 5. Emscripten runtime

The generated `libsidplayfp.js` loaders contain Emscripten runtime code.

* **Licence:** MIT, or the University of Illinois/NCSA Open Source License, at
  the recipient's option.
* **Source:** <https://github.com/emscripten-core/emscripten>
* **Version:** the `emscripten/emsdk` image tag pinned in `docker/Dockerfile`.

```
Copyright (c) 2010-2014 Emscripten authors, see AUTHORS file.
```

## 6. musl libc

Portions are compiled into both `.wasm` binaries as Emscripten's C library.

* **Licence:** MIT
* **Source:** <https://musl.libc.org/>

```
Copyright © 2005-2020 Rich Felker, et al.
```

## 7. LLVM runtime libraries (libc++, libc++abi, compiler-rt)

Portions are compiled into both `.wasm` binaries by the Emscripten toolchain.

* **Licence:** Apache License 2.0 with LLVM Exceptions.
* **Source:** <https://github.com/llvm/llvm-project>

The LLVM Exception exists for exactly this situation: it permits redistributing
compiler-embedded portions of these runtimes without applying the Apache
conditions to the resulting work. Note also that libsidplayfp and libresidfp are
GPL-2.0-**or-later**, so the combined work may be conveyed under GPL-3.0, under
which Apache-2.0 is in any case compatible.

---

## Complete corresponding source

The `.wasm` files in this package are object code covered by the GNU General
Public License. You are entitled to the complete corresponding source, which
consists of:

1. **libsidplayfp** at the exact commit in `UPSTREAM_COMMITS.libsidplayfp`,
   from <https://github.com/libsidplayfp/libsidplayfp>.
2. **libresidfp** at the exact commit in `UPSTREAM_COMMITS.libresidfp`, from
   <https://github.com/libsidplayfp/libresidfp>.
3. The **modifications** this project applies to both, which are the scripts
   `scripts/apply-thread-guards.py` and `scripts/apply-sid-write-hook.py` in
   <https://github.com/chrisgleissner/libsidplayfp-wasm>, described in
   [`MODIFICATIONS.md`](MODIFICATIONS.md).
4. The **binding source** `src/bindings/bindings.cpp`, and the **build scripts**
   `docker/Dockerfile`, `docker/entrypoint.sh`, and `scripts/build*.sh`, from
   the same repository.

**The source is in this package.** `dist/complete-source.tar.gz` contains all
four items above: both upstream projects at their exact pinned commits, the
scripts that modify them, the bindings, and the build. It accompanies the object
code it corresponds to, which is what section 3(a) of the GPL asks for.

The same archive is attached to every GitHub release as
`libsidplayfp-wasm-<version>-complete-source.tar.gz`, and can also be
reconstructed from <https://github.com/chrisgleissner/libsidplayfp-wasm> at the
tag matching this package version by running `bun run build:source`.

To rebuild the binaries from it:

```bash
tar -xzf node_modules/libsidplayfp-wasm/dist/complete-source.tar.gz
cd libsidplayfp-wasm-*-complete-source/libsidplayfp-wasm
bash scripts/build-all-wasm.sh
```

---

## Not distributed

For the avoidance of doubt, this package does **not** contain, and never has
contained:

* **Commodore 64 ROM images** (KERNAL, BASIC, CHARGEN). They are copyrighted and
  must be supplied by you. The test suite fetches checksum-pinned ROMs at test
  time only; they are never committed and never packaged.
* **SID music files** from HVSC or any other collection. The repository contains
  two synthetic test tones generated by `scripts/generate-test-sid.ts`, and
  neither is included in the published package.
* **The HVSC corpus** used for release testing. It is downloaded to a local
  cache at test time and is excluded from both the repository and the package.

`scripts/check-package.mjs` fails the build if any of these appear in the packed
tarball.

---

## Not affiliated with upstream

This is an independent redistribution. It is **not** an official libsidplayfp,
libresidfp, or SIDLite product, and it is not endorsed by or affiliated with
their authors. Report problems with this package to
<https://github.com/chrisgleissner/libsidplayfp-wasm/issues>, not to the
upstream projects, unless a native build of libsidplayfp reproduces the same
behaviour.
