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
| Demo modules | `../demo/assets/music/` | `GSLINGER.MOD` (`02`) by Jogeir Liljedahl / Noiseless; `di.partyland` by Olof Gustafsson / Digital Illusions; `onward.xm` (`Onward`) by Jugi / Complex. Full credits are in `../ACKNOWLEDGMENTS.md`. |

Keep all embedded copyright/licence headers intact, retain this notice file, and preserve the contributor acknowledgement in `../ACKNOWLEDGMENTS.md` in downstream redistributions. See `../LICENCE.md` and `../NOTICE.md` for the repository's licence scope and third-party notice index.
