function htmlToLines(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
}

function parseNumber(value) {
  const number = Number.parseInt(value, 10);
  return Number.isNaN(number) ? undefined : number;
}

function parseSubsong(songInfo) {
  const minimum = parseNumber(songInfo.mins);
  const maximum = parseNumber(songInfo.maxs);
  const current = parseNumber(songInfo.curs);
  return minimum === undefined && maximum === undefined && current === undefined ? undefined : { minimum, maximum, current };
}

function parseInstrument(line) {
  const match = line.match(/^\[\s*(\d+)\]\s*-\s*(.*?)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s*$/);
  if (!match) return undefined;
  return {
    index: Number.parseInt(match[1], 10),
    name: match[2].trim() || undefined,
    size: Number.parseInt(match[3], 10),
    volume: Number.parseInt(match[4], 10),
    fineTune: Number.parseInt(match[5], 10),
    loopStart: Number.parseInt(match[6], 10),
    loopSize: Number.parseInt(match[7], 10)
  };
}

/**
 * Converts UADE's format-specific song metadata into stable, display-friendly data.
 * Fields that UADE does not recognize remain undefined; unparsed lines are retained.
 */
export function parseUadeSongInfo(songInfo = {}) {
  const lines = htmlToLines(songInfo.infoText);
  const result = {
    title: undefined,
    fileName: undefined,
    fileLengthBytes: undefined,
    filePrefix: undefined,
    maxPositions: undefined,
    format: songInfo.format || undefined,
    player: songInfo.player || undefined,
    summary: [songInfo.info1, songInfo.info2, songInfo.info3].filter(Boolean),
    subsong: parseSubsong(songInfo),
    instruments: [],
    unparsedLines: []
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === "MODINFO:" || line.startsWith("INST - ")) continue;
    const instrument = parseInstrument(line);
    if (instrument) {
      result.instruments.push(instrument);
      continue;
    }

    const field = line.match(/^([^:]+):\s*(.*)$/);
    if (!field) {
      result.unparsedLines.push(line);
      continue;
    }

    const label = field[1].trim().toLowerCase();
    const value = field[2].trim();
    if (label === "file name") result.fileName = value || undefined;
    else if (label === "file length") result.fileLengthBytes = parseNumber(value);
    else if (label === "file prefix") result.filePrefix = value || undefined;
    else if (label === "song title") result.title = value || undefined;
    else if (label === "max positions") result.maxPositions = parseNumber(value);
    else result.unparsedLines.push(line);
  }

  return result;
}