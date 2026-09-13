# Third-party notices

This repository contains upstream runtime assets and data. This file is an attribution index, not a replacement for the licence texts or notices embedded in those assets.

| Component | Bundled location | Upstream attribution and notice |
| --- | --- | --- |
| UADE runtime | `assets/js/backend_uade.min.js`, `assets/uade.wasm` | webUADE's embedded header credits Juergen Wothke and states GPL-2.0-or-later. The runtime incorporates the UADE replay engine. |
| UADE data | `assets/uade/` | UADE configuration, system files, and replay-player database. Copyright and contributor attribution remain with the UADE project and its contributors. |
| Generic WebAudio Player | `assets/js/scriptprocessor_player.min.js` | Embedded header credits Juergen Wothke and states CC BY-NC-SA 4.0. |
| ChannelStreamer | `assets/js/channelstreamer.min.js` | Embedded header credits Juergen Wothke and states CC BY-NC-SA 4.0. |
| webXMP runtime | `../xmp/assets/backend_xmp.js`, `../xmp/assets/xmp.wasm` | Embedded header credits Juergen Wothke and states GPL-2.0-or-later. It wraps the libxmp replay engine. |
| XMP WebAudio Player | `../xmp/assets/scriptprocessor_player.min.js` | Embedded header credits Juergen Wothke. |
| Module Player format scout | `vendor/format-scout/` | Advisory JavaScript port of UADE `uade-3.05/src/frontends/common/amifilemagic.c` detection/result paths and `eagleplayer.conf` mappings. UADE remains authoritative for replay-player selection; the upstream file-magic source is marked dual GPL/Public Domain. |
| C64 system ROMs | `../demo/assets/roms/` | Authorized for this repository by its owner and sourced from [rjanicek/vice.js](https://github.com/rjanicek/vice.js), `fs-x64/bin/C64/`: `c64-kernal.rom` (8192 bytes, SHA-256 `83C60D47047D7BEAB8E5B7BF6F67F80DAA088B7A6A27DE0D7E016F6484042721`), `c64-basic.rom` (8192 bytes, SHA-256 `89878CEA0A268734696DE11C4BAE593EAAA506465D2029D619C0E0CBCCDFA62D`), and `c64-chargen.rom` (4096 bytes, SHA-256 `FD0D53B8480E86163AC98998976C72CC58D5DD8EB824ED7B829774E74213B420`). |
| Demo modules | `../demo/assets/music/` | `Arkanoid.sid` (`Arkanoid`) by Martin Galway for Imagine (1987); `GSLINGER.MOD` (`Guitar Slinger`) by Jogeir Liljedahl / Noiseless; `VESURI - Major Release.mod` (`Major Release`) by Vesuri da Jormas; `cust.hybris-title` (`Hybris title`, Custom format) by Paul van der Valk for Discovery Software / Cope-Com (1988); `di.partyland` (`Partyland`) by Olof Gustafsson / Digital Illusions; `elw-lock.xm` (`Dead lock`) by Elwood; `funky stars.xm` (`Hybrid song 2:20`, XM) by Quazar of Sanxion (1996); `Last_Ninja.sid` (`The Last Ninja`) by Ben Daglish and Anthony Lees; `onward.xm` (`Onward`) by Jugi / Complex; `sainahi_circles.mod` (`sainahi circles`, MOD) by A. Mikkonen; and `ghost battle (level 1).hipc` through `ghost battle (level 5).hipc` by Jochen Hippel. Full credits are in `../ACKNOWLEDGMENTS.md`. |

Keep all embedded copyright/licence headers intact, retain this notice file, and preserve the contributor acknowledgement in `../ACKNOWLEDGMENTS.md` in downstream redistributions. See `../LICENCE.md` and `../NOTICE.md` for the repository's licence scope and third-party notice index.
