const encoder = new TextEncoder();

function ascii(value) {
  return encoder.encode(value);
}

export function hasBytes(data, offset, value) {
  const signature = typeof value === "string" ? ascii(value) : value;
  return offset >= 0 && offset + signature.length <= data.length && signature.every((byte, index) => data[offset + index] === byte);
}

export function readLe32(data, offset) {
  return offset + 4 <= data.length
    ? data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)
    : undefined;
}

function rule(id, format, platform, extensions, test, options = {}) {
  return Object.freeze({ id, format, platform, extensions, test, confidence: "high", ...options });
}

function iffType(data) {
  return hasBytes(data, 0, "FORM") || hasBytes(data, 0, "LIST") || hasBytes(data, 0, "CAT ")
    ? String.fromCharCode(...data.slice(8, 12))
    : undefined;
}

function mzKind(data) {
  if (!hasBytes(data, 0, "MZ") && !hasBytes(data, 0, "ZM")) return undefined;
  const headerOffset = readLe32(data, 0x3c);
  if (headerOffset === undefined || headerOffset < 0 || headerOffset + 2 > data.length) return "DOS MZ executable";
  const marker = String.fromCharCode(data[headerOffset], data[headerOffset + 1]);
  if (marker === "PE" && hasBytes(data, headerOffset, [0x50, 0x45, 0, 0])) return "Windows Portable Executable";
  if (["NE", "LE", "LX"].includes(marker)) return `${marker} executable`;
  return "DOS MZ executable";
}

const MAGIC_RULES = Object.freeze([
  rule("amiga/iff", "Amiga IFF container", "Amiga", ["iff", "ilbm", "lbm", "anim", "8svx", "aiff", "aif", "aifc", "smus"], (data) => Boolean(iffType(data)), { mime: "application/x-iff", detail: (data) => iffType(data) }),
  rule("amiga/ilbm", "Amiga IFF ILBM image", "Amiga", ["ilbm", "iff", "lbm"], (data) => iffType(data) === "ILBM", { mime: "image/x-ilbm" }),
  rule("amiga/anim", "Amiga IFF ANIM animation", "Amiga", ["anim", "iff"], (data) => iffType(data) === "ANIM"),
  rule("amiga/8svx", "Amiga IFF 8SVX audio", "Amiga", ["8svx", "iff"], (data) => iffType(data) === "8SVX", { mime: "audio/x-8svx" }),
  rule("audio/aiff", "AIFF audio", "cross-platform", ["aiff", "aif"], (data) => iffType(data) === "AIFF", { mime: "audio/aiff" }),
  rule("audio/aifc", "AIFC audio", "cross-platform", ["aifc"], (data) => iffType(data) === "AIFC", { mime: "audio/aiff" }),
  rule("amiga/smus", "Amiga SMUS score", "Amiga", ["smus", "iff"], (data) => iffType(data) === "SMUS"),
  rule("amiga/hunk", "Amiga Hunk executable or object", "Amiga", ["exe", "o", "obj", "library", "device", "handler"], (data) => hasBytes(data, 0, [0, 0, 3, 0xf3])),
  rule("amiga/dms", "DMS disk archive", "Amiga", ["dms"], (data) => hasBytes(data, 0, "DMS!")),
  rule("amiga/lha", "LHA/LZH archive", "Amiga", ["lha", "lzh"], (data) => data.length > 7 && hasBytes(data, 2, "-lh")),
  rule("dos/mz", "DOS or Windows executable", "IBM PC", ["exe", "dll", "sys", "ocx"], (data) => Boolean(mzKind(data)), { detail: (data) => mzKind(data) }),
  rule("image/bmp", "Windows bitmap", "IBM PC", ["bmp", "dib"], (data) => ["BM", "BA", "CI", "CP", "IC", "PT"].some((marker) => hasBytes(data, 0, marker)), { mime: "image/bmp" }),
  rule("image/pcx", "ZSoft PCX image", "IBM PC", ["pcx"], (data) => data.length >= 4 && data[0] === 0x0a && [0, 2, 3, 5].includes(data[1])),
  rule("audio/voc", "Creative Voice audio", "IBM PC", ["voc"], (data) => hasBytes(data, 0, "Creative Voice File")),
  rule("audio/midi", "Standard MIDI file", "cross-platform", ["mid", "midi"], (data) => hasBytes(data, 0, "MThd"), { mime: "audio/midi" }),
  rule("tracker/impulse", "Impulse Tracker module", "IBM PC", ["it"], (data) => hasBytes(data, 0, "IMPM")),
  rule("tracker/669", "Composer 669 module", "IBM PC", ["669"], (data) => hasBytes(data, 0, "if") || hasBytes(data, 0, "JN")),
  rule("tracker/far", "Farandole Composer module", "IBM PC", ["far"], (data) => hasBytes(data, 0, "FAR")),
  rule("document/rtf", "Rich Text Format document", "cross-platform", ["rtf"], (data) => hasBytes(data, 0, "{\\rtf"), { mime: "application/rtf" }),
  rule("document/ole", "OLE Compound File", "IBM PC", ["doc", "xls", "ppt", "msi"], (data) => hasBytes(data, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  rule("archive/arj", "ARJ archive", "IBM PC", ["arj"], (data) => hasBytes(data, 0, [0x60, 0xea])),
  rule("archive/cab", "Microsoft Cabinet archive", "IBM PC", ["cab"], (data) => hasBytes(data, 0, "MSCF")),
  rule("disk/imd", "ImageDisk floppy image", "IBM PC", ["imd"], (data) => hasBytes(data, 0, "IMD ")),
  rule("disk/teledisk", "Teledisk floppy image", "IBM PC", ["td0"], (data) => hasBytes(data, 0, "TD") || hasBytes(data, 0, "td")),
  rule("mac/appledouble", "AppleDouble metadata sidecar", "Classic Macintosh", [], (data) => hasBytes(data, 0, [0, 0, 1, 0, 0, 0, 2, 0])),
  rule("atari/gemdos", "Atari ST GEMDOS executable", "Atari ST", ["prg", "tos", "ttp", "gtp", "app"], (data) => hasBytes(data, 0, [0x60, 0x1a]) || hasBytes(data, 0, [0x60, 0x1c])),
  rule("c64/p00", "Commodore 64 P00 wrapper", "Commodore 64", ["p00"], (data) => hasBytes(data, 0, "C64File")),
  rule("c64/g64", "Commodore 64 G64 disk image", "Commodore 64", ["g64"], (data) => hasBytes(data, 0, "GCR-1541")),
  rule("c64/tap", "Commodore 64 TAP tape image", "Commodore 64", ["tap"], (data) => hasBytes(data, 0, "C64-TAPE-RAW")),
  rule("c64/cartridge", "Commodore 64 cartridge image", "Commodore 64", ["crt"], (data) => hasBytes(data, 0, "C64 CARTRIDGE   ")),
  rule("c64/sid", "Commodore 64 SID music", "Commodore 64", ["sid"], (data) => hasBytes(data, 0, "PSID") || hasBytes(data, 0, "RSID")),
  rule("apple2/2img", "Apple II 2IMG disk image", "Apple II", ["2mg", "2img"], (data) => hasBytes(data, 0, "2IMG")),
  rule("apple2/woz", "Apple II WOZ disk image", "Apple II", ["woz"], (data) => hasBytes(data, 0, "WOZ1") || hasBytes(data, 0, "WOZ2")),
  rule("spectrum/tzx", "ZX Spectrum TZX tape image", "ZX Spectrum", ["tzx"], (data) => hasBytes(data, 0, "ZXTape!\x1a")),
  rule("amstrad/dsk", "Amstrad CPC disk image", "Amstrad CPC", ["dsk"], (data) => hasBytes(data, 0, "MV - CPCEMU Disk-File") || hasBytes(data, 0, "EXTENDED CPC DSK File")),
  rule("unix/elf", "ELF executable or shared object", "Unix/Linux", ["so", "o"], (data) => hasBytes(data, 0, [0x7f, 0x45, 0x4c, 0x46])),
  rule("unix/ar", "Unix ar archive", "Unix/Linux", ["a", "deb"], (data) => hasBytes(data, 0, "!<arch>\n")),
  rule("unix/tar", "tar archive", "Unix/Linux", ["tar"], (data) => hasBytes(data, 257, "ustar")),
  rule("unix/compress", "Unix compress archive", "Unix/Linux", ["z"], (data) => hasBytes(data, 0, [0x1f, 0x9d])),
  rule("archive/bzip2", "bzip2 archive", "cross-platform", ["bz2"], (data) => hasBytes(data, 0, "BZh")),
  rule("archive/xz", "XZ archive", "cross-platform", ["xz"], (data) => hasBytes(data, 0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0])),
  rule("package/rpm", "RPM package", "Unix/Linux", ["rpm"], (data) => hasBytes(data, 0, [0xed, 0xab, 0xee, 0xdb])),
  rule("script/shebang", "Script with shebang", "cross-platform", ["sh", "py", "pl", "rb"], (data) => hasBytes(data, 0, "#!"), { confidence: "medium" })
]);

export const CONTEXT_HINTS = Object.freeze([
  ["adf", "Amiga or Acorn raw disk image"], ["adz", "gzip-compressed Amiga disk image"], ["hdf", "raw hard disk image"], ["d64", "Commodore 64 raw disk image"], ["d71", "Commodore 1571 raw disk image"], ["d81", "Commodore 1581 raw disk image"], ["dsk", "ambiguous raw disk image"], ["img", "ambiguous image or raw disk image"], ["ima", "raw PC floppy image"], ["st", "Atari ST raw disk image"], ["ssd", "BBC Micro raw disk image"], ["dsd", "BBC Micro raw disk image"], ["tap", "ambiguous tape image"], ["com", "DOS or CP/M raw executable"], ["prg", "Commodore 64 program"], ["scr", "ambiguous screen or screensaver"], ["bin", "generic binary data"], ["sna", "snapshot requiring structural analysis"], ["z80", "snapshot requiring structural analysis"], ["trd", "TR-DOS raw disk image"], ["nib", "Apple II nibble disk image"], ["po", "Apple II ProDOS disk image"], ["hfe", "HxC floppy image"], ["scp", "SuperCard Pro flux image"], ["ipf", "SPS floppy preservation image"], ["vhd", "virtual hard disk"], ["vfd", "virtual floppy disk"], ["pict", "Macintosh PICT image"], ["pct", "Macintosh PICT image"], ["guide", "AmigaGuide text document"], ["amigaguide", "AmigaGuide text document"], ["rexx", "ARexx script"], ["rx", "ARexx script"],
  ["info", "Amiga Workbench icon or metadata"], ["slave", "WHDLoad loader"], ["brush", "Amiga bitmap or brush"], ["cdxl", "Amiga CDXL animation"], ["xl", "Amiga CDXL animation"], ["fli", "Autodesk Animator animation"], ["flc", "Autodesk Animator animation"], ["cel", "ambiguous CEL image"], ["rle", "ambiguous RLE image"], ["tga", "Targa image requiring structural validation"], ["mus", "ambiguous music data"], ["rol", "Ad Lib/Sierra music"], ["cmf", "Creative Music Format"], ["doc", "legacy word-processing document"], ["dbf", "dBase or FoxPro database"], ["dbt", "dBase memo"], ["fpt", "FoxPro memo"], ["pdx", "Paradox database"], ["wk1", "Lotus 1-2-3 spreadsheet"], ["wk2", "Lotus 1-2-3 spreadsheet"], ["wk3", "Lotus 1-2-3 spreadsheet"], ["wks", "Lotus 1-2-3 spreadsheet"], ["arc", "ARC archive"], ["pak", "ambiguous PAK archive"], ["zoo", "ZOO archive"], ["sq", "Squeeze compressed file"], ["sqz", "Squeeze compressed file"], ["cqm", "CopyQM disk image"], ["fdi", "ambiguous FDI disk image"], ["raw", "raw disk or flux stream"], ["macbin", "MacBinary wrapper"], ["hqx", "BinHex encoded Macintosh file"], ["sit", "StuffIt archive"], ["sea", "self-extracting Macintosh archive"], ["cpt", "Compact Pro archive"], ["as", "AppleSingle metadata container"], ["neo", "Atari Neochrome image"], ["pi1", "Atari DEGAS image"], ["pi2", "Atari DEGAS image"], ["pi3", "Atari DEGAS image"], ["pc1", "Atari DEGAS Elite image"], ["pc2", "Atari DEGAS Elite image"], ["pc3", "Atari DEGAS Elite image"], ["spc", "Atari Spectrum 512 image"], ["sps", "Atari Spectrum 512 image"], ["msa", "Atari MSA disk image"], ["stx", "Atari STX preservation image"], ["sndh", "Atari SNDH music"], ["dsp", "Atari Falcon DSP data"], ["rel", "Commodore relative file"], ["seq", "Commodore sequential file"], ["usr", "Commodore user file"], ["do", "Apple II DOS sector image"], ["d13", "Apple II DOS 3.3 disk image"], ["shk", "Apple II ShrinkIt/NuFX archive"], ["sdk", "Apple II ShrinkIt archive"], ["bny", "Apple II Binary II wrapper"], ["bqy", "Apple II Binary II wrapper"], ["uef", "BBC Micro UEF tape image"], ["spr", "RISC OS sprite file"], ["draw", "RISC OS Draw file"], ["cdt", "Amstrad CPC tape image"], ["bas", "tokenized BASIC or text source"], ["cpio", "cpio archive"]
].map(([extension, format]) => Object.freeze({ extension, format })));

export function scoutCatalog(data, extension) {
  const matches = MAGIC_RULES.filter((entry) => entry.test(data)).map((entry) => ({
    id: entry.id,
    format: entry.detail?.(data) ?? entry.format,
    platform: entry.platform,
    mime: entry.mime,
    confidence: entry.confidence,
    evidence: [{ kind: "magic", offset: 0 }],
    extensions: entry.extensions
  }));
  if (matches.length || !extension) return matches;
  const hint = CONTEXT_HINTS.find((entry) => entry.extension === extension);
  return hint ? [{ id: `hint/${extension}`, format: hint.format, confidence: "low", needsContext: true, evidence: [{ kind: "extension", extension }], extensions: [extension] }] : [];
}
