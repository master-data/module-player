# Acknowledgments

## SID Playback

- **libsidplayfp** is by its upstream contributors and supplies the C64 SID
	emulation behind `sid/`.
- **libsidplayfp-wasm** is by Christian Gleissner and supplies the vendored
	WebAssembly distribution and JavaScript bindings. See [sid/UPSTREAM.md](sid/UPSTREAM.md)
	and [NOTICE.md](NOTICE.md) for the retained licensing material.

Module Player is an integration layer with UADE, webXMP/libxmp, and libsidplayfp WebAssembly backends. Its playback capabilities depend on the following projects and the contributors recorded by each upstream project.

| Project or work | Contributors acknowledged | Role in Module Player |
| --- | --- | --- |
| [UADE](https://zakalwe.fi/uade/) | Heikki Orsila and all UADE contributors | Amiga replay engine, player database, configuration, and system data. |
| [webUADE](https://bitbucket.org/wothke/uade-2.13/src/master/) | Juergen Wothke | WebAssembly UADE runtime integration. |
| [libxmp](https://github.com/libxmp/libxmp) | Claudio Matsuoka and all libxmp contributors | Tracker replay engine used by the XMP runtime. |
| [webXMP](https://www.wothke.ch/webXMP/) | Juergen Wothke | WebAssembly libxmp runtime integration. |
| Generic WebAudio Player and ChannelStreamer | Juergen Wothke | Browser audio playback and optional channel visualization support. |
| Emscripten | The Emscripten contributors | Generated WebAssembly runtime glue included in upstream browser runtimes. |
| Module Player format scout, derived from UADE `amifilemagic.c` and `eagleplayer.conf` | UADE contributors | Advisory format detection and player hints; UADE remains authoritative for replay-player selection. |

## Demonstration Modules

The demo bundles the following separate creative works. Their authors and rights holders retain all credit for them.

| Bundled file | Title or work | Creator and group | Copyright |
| --- | --- | --- | --- |
| `GSLINGER.MOD` | `Guitar Slinger` | Jogeir Liljedahl / Noiseless | (c) 1992/93 Noiseless |
| `VESURI - Major Release.mod` | `Major Release` | Vesuri da Jormas | |
| `di.partyland` | `Partyland` | Olof Gustafsson  | Digital Illusions |
| `elw-lock.xm` | `Dead lock` | Elwood | |
| `Last_Ninja.sid` | `The Last Ninja` | Ben Daglish & Anthony Lees | 1987 System 3 |
| `onward.xm` | `Onward` | Jugi / Complex | (c) 1995 Jugi / Complex |
| `ghost battle (level 1).hipc` | `Ghost Battle (level 1)` | Jochen Hippel | |
| `ghost battle (level 2).hipc` | `Ghost Battle (level 2)` | Jochen Hippel | |
| `ghost battle (level 3).hipc` | `Ghost Battle (level 3)` | Jochen Hippel | |
| `ghost battle (level 4).hipc` | `Ghost Battle (level 4)` | Jochen Hippel | |
| `ghost battle (level 5).hipc` | `Ghost Battle (level 5)` | Jochen Hippel | |

Their inclusion and redistribution were reviewed for this repository; retain the works and their associated attribution in downstream redistributions.

## Attribution Scope

This document acknowledges the named maintainers and all contributors recorded by each upstream project. It supplements, rather than replaces, upstream copyright notices, licence texts, and contributor records embedded in the bundled assets.