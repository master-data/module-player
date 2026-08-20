import { createUadePlayer, parseUadeSongInfo } from "../uade/index.js";
import { createXmpPlayer } from "../xmp/index.js?v=6";
import { scoutFile } from "../uade/vendor/format-scout/index.js";

const $ = (id) => document.getElementById(id);
const controls = ["play", "pause", "stop", "songs", "file"];
const DEFAULT_SAMPLE = "GSLINGER.MOD";
const AMIGA_CHANNEL_SIDES = ["L", "R", "R", "L"];
const METER_FLOOR_DB = -48;
const XMP_PREFERRED_EXTENSIONS = new Set(["669", "amf", "dsm", "far", "imf", "it", "mod", "mtm", "s3m", "stm", "ult", "xm"]);
let player;
let xmpPlayer;
let activeEngine = "uade";
let suppressUadeFailure = false;
let songs = [];
let songsReady;
let lastSelection;
let scopeTimer;
let diagnosticsTimer;
let metadataState;
let formatScoutState;
let pendingScoutState;
let pendingScoutError;
let pendingScoutToken = 0;
let loadFailure;
let diagnosticsState = {};
let initializing = false;
let dialogOpener;
let scopesEnabled = true;
const restartSettings = new Set();
let queuedSubsongRestart;
let subsongState;
let selectedSubsong;
let selectedTrackerOrder = 0;
let trackerFollowingPlayback = true;
let trackerAnimationFrame;
let lastTrackerPositionKey;

function showStatus(message) { $("status").textContent = message; }
function stopScopeLoop() {
  if (scopeTimer === undefined) return;
  clearInterval(scopeTimer);
  scopeTimer = undefined;
}
function startScopeLoop() {
  stopScopeLoop();
  draw(performance.now());
  if (!scopesEnabled || !(activeEngine === "xmp" ? xmpPlayer?.visualization : player?.visualization)) return;
  const refreshInterval = 1000 / Number($("scope-hz").value);
  scopeTimer = window.setInterval(() => draw(performance.now()), refreshInterval);
}
function updateRestartButton() { $("restart-uade").disabled = initializing || !restartSettings.size; }
function stageRestart(setting) {
  const activePlayer = activeEngine === "xmp" ? xmpPlayer : player;
  if (!activePlayer || activePlayer.state === "disposed") return;
  restartSettings.add(setting);
  updateRestartButton();
  showStatus(`Restart player to apply ${[...restartSettings].join(", ")}.`);
}
function clearStagedRestart(setting) {
  restartSettings.delete(setting);
  updateRestartButton();
}
function describeLoadFailure(error) {
  if (error?.operation === "load dependency") {
    const dependency = String(error.filename ?? "required companion file").split("/").pop();
    return `Initialize failed: required dependency ${dependency} was not found.`;
  }
  return `Initialize failed: ${error?.message ?? "UADE startup failed."}`;
}
function formatNumber(value, digits = 1) { return Number.isFinite(value) ? Number(value).toFixed(digits) : "--"; }
function formatBytes(value) {
  if (!Number.isFinite(value)) return "--";
  if (value < 1024) return `${value} B`;
  return `${formatNumber(value / 1024, value < 1024 * 1024 ? 1 : 2)} ${value < 1024 * 1024 ? "KB" : "MB"}`;
}
function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}
function diagnosticItem(label, value, tone = "") {
  const item = document.createElement("div");
  item.className = `diagnostic-item ${tone}`.trim();
  item.append(textElement("span", label), textElement("strong", value));
  return item;
}
function metadataItem(label, value) {
  const item = document.createElement("div");
  item.className = "metadata-item";
  item.append(textElement("span", label), textElement("strong", value || "--"));
  return item;
}
function updateRawInspectors() {
  $("metadata-raw").textContent = metadataState ? JSON.stringify({ parsed: metadataState, raw: metadataState.raw, formatScout: formatScoutState ?? null }, null, 2) : "No module loaded.";
  $("open-metadata").disabled = !metadataState;
  $("open-diagnostics").disabled = !Object.keys(diagnosticsState).length;
}
function diagnosticTone() {
  const budget = diagnosticsState.audioCallbackBudgetMs;
  const average = diagnosticsState.audioGenerationAverageMs;
  const utilization = Number.isFinite(budget) && budget > 0 && Number.isFinite(average) ? average / budget : undefined;
  return utilization >= 1 ? "danger" : utilization >= 0.7 ? "warning" : "good";
}
function diagnosticsItems(compact) {
  const callbackTone = diagnosticTone();
  const clockRatio = diagnosticsState.audioClockToWallClockRatio;
  const sourceRatio = diagnosticsState.wasmSourceRateToConfiguredRatio;
  const summary = [
    diagnosticItem("Output rate", `${diagnosticsState.audioContextSampleRate ?? "--"} Hz`),
    diagnosticItem("Late callbacks", String(diagnosticsState.lateAudioCallbackCount ?? "--"), diagnosticsState.lateAudioCallbackCount ? "warning" : "good"),
    diagnosticItem("Clock ratio", formatNumber(clockRatio, 4), Math.abs((clockRatio ?? 1) - 1) > 0.02 ? "warning" : "good"),
    diagnosticItem("Audio elapsed", `${formatNumber(diagnosticsState.audioElapsedSeconds)} s`)
  ];
  if (compact) return summary;
  return [
    diagnosticItem("Transport", diagnosticsState.audioContextState || player?.state || "--", diagnosticsState.audioContextState === "running" ? "good" : ""),
    diagnosticItem("Output rate", `${diagnosticsState.audioContextSampleRate ?? "--"} Hz`),
    diagnosticItem("Requested", `${diagnosticsState.requestedAudioContextSampleRate ?? "--"} Hz`),
    diagnosticItem("Callback budget", `${formatNumber(diagnosticsState.audioCallbackBudgetMs)} ms`),
    diagnosticItem("Generation avg", `${formatNumber(diagnosticsState.audioGenerationAverageMs)} ms`, callbackTone),
    diagnosticItem("Generation peak", `${formatNumber(diagnosticsState.audioGenerationMaxMs)} ms`, callbackTone),
    diagnosticItem("WASM avg", `${formatNumber(diagnosticsState.wasmComputeAverageMs)} ms`),
    diagnosticItem("WASM peak", `${formatNumber(diagnosticsState.wasmComputeMaxMs)} ms`),
    summary[1],
    summary[2],
    diagnosticItem("Source rate", `${formatNumber(diagnosticsState.wasmSourceFramesPerAudioSecond, 0)} Hz`, Math.abs((sourceRatio ?? 1) - 1) > 0.02 ? "warning" : "good"),
    summary[3],
    diagnosticItem("Wall elapsed", `${formatNumber(diagnosticsState.wallElapsedSeconds)} s`),
    diagnosticItem("Buffer", `${diagnosticsState.processorBufferSize ?? "--"} samples`)
  ];
}
function renderDiagnostics() {
  const hasDiagnostics = Boolean(Object.keys(diagnosticsState).length);
  for (const [target, compact] of [[ $("diagnostics"), true ], [ $("diagnostics-detail"), false ]]) {
    target.replaceChildren();
    target.classList.toggle("is-empty", !hasDiagnostics);
    if (hasDiagnostics) target.append(...diagnosticsItems(compact));
    else target.append(textElement("p", "Runtime not initialized.", "empty-state"));
  }
  updateRawInspectors();
}
function showDiagnostics() {
  diagnosticsState = activeEngine === "xmp"
    ? xmpPlayer?.getDiagnostics() ?? {}
    : player?.getDiagnostics() ?? {};
  renderDiagnostics();
}
function renderMetadata() {
  const target = $("metadata");
  target.replaceChildren();
  if (!metadataState) {
    if (lastSelection) {
      const identity = document.createElement("div");
      identity.className = "module-identity";
      identity.append(textElement("h2", lastSelection.filename, "pending-module-name"));
      target.append(identity);
      const scout = pendingScoutState?.primary;
      if (scout) {
        const facts = document.createElement("div");
        facts.className = "metadata-facts";
        facts.append(
          metadataItem("Format", scout.name || scout.format),
          metadataItem("Platform", scout.platform),
          metadataItem("Confidence", scout.confidence),
          metadataItem("Identifier", scout.id)
        );
        target.append(facts);
      } else if (pendingScoutState) {
        target.append(textElement("p", "Scout: Unidentified", "metadata-warning"));
        if (pendingScoutState.ambiguous || pendingScoutState.limitations?.length) {
          target.append(textElement("p", pendingScoutState.ambiguous ? "Format detection needs context." : pendingScoutState.limitations.join(" "), "metadata-warning"));
        }
      } else if (pendingScoutError) {
        target.append(textElement("p", pendingScoutError, "metadata-warning"));
      } else {
        target.append(textElement("p", "Inspecting module format...", "empty-state"));
      }
      target.append(textElement("p", loadFailure ?? "Select Initialize to load this module.", loadFailure ? "metadata-warning" : "empty-state"));
    } else {
      target.append(textElement("p", "No module selected.", "empty-state"));
    }
    updateRawInspectors();
    return;
  }
  const scoutReport = formatScoutState ?? pendingScoutState;
  const scout = scoutReport?.primary;
  const displayedSubsong = selectedSubsong ?? metadataState.subsong?.current;
  const subsongMaximum = subsongState?.maximum ?? metadataState.subsong?.maximum;
  const identity = document.createElement("div");
  identity.className = "module-identity";
  identity.append(textElement("h2", metadataState.title || metadataState.fileName || "Untitled module"), textElement("p", metadataState.fileName || "Unknown source"));
  const facts = document.createElement("div");
  facts.className = "metadata-facts";
  facts.append(
    metadataItem("Format", metadataState.format || scout?.format),
    metadataItem("Player", metadataState.player),
    metadataItem("Subsong", `${displayedSubsong ?? 0} / ${subsongMaximum ?? 0}`),
    metadataItem("File size", formatBytes(metadataState.fileLengthBytes)),
    metadataItem("Positions", String(metadataState.maxPositions ?? "--")),
    metadataItem("Scout", scout ? `${scout.id || scout.name || "Detected"} / ${scout.confidence || "Detected"}` : scoutReport ? "Unidentified" : "Awaiting scout")
  );
  target.append(identity, facts);
  if (metadataState.summary?.length) target.append(textElement("p", metadataState.summary.join(" | "), "module-summary"));
  if (scoutReport?.ambiguous || scoutReport?.limitations?.length) target.append(textElement("p", scoutReport.ambiguous ? "Format detection needs context." : scoutReport.limitations.join(" "), "metadata-warning"));
  if (metadataState.instruments?.length) {
    const instruments = document.createElement("div");
    instruments.className = "instrument-list";
    instruments.append(textElement("p", `Instruments (${metadataState.instruments.length})`, "instrument-heading"));
    for (const instrument of metadataState.instruments) instruments.append(textElement("p", `${String(instrument.index).padStart(2, "0")}  ${instrument.name || "Untitled"}`, "instrument-row"));
    target.append(instruments);
  }
  updateRawInspectors();
}
function updateSubsongControl() {
  const control = $("track");
  const readout = $("track-readout");
  const previous = $("previous-track");
  const next = $("next-track");
  const subsong = subsongState;
  if (!Number.isInteger(subsong?.minimum) || !Number.isInteger(subsong?.maximum)) {
    control.disabled = true;
    control.min = "0";
    control.max = "0";
    control.value = "0";
    previous.disabled = true;
    next.disabled = true;
    readout.value = "--";
    readout.textContent = readout.value;
    return;
  }
  control.min = String(subsong.minimum);
  control.max = String(subsong.maximum);
  if (!Number.isInteger(selectedSubsong) || selectedSubsong < subsong.minimum || selectedSubsong > subsong.maximum) {
    selectedSubsong = Number.isInteger(subsong.current) ? subsong.current : subsong.minimum;
  }
  control.value = String(selectedSubsong);
  const total = subsong.maximum - subsong.minimum + 1;
  const position = selectedSubsong - subsong.minimum + 1;
  control.disabled = total <= 1;
  previous.disabled = control.disabled || selectedSubsong <= subsong.minimum;
  next.disabled = control.disabled || selectedSubsong >= subsong.maximum;
  readout.value = `${position} / ${total}`;
  readout.textContent = readout.value;
}
function selectSubsong(track) {
  const control = $("track");
  selectedSubsong = Math.min(Number(control.max), Math.max(Number(control.min), track));
  control.value = String(selectedSubsong);
  stageRestart("subsong");
  updateSubsongControl();
  return selectedSubsong;
}
async function restartWithSubsong(track) {
  const selectedTrack = Number(selectSubsong(track));
  if (initializing) {
    queuedSubsongRestart = selectedTrack;
    return;
  }
  await initializePlayer();
  if (queuedSubsongRestart === undefined) return;
  const queuedTrack = queuedSubsongRestart;
  queuedSubsongRestart = undefined;
  await restartWithSubsong(queuedTrack);
}
function setMetadata(info) {
  metadataState = { ...parseUadeSongInfo(info), raw: info };
  const subsong = metadataState.subsong;
  if (Number.isInteger(subsong?.minimum) && Number.isInteger(subsong?.maximum)) subsongState = subsong;
  updateSubsongControl();
  renderMetadata();
  renderTrackerView();
}
function setXmpMetadata(filename, songInfo = {}) {
  metadataState = {
    title: songInfo.title || filename,
    fileName: filename,
    fileLengthBytes: songInfo.fileLengthBytes,
    maxPositions: songInfo.maxPositions,
    format: formatScoutState?.primary?.format || "libxmp",
    player: songInfo.player || "webXMP",
    summary: [songInfo.tracks !== "0" ? songInfo.tracks : undefined, songInfo.comment, Number.isInteger(songInfo.trackerChannels) ? `${songInfo.trackerChannels} tracker channels` : undefined].filter(Boolean),
    instruments: songInfo.instruments,
    raw: songInfo
  };
  subsongState = undefined;
  selectedSubsong = undefined;
  trackerFollowingPlayback = true;
  lastTrackerPositionKey = undefined;
  $("tracker-grid").replaceChildren();
  delete $("tracker-grid").dataset.order;
  delete $("tracker-grid").dataset.format;
  updateSubsongControl();
  renderMetadata();
  renderTrackerView();
}

function trackerNote(event, format) {
  if (!event.note) return "---";
  if (format === "XM" && event.note === 97) return "===";
  const semitone = format === "MOD"
    ? Math.round(12 * Math.log2(1712 / event.note))
    : event.note - 1;
  if (!Number.isFinite(semitone) || semitone < 0) return "---";
  return `${["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"][semitone % 12]}${Math.floor(semitone / 12)}`;
}
function trackerCell(event, format) {
  const note = trackerNote(event, format);
  const instrument = event.instrument ? String(event.instrument).padStart(2, "0") : "..";
  const volume = event.volume ? event.volume.toString(16).toUpperCase().padStart(2, "0") : "..";
  const effect = event.effect || event.parameter ? `${event.effect.toString(16).toUpperCase()}${event.parameter.toString(16).toUpperCase().padStart(2, "0")}` : "...";
  return `${note} ${instrument} ${volume} ${effect}`;
}
function drawTrackerScope(canvas, data) {
  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  context.fillStyle = "#102a33";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(229, 234, 219, .2)";
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  if (!data.length) return;
  context.strokeStyle = "#77d5bb";
  context.lineWidth = 2;
  context.beginPath();
  const stride = Math.max(1, Math.floor(data.length / width));
  for (let index = 0; index < data.length; index += stride) {
    const x = index / data.length * width;
    const y = (1 - data[index]) * height / 2;
    index ? context.lineTo(x, y) : context.moveTo(x, y);
  }
  context.stroke();
}
function renderTrackerScopes() {
  const container = $("tracker-scopes");
  const source = xmpPlayer?.visualization;
  if (!source) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }
  container.hidden = false;
  if (container.children.length !== 2) {
    container.replaceChildren(...["OUT L", "OUT R"].map((label, channel) => {
      const scope = document.createElement("article");
      scope.className = "tracker-scope";
      scope.append(textElement("p", label, "tracker-scope-label"));
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 82;
      scope.append(canvas);
      return scope;
    }));
  }
  for (const channel of [0, 1]) {
    const data = source.streamCount > channel ? source.readChannel(channel) : new Float32Array();
    drawTrackerScope(container.children[channel].querySelector("canvas"), data);
  }
}
function setTrackerOrder(order, followPlayback = false) {
  const tracker = xmpPlayer?.tracker;
  if (!tracker?.available) return;
  selectedTrackerOrder = Math.min(tracker.orders.length - 1, Math.max(0, order));
  trackerFollowingPlayback = followPlayback;
  lastTrackerPositionKey = undefined;
  renderTrackerView();
}
function renderTrackerOrderMap(tracker, position) {
  const map = $("tracker-order-map");
  if (map.dataset.orders !== tracker.orders.join(",")) {
    map.replaceChildren(...tracker.orders.map((pattern, order) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tracker-order-cell";
      button.dataset.order = order;
      button.setAttribute("aria-label", `Order ${order}, pattern ${pattern}`);
      button.textContent = String(pattern).padStart(2, "0");
      return button;
    }));
    map.dataset.orders = tracker.orders.join(",");
  }
  for (const button of map.children) {
    const order = Number(button.dataset.order);
    button.classList.toggle("is-selected", order === selectedTrackerOrder);
    button.classList.toggle("is-playing", order === position?.order);
  }
  const focusOrder = trackerFollowingPlayback ? position?.order : selectedTrackerOrder;
  if (focusOrder !== undefined) map.querySelector(`[data-order="${focusOrder}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
}
function renderTrackerView() {
  const dialog = $("tracker-dialog");
  const tracker = activeEngine === "xmp" ? xmpPlayer?.tracker : undefined;
  const grid = $("tracker-grid");
  const title = metadataState?.title || metadataState?.fileName || "Tracker View";
  $("tracker-dialog-title").textContent = title;
  $("tracker-dialog-kicker").textContent = "TRACKER LIVE VISUALIZATION";
  $("tracker-dialog-source").textContent = metadataState?.fileName
    ? `${metadataState.fileName}  |  ${metadataState.player || "webXMP"}`
    : "No module loaded.";
  if (!tracker?.available) {
    $("tracker-order-map").replaceChildren();
    delete $("tracker-order-map").dataset.orders;
    $("tracker-status").textContent = activeEngine === "xmp" ? "Pattern decoding is available for MOD and XM modules." : "Pattern view is available for decoded XMP MOD and XM modules.";
    grid.replaceChildren();
    renderTrackerScopes();
    return;
  }
  const position = tracker.getPosition();
  if (position && trackerFollowingPlayback) selectedTrackerOrder = position.order;
  selectedTrackerOrder = Math.min(selectedTrackerOrder, tracker.orders.length - 1);
  renderTrackerOrderMap(tracker, position);
  const pattern = tracker.patterns[tracker.orders[selectedTrackerOrder]];
  if (!pattern) {
    $("tracker-status").textContent = "The selected order does not contain decoded pattern data.";
    grid.replaceChildren();
    return;
  }
  const row = position?.order === selectedTrackerOrder ? String(position.row).padStart(2, "0") : "--";
  $("tracker-status").textContent = `${tracker.format}  |  ${tracker.channelCount} CH  |  ORDER ${String(selectedTrackerOrder + 1).padStart(2, "0")} / ${tracker.orders.length}  |  PAT ${String(tracker.orders[selectedTrackerOrder]).padStart(2, "0")}  |  ROW ${row} / ${String(pattern.rows.length - 1).padStart(2, "0")}  |  ${tracker.patternCount} PATTERNS  |  ${tracker.initialBpm} BPM  |  SPEED ${tracker.initialSpeed}`;
  renderTrackerScopes();
  if (grid.dataset.order !== String(selectedTrackerOrder) || grid.dataset.format !== tracker.format) {
    const table = document.createElement("table");
    table.className = "tracker-table";
    const header = document.createElement("tr");
    header.append(textElement("th", "ROW"));
    for (let channel = 0; channel < tracker.channelCount; channel++) header.append(textElement("th", `CH ${String(channel + 1).padStart(2, "0")}`));
    const head = document.createElement("thead");
    head.append(header);
    const body = document.createElement("tbody");
    for (const [rowIndex, row] of pattern.rows.entries()) {
      const rowElement = document.createElement("tr");
      rowElement.dataset.trackerRow = rowIndex;
      rowElement.append(textElement("th", String(rowIndex).padStart(2, "0")));
      for (const event of row) rowElement.append(textElement("td", trackerCell(event, tracker.format)));
      body.append(rowElement);
    }
    table.append(head, body);
    grid.replaceChildren(table);
    grid.dataset.order = String(selectedTrackerOrder);
    grid.dataset.format = tracker.format;
  }
  const activeRow = position?.order === selectedTrackerOrder ? position.row : undefined;
  const positionKey = position ? `${position.order}:${position.row}` : undefined;
  for (const rowElement of grid.querySelectorAll("tbody tr")) rowElement.classList.toggle("is-current", Number(rowElement.dataset.trackerRow) === activeRow);
  if (dialog.open && positionKey && positionKey !== lastTrackerPositionKey) grid.querySelector("tbody tr.is-current")?.scrollIntoView({ block: "center" });
  lastTrackerPositionKey = positionKey;
}
function stopTrackerAnimation() {
  if (trackerAnimationFrame === undefined) return;
  window.cancelAnimationFrame(trackerAnimationFrame);
  trackerAnimationFrame = undefined;
}
function startTrackerAnimation() {
  stopTrackerAnimation();
  const animate = () => {
    if (!$("tracker-dialog").open) return;
    renderTrackerView();
    trackerAnimationFrame = window.requestAnimationFrame(animate);
  };
  animate();
}
async function loadWithXmp(buffer, filename) {
  activeEngine = "xmp";
  scopesEnabled = $("visualizer").checked;
  stopScopeLoop();
  draw(performance.now());
  await player?.dispose();
  player = undefined;
  if (!xmpPlayer || xmpPlayer.state === "disposed") {
    xmpPlayer = await createXmpPlayer({
      assetBaseUrl: "../xmp",
      processorBufferSize: Number($("buffer").value),
      audioContextSampleRate: Number($("audio-rate").value)
    });
    xmpPlayer.setVolume(Number($("volume").value));
    xmpPlayer.visualization?.setZoom(Number($("zoom").value));
    xmpPlayer.on("state", () => updateControls());
    xmpPlayer.on("ended", () => showStatus($("loop").checked ? "Looping module." : "Module ended."));
    xmpPlayer.on("error", (error) => { loadFailure = error.message; showStatus(loadFailure); renderMetadata(); });
  }
  const songInfo = await xmpPlayer.load(buffer, options(filename));
  loadFailure = undefined;
  setXmpMetadata(filename, songInfo);
  showStatus("Player state: playing");
  showDiagnostics();
  startScopeLoop();
  updateControls();
}
function songUrl(name) { return `assets/music/${name.split("/").map(encodeURIComponent).join("/")}`; }
function prefersXmp(filename) {
  const extension = filename.split(".").pop()?.toLowerCase();
  return XMP_PREFERRED_EXTENSIONS.has(extension);
}
function renderSourceControl() {
  $("songs-control").hidden = lastSelection?.type === "file";
}
async function inspectSelection(selection) {
  const token = ++pendingScoutToken;
  pendingScoutState = undefined;
  pendingScoutError = undefined;
  renderMetadata();
  try {
    const buffer = selection.type === "file"
      ? selection.buffer
      : await fetch(songUrl(selection.filename)).then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      });
    if (token !== pendingScoutToken || lastSelection !== selection) return;
    pendingScoutState = scoutFile(buffer, { filename: selection.filename });
  } catch (error) {
    if (token !== pendingScoutToken || lastSelection !== selection) return;
    pendingScoutError = `Format inspection failed: ${error.message}`;
  }
  renderMetadata();
}
function selectBundledSong(filename) {
  $("songs").value = filename;
  loadFailure = undefined;
  subsongState = undefined;
  selectedSubsong = undefined;
  selectedTrackerOrder = 0;
  updateSubsongControl();
  lastSelection = { type: "bundled", filename };
  renderSourceControl();
  void inspectSelection(lastSelection);
}
function selectFile(selection) {
  loadFailure = undefined;
  subsongState = undefined;
  selectedSubsong = undefined;
  selectedTrackerOrder = 0;
  updateSubsongControl();
  lastSelection = selection;
  renderSourceControl();
  void inspectSelection(lastSelection);
}
async function populateSongs() {
  if (songs.length) return;
  songs = await fetch("music-manifest.json", { cache: "no-store" }).then((response) => {
    if (!response.ok) throw new Error(`Unable to load demo modules: HTTP ${response.status}.`);
    return response.json();
  });
  $("songs").append(...songs.map((song) => new Option(song, song)));
  if (!lastSelection) selectDefaultSample();
}
function prepareSongs() {
  songsReady ??= populateSongs().then(() => updateControls());
  return songsReady;
}
function options(filename) {
  return {
    filename,
    track: Number($("track").value),
    loop: $("loop").checked
  };
}
function updateRangeReadout(input) {
  if (input.id === "track") return;
  const output = document.querySelector(`output[for="${input.id}"]`);
  if (!output) return;
  const value = Number(input.value);
  const display = {
    zoom: `${value}x`,
    volume: `${Math.round(value * 100)}%`,
    rate: `${value.toFixed(2)}x`,
    pan: value.toFixed(1)
  }[input.id];
  output.value = display ?? input.value;
  output.textContent = output.value;
}

async function createFileSelection(input, filename) {
  const resolvedFilename = filename ?? input?.name;
  if (!resolvedFilename) throw new Error("A filename is required when loading raw module data.");
  if (input instanceof Blob) {
    return { type: "file", filename: resolvedFilename, buffer: await input.arrayBuffer() };
  }
  if (input instanceof ArrayBuffer) {
    return { type: "file", filename: resolvedFilename, buffer: input };
  }
  if (ArrayBuffer.isView(input)) {
    return {
      type: "file",
      filename: resolvedFilename,
      buffer: input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
    };
  }
  throw new Error("Module input must be a File, Blob, ArrayBuffer, or typed array.");
}

function selectDefaultSample() {
  const preferred = songs.find((song) => song.toLowerCase() === DEFAULT_SAMPLE.toLowerCase());
  const fallback = songs.find((song) => song.toLowerCase() === "crystal hammer.mod") ?? songs[0];
  const sample = preferred ?? fallback;
  selectBundledSong(sample);
  return preferred ? undefined : `${DEFAULT_SAMPLE} is not present in public/music; using ${sample}.`;
}
function makeScopeCard(index, active) {
  const card = document.createElement("article");
  card.className = `scope-card${active ? "" : " inactive"}`;
  card.dataset.scope = index;
  const isXmpOutput = activeEngine === "xmp";
  const side = isXmpOutput ? ["L", "R"][index] ?? "--" : AMIGA_CHANNEL_SIDES[index] ?? "?";
  card.append(textElement("p", isXmpOutput ? `OUT ${side}` : `CH ${String(index + 0).padStart(2, "0")} / ${side}`, "scope-label"));
  if (active) {
    const canvas = document.createElement("canvas");
    canvas.width = 360;
    canvas.height = 208;
    canvas.dataset.channel = index;
    canvas.setAttribute("aria-label", `${isXmpOutput ? "Output" : "Channel"} ${index + 1} ${side === "L" ? "left" : "right"} waveform`);
    card.append(canvas);
  } else {
    card.append(textElement("p", isXmpOutput ? "No output" : "No signal", "scope-empty"));
  }
  return card;
}
function meterLevel(data) {
  let squareSum = 0;
  for (const sample of data) squareSum += sample * sample;
  const rms = Math.sqrt(squareSum / data.length);
  const decibels = Math.max(METER_FLOOR_DB, 20 * Math.log10(Math.max(rms, Number.EPSILON)));
  return { rms, decibels, ratio: Math.min(1, Math.max(0, (decibels - METER_FLOOR_DB) / -METER_FLOOR_DB)) };
}
function combinedMeter(levels) {
  const rms = Math.sqrt(levels.reduce((sum, level) => sum + level.rms ** 2, 0) / levels.length);
  const decibels = Math.max(METER_FLOOR_DB, 20 * Math.log10(Math.max(rms, Number.EPSILON)));
  return { rms, decibels, ratio: Math.min(1, Math.max(0, (decibels - METER_FLOOR_DB) / -METER_FLOOR_DB)) };
}
function drawScope(canvas, data, meter) {
  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  context.fillStyle = "#102a33";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(184, 207, 180, 0.18)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  context.fillStyle = meter.decibels > -3 ? "#df7650" : "#d9b35c";
  context.fillRect(0, height - 8, width * meter.ratio, 8);
  context.strokeStyle = "#77d5bb";
  context.lineWidth = 2;
  context.beginPath();
  for (let index = 0; index < data.length; index += Math.max(1, Math.floor(data.length / width))) {
    const x = index / data.length * width;
    const y = (1 - data[index]) * height / 2;
    index ? context.lineTo(x, y) : context.moveTo(x, y);
  }
  context.stroke();
}
function draw(now) {
  const source = activeEngine === "xmp" ? xmpPlayer?.visualization : player?.visualization;
  const container = $("scopes");
  if (!scopesEnabled || !source) {
    stopScopeLoop();
    if (!container.children.length || container.querySelector("canvas")) container.replaceChildren(...Array.from({ length: 4 }, (_, index) => makeScopeCard(index, false)));
    $("scope-readout").textContent = "Output --";
    return;
  }
  if (container.children.length !== 4 || [...container.children].some((card, index) => Boolean(card.querySelector("canvas")) !== (index < source.streamCount))) {
    container.replaceChildren(...Array.from({ length: 4 }, (_, index) => makeScopeCard(index, index < source.streamCount)));
  }
  if (!source.streamCount) {
    $("scope-readout").textContent = "Output --";
    return;
  }
  const levels = [];
  for (const canvas of container.querySelectorAll("canvas")) {
    const channel = Number(canvas.dataset.channel);
    const data = source.readChannel(channel);
    const meter = meterLevel(data);
    levels.push(meter);
    drawScope(canvas, data, meter);
  }
  const outputMeter = combinedMeter(levels);
  $("scope-readout").textContent = `Output ${formatNumber(outputMeter.decibels, 0)} dBFS`;
}
function updateControls(state = player?.state) {
  const xmpActive = activeEngine === "xmp";
  const currentState = xmpActive ? xmpPlayer?.state : state;
  const ready = !initializing && (xmpActive || (player && !["initializing", "disposed"].includes(currentState)));
  $("play").disabled = !ready || !["ready", "paused", "stopped", "ended"].includes(currentState);
  $("pause").disabled = !ready || currentState !== "playing";
  $("stop").disabled = !ready || !["playing", "paused", "loading"].includes(currentState);
  $("open-tracker").disabled = !xmpActive || !xmpPlayer?.tracker?.available;
  $("songs").disabled = initializing || (!xmpActive && currentState === "disposed") || !songs.length;
  $("file").disabled = initializing || (!xmpActive && currentState === "disposed");
}
async function loadBuffer(buffer, filename) {
  if (activeEngine === "xmp") {
    await loadWithXmp(buffer, filename);
    return;
  }
  formatScoutState = scoutFile(buffer, { filename });
  if (prefersXmp(filename)) {
    await loadWithXmp(buffer, filename);
    return;
  }
  if (!player || player.state === "initializing" || player.state === "disposed") {
    throw new Error("Initialize UADE before loading a file.");
  }
  loadFailure = undefined;
  suppressUadeFailure = true;
  try {
    const info = await player.load(buffer, options(filename));
    setMetadata(info);
  } catch (error) {
    await loadWithXmp(buffer, filename);
  } finally {
    suppressUadeFailure = false;
  }
}

async function playLastSelection() {
  if (!lastSelection) throw new Error("Select a bundled sample or open a local file first.");
  if (lastSelection.type === "file") {
    await loadBuffer(lastSelection.buffer, lastSelection.filename);
    return;
  }
  const response = await fetch(songUrl(lastSelection.filename));
  if (!response.ok) throw new Error(`Unable to load ${lastSelection.filename}: HTTP ${response.status}.`);
  await loadBuffer(await response.arrayBuffer(), lastSelection.filename);
}

async function initializePlayer() {
  if (initializing) return;
  try {
    let defaultWarning;
    initializing = true;
    stopScopeLoop();
    updateControls();
    updateRestartButton();
    updateSubsongControl();
    const previousPlayer = player;
    player = undefined;
    activeEngine = "uade";
    await xmpPlayer?.dispose();
    xmpPlayer = undefined;
    await previousPlayer?.dispose();
    player = await createUadePlayer({
      assetBaseUrl: "../uade/assets",
      visualization: $("visualizer").checked,
      processorBufferSize: Number($("buffer").value),
      audioContextSampleRate: Number($("audio-rate").value)
    });
    player.on("state", (state) => { if (!suppressUadeFailure) showStatus(`Player state: ${state}`); updateControls(state); });
    player.on("error", (error) => { if (!suppressUadeFailure) { loadFailure = describeLoadFailure(error); showStatus(loadFailure); renderMetadata(); } });
    player.on("ended", () => showStatus($("loop").checked ? "Looping module." : "Module ended."));
    player.on("metadata", setMetadata);
    player.on("format-scout", (result) => { formatScoutState = result; renderMetadata(); });
    player.setVolume(Number($("volume").value));
    player.visualization?.setZoom(Number($("zoom").value));
    player.setUadePanning(Number($("pan").value));
    await prepareSongs();
    if (!lastSelection) defaultWarning = selectDefaultSample();
    $("initialize").textContent = "Reinitialize";
    scopesEnabled = $("visualizer").checked;
    const visualizationState = scopesEnabled ? "enabled" : "disabled";
    showStatus(`${defaultWarning ? `${defaultWarning} ` : ""}Ready. Visualizer ${visualizationState}; buffer: ${$("buffer").value} samples.`);
    showDiagnostics();
    startScopeLoop();
    await playLastSelection();
    restartSettings.clear();
    updateRestartButton();
  } catch (error) {
    loadFailure ??= describeLoadFailure(error);
    showStatus(loadFailure);
    renderMetadata();
    $("initialize").textContent = "Initialize";
  } finally {
    initializing = false;
    updateControls();
    updateRestartButton();
    updateSubsongControl();
  }
}

async function playModule(input, { filename } = {}) {
  selectFile(await createFileSelection(input, filename));
  if (!player || player.state === "disposed") await initializePlayer();
  else await playLastSelection();
  return player;
}

function hasActivePlayer() {
  const activePlayer = activeEngine === "xmp" ? xmpPlayer : player;
  return Boolean(activePlayer && activePlayer.state !== "disposed");
}

$("initialize").addEventListener("click", initializePlayer);
$("play").addEventListener("click", async () => { try { if (activeEngine === "xmp") { if (xmpPlayer?.state === "paused") return xmpPlayer.resume(); await playLastSelection(); return; } if (!player) throw new Error("Initialize UADE before starting playback."); if (player.state === "paused") return player.resume(); await playLastSelection(); } catch (error) { showStatus(error.message); } });
$("pause").addEventListener("click", () => activeEngine === "xmp" ? xmpPlayer?.pause() : player?.pause());
$("stop").addEventListener("click", () => activeEngine === "xmp" ? xmpPlayer?.stop() : player?.stop());
$("volume").addEventListener("input", (event) => { updateRangeReadout(event.target); (activeEngine === "xmp" ? xmpPlayer : player)?.setVolume(Number(event.target.value)); });
$("rate").addEventListener("input", (event) => { updateRangeReadout(event.target); (activeEngine === "xmp" ? xmpPlayer : player)?.setPitchCoupledRate(Number(event.target.value)); });
$("pan").addEventListener("input", (event) => { updateRangeReadout(event.target); (activeEngine === "xmp" ? xmpPlayer : player)?.setUadePanning(Number(event.target.value)); });
$("loop").addEventListener("change", (event) => (activeEngine === "xmp" ? xmpPlayer : player)?.setLooping(event.target.checked));
$("silence").addEventListener("change", (event) => (activeEngine === "xmp" ? xmpPlayer : player)?.setSilenceTimeout(Number(event.target.value)));
$("zoom").addEventListener("input", (event) => { updateRangeReadout(event.target); (activeEngine === "xmp" ? xmpPlayer : player)?.visualization?.setZoom(Number(event.target.value)); });
$("scope-hz").addEventListener("change", startScopeLoop);
$("visualizer").addEventListener("change", (event) => {
  scopesEnabled = event.target.checked;
  if (!scopesEnabled) {
    clearStagedRestart("scopes");
    draw(performance.now());
    return;
  }
  const visualization = activeEngine === "xmp" ? xmpPlayer?.visualization : player?.visualization;
  if (!visualization) {
    stageRestart("scopes");
    return;
  }
  clearStagedRestart("scopes");
  startScopeLoop();
});
$("tracker-order-map").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-order]");
  if (!button) return;
  const order = Number(button.dataset.order);
  const playingOrder = xmpPlayer?.tracker.getPosition()?.order;
  setTrackerOrder(order, order === playingOrder);
});
$("buffer").addEventListener("change", () => stageRestart("audio buffer"));
$("audio-rate").addEventListener("change", () => stageRestart("audio rate"));
$("track").addEventListener("input", (event) => selectSubsong(Number(event.target.value)));
$("previous-track").addEventListener("click", () => restartWithSubsong(Number($("track").value) - 1));
$("next-track").addEventListener("click", () => restartWithSubsong(Number($("track").value) + 1));
$("restart-uade").addEventListener("click", initializePlayer);
$("songs").addEventListener("change", async (event) => {
  selectBundledSong(event.target.value);
  try {
    if (!hasActivePlayer() || activeEngine === "xmp") await initializePlayer();
    else await playLastSelection();
  } catch (error) { showStatus(error.message); }
});
$("file").addEventListener("change", async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    selectFile({ type: "file", filename: file.name, buffer: await file.arrayBuffer() });
    if (!hasActivePlayer() || activeEngine === "xmp") await initializePlayer();
    else await playLastSelection();
  } catch (error) {
    showStatus(error.message);
  }
});
function openDialog(dialogId, opener) {
  dialogOpener = opener;
  $(dialogId).showModal();
}
function closeDialog(dialog) {
  dialog.close();
  dialogOpener?.focus();
  dialogOpener = undefined;
}
function setSettingsPanel(open) {
  $("settings-panel").classList.toggle("is-open", open);
  document.body.classList.toggle("settings-open", open);
  $("settings-panel").setAttribute("aria-hidden", String(!open));
  $("settings-toggle").setAttribute("aria-expanded", String(open));
  if (open) $("settings-close").focus();
  else $("settings-toggle").focus();
}
$("open-metadata").addEventListener("click", (event) => openDialog("metadata-dialog", event.currentTarget));
$("open-diagnostics").addEventListener("click", (event) => openDialog("diagnostics-dialog", event.currentTarget));
$("open-tracker").addEventListener("click", (event) => {
  openDialog("tracker-dialog", event.currentTarget);
  startTrackerAnimation();
});
$("settings-toggle").addEventListener("click", () => setSettingsPanel(!$("settings-panel").classList.contains("is-open")));
$("settings-close").addEventListener("click", () => setSettingsPanel(false));
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && $("settings-panel").classList.contains("is-open")) setSettingsPanel(false); });
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("close", () => { if (dialog.id === "tracker-dialog") stopTrackerAnimation(); });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) closeDialog(dialog); });
  dialog.querySelector(".dialog-close").addEventListener("click", () => closeDialog(dialog));
}
$("scopes").replaceChildren(...Array.from({ length: 4 }, (_, index) => makeScopeCard(index, false)));
for (const input of document.querySelectorAll('input[type="range"]')) updateRangeReadout(input);
updateRawInspectors();
renderMetadata();
prepareSongs().catch((error) => showStatus(error.message));
diagnosticsTimer = window.setInterval(showDiagnostics, 1000);
window.modulePlayerDemo = Object.freeze({
  initialize: async () => { await initializePlayer(); return player; },
  load: playModule,
  play: playModule,
  stop: () => (activeEngine === "xmp" ? xmpPlayer : player)?.stop(),
  dispose: () => (activeEngine === "xmp" ? xmpPlayer : player)?.dispose()
});
window.addEventListener("beforeunload", () => { stopScopeLoop(); stopTrackerAnimation(); clearInterval(diagnosticsTimer); player?.dispose(); xmpPlayer?.dispose(); });