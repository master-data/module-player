const SID_MAGIC_LENGTH = 4;
const SID_INFO_STRING_LENGTH = 32;
const PSID_MAGIC = "PSID";
const RSID_MAGIC = "RSID";

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError("SID input must be an ArrayBuffer or Uint8Array.");
}

function readAscii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readUint16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes, offset) {
  return (bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function decodeInfoString(bytes, offset) {
  const end = Math.min(offset + SID_INFO_STRING_LENGTH, bytes.length);
  let terminator = offset;
  while (terminator < end && bytes[terminator] !== 0) terminator += 1;
  return new TextDecoder("windows-1252").decode(bytes.subarray(offset, terminator)).trim() || undefined;
}

function sidModel(bits) {
  if (bits === 1) return "MOS6581";
  if (bits === 2) return "MOS8580";
  return "unknown";
}

function clock(bits) {
  if (bits === 1) return "PAL";
  if (bits === 2) return "NTSC";
  if (bits === 3) return "PAL/NTSC";
  return "unknown";
}

export function isSidFile(input) {
  const bytes = asBytes(input);
  if (bytes.byteLength < SID_MAGIC_LENGTH) return false;
  const magic = readAscii(bytes, 0, SID_MAGIC_LENGTH);
  return magic === PSID_MAGIC || magic === RSID_MAGIC;
}

/**
 * Parse the fixed PSID/RSID header without executing C64 program code.
 * Header fields are big-endian, as defined by the PSID v4 specification.
 */
export function parseSidMetadata(input, options = {}) {
  const bytes = asBytes(input);
  if (!isSidFile(bytes)) throw new TypeError("The file does not begin with a PSID or RSID header.");
  if (bytes.byteLength < 118) throw new RangeError("The SID header is truncated.");

  const format = readAscii(bytes, 0, SID_MAGIC_LENGTH);
  const version = readUint16(bytes, 4);
  const dataOffset = readUint16(bytes, 6);
  if (version < 1 || version > 4) throw new RangeError(`Unsupported ${format} version ${version}.`);
  if (dataOffset < 118 || dataOffset > bytes.byteLength) throw new RangeError("The SID data offset is outside the file.");
  if (version >= 2 && dataOffset < 124) throw new RangeError("The SID v2+ header is truncated.");

  const songCount = readUint16(bytes, 14);
  const startSong = readUint16(bytes, 16);
  if (!songCount) throw new RangeError("The SID header declares no songs.");
  if (!startSong || startSong > songCount) throw new RangeError("The SID header has an invalid start song.");

  const flags = version >= 2 ? readUint16(bytes, 118) : 0;
  const sid2Address = version >= 3 ? bytes[122] : 0;
  const sid3Address = version >= 4 ? bytes[123] : 0;
  const installedSids = 1 + Number(Boolean(sid2Address)) + Number(Boolean(sid3Address));
  const currentSong = Math.min(Math.max(Number(options.track ?? startSong - 1), 0), songCount - 1);

  return {
    format,
    version,
    fileName: options.filename,
    fileLengthBytes: bytes.byteLength,
    dataOffset,
    loadAddress: readUint16(bytes, 8),
    initAddress: readUint16(bytes, 10),
    playAddress: readUint16(bytes, 12),
    songCount,
    startSong: startSong - 1,
    currentSong,
    speed: readUint32(bytes, 18),
    title: decodeInfoString(bytes, 22),
    author: decodeInfoString(bytes, 54),
    released: decodeInfoString(bytes, 86),
    clock: clock((flags >> 2) & 0x3),
    sidModel: sidModel((flags >> 4) & 0x3),
    installedSids,
    sid2Address: sid2Address || undefined,
    sid3Address: sid3Address || undefined,
    requiresRoms: format === RSID_MAGIC
  };
}