const XM_SIGNATURE = "Extended Module: ";

function emptyEvent() {
  return { note: 0, instrument: 0, volume: 0, effect: 0, parameter: 0 };
}

function decodeModEvent(view, offset) {
  const first = view.getUint8(offset);
  const second = view.getUint8(offset + 1);
  const third = view.getUint8(offset + 2);
  return {
    note: ((first & 0x0f) << 8) | second,
    instrument: (first & 0xf0) | (third >> 4),
    volume: 0,
    effect: third & 0x0f,
    parameter: view.getUint8(offset + 3)
  };
}

function parseMod(buffer) {
  if (buffer.byteLength < 1084) return undefined;
  const view = new DataView(buffer);
  const signature = new TextDecoder().decode(new Uint8Array(buffer, 1080, 4));
  const channelCount = { "M.K.": 4, "M!K!": 4, "4CHN": 4, "6CHN": 6, "8CHN": 8, "FLT4": 4, "FLT8": 8 }[signature]
    ?? (/^(\d{1,2})CH$/.exec(signature)?.[1] && Number(/^(\d{1,2})CH$/.exec(signature)[1]));
  if (!channelCount) return undefined;

  const songLength = view.getUint8(950);
  const orders = Array.from(new Uint8Array(buffer, 952, songLength));
  const patternCount = Math.max(...orders, 0) + 1;
  const patternSize = 64 * channelCount * 4;
  if (1084 + patternCount * patternSize > buffer.byteLength) return undefined;
  const patterns = Array.from({ length: patternCount }, (_, pattern) => ({
    rows: Array.from({ length: 64 }, (_, row) => Array.from({ length: channelCount }, (_, channel) => decodeModEvent(view, 1084 + pattern * patternSize + (row * channelCount + channel) * 4)))
  }));
  return { format: "MOD", channelCount, orders, patterns, speed: 6, bpm: 125 };
}

function parseXmEvent(view, offset, packedSize) {
  const event = emptyEvent();
  if (!packedSize) return { event, size: 0 };
  const first = view.getUint8(offset);
  if (!(first & 0x80)) {
    event.note = first;
    event.instrument = view.getUint8(offset + 1);
    event.volume = view.getUint8(offset + 2);
    event.effect = view.getUint8(offset + 3);
    event.parameter = view.getUint8(offset + 4);
    return { event, size: 5 };
  }
  let size = 1;
  for (const [bit, field] of [[0, "note"], [1, "instrument"], [2, "volume"], [3, "effect"], [4, "parameter"]]) {
    if (first & (1 << bit)) event[field] = view.getUint8(offset + size++);
  }
  return { event, size };
}

function parseXm(buffer) {
  if (buffer.byteLength < 80 || new TextDecoder().decode(new Uint8Array(buffer, 0, 17)) !== XM_SIGNATURE) return undefined;
  const view = new DataView(buffer);
  const headerSize = view.getUint32(60, true);
  const songLength = view.getUint16(64, true);
  const channelCount = view.getUint16(68, true);
  const patternCount = view.getUint16(70, true);
  const speed = view.getUint16(76, true);
  const bpm = view.getUint16(78, true);
  const orderOffset = 80;
  let offset = 60 + headerSize;
  if (!channelCount || channelCount > 64 || offset > buffer.byteLength) return undefined;
  const orders = Array.from(new Uint8Array(buffer, orderOffset, songLength));
  const patterns = [];
  for (let pattern = 0; pattern < patternCount; pattern++) {
    if (offset + 9 > buffer.byteLength) return undefined;
    const headerLength = view.getUint32(offset, true);
    const rowCount = view.getUint16(offset + 5, true);
    const packedSize = view.getUint16(offset + 7, true);
    const dataOffset = offset + headerLength;
    const end = dataOffset + packedSize;
    if (headerLength < 9 || end > buffer.byteLength) return undefined;
    let cursor = dataOffset;
    const rows = Array.from({ length: rowCount }, () => Array.from({ length: channelCount }, () => {
      const decoded = parseXmEvent(view, cursor, end - cursor);
      cursor += decoded.size;
      return decoded.event;
    }));
    patterns.push({ rows });
    offset = end;
  }
  return { format: "XM", channelCount, orders, patterns, speed, bpm };
}

function applyTimingEffects(row, speed, bpm) {
  for (const event of row) {
    if (event.effect !== 0x0f || !event.parameter) continue;
    if (event.parameter < 32) speed = event.parameter;
    else bpm = event.parameter;
  }
  return { speed, bpm };
}

function findFlowEffect(row) {
  for (const event of row) {
    if (event.effect === 0x0b) return { order: event.parameter, row: 0 };
    if (event.effect === 0x0d) return { row: ((event.parameter >> 4) * 10) + (event.parameter & 0x0f) };
  }
  return undefined;
}

function buildTimeline(data) {
  const timeline = [];
  let elapsedMs = 0;
  let order = 0;
  let row = 0;
  let speed = data.speed || 6;
  let bpm = data.bpm || 125;
  while (order < data.orders.length && timeline.length < 20000) {
    const patternIndex = data.orders[order];
    const pattern = data.patterns[patternIndex];
    if (!pattern || row >= pattern.rows.length) {
      order++;
      row = 0;
      continue;
    }
    const events = pattern.rows[row];
    ({ speed, bpm } = applyTimingEffects(events, speed, bpm));
    const durationMs = speed * 2500 / bpm;
    timeline.push({ order, pattern: patternIndex, row, startMs: elapsedMs, endMs: elapsedMs + durationMs });
    elapsedMs += durationMs;
    const flow = findFlowEffect(events);
    if (flow?.order !== undefined) {
      order = flow.order;
      row = flow.row;
    } else if (flow?.row !== undefined) {
      order++;
      row = flow.row;
    } else {
      row++;
    }
  }
  return timeline;
}

export function parseTrackerData(buffer) {
  const data = parseXm(buffer) ?? parseMod(buffer);
  return data && { ...data, timeline: buildTimeline(data) };
}