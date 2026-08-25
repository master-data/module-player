import { createUadePlayer, parseUadeSongInfo } from "../uade/index.js";
import { createXmpPlayer } from "../xmp/index.js?v=6";
import { isSidFile, parseSidMetadata } from "../sid/sid-metadata.js";
import { createSidPlayer } from "../sid/sid-player.js?v=2";
import { scoutFile } from "../uade/vendor/format-scout/index.js";
import { ImmersiveVisualizer } from "./immersive-visualizer.js?v=22";

const $ = (id) => document.getElementById(id);
const controls = ["play", "pause", "stop", "songs", "file"];
const DEFAULT_SAMPLE = "VESURI - Major Release.mod";
const query = new URLSearchParams(window.location.search);
const requestedDemo = query.get("selectDemo")?.trim();
const requestedModuleUrl = query.get("moduleUrl")?.trim();
const AMIGA_CHANNEL_SIDES = ["L", "R", "R", "L"];
const METER_FLOOR_DB = -48;
const XMP_PREFERRED_EXTENSIONS = new Set(["669", "amf", "dsm", "far", "imf", "it", "mod", "mtm", "s3m", "stm", "ult", "xm"]);
const SID_ATTACK_MS = [2, 8, 16, 24, 38, 56, 68, 80, 100, 250, 500, 800, 1000, 3000, 5000, 8000];
const SID_DECAY_RELEASE_MS = [6, 24, 48, 72, 114, 168, 204, 240, 300, 750, 1500, 2400, 3000, 9000, 15000, 24000];
const SID_CYCLES_PER_SECOND = 985248;
const SID_ENVELOPE_HISTORY_LIMIT = 180;
const TRACKER_SCOPE_MAX_WIDTH = 768;
const TRACKER_SCOPE_POINTS = 256;
const SID_SCOPE_PROCESSOR_BUFFER_SIZE = 1024;
const SID_NOISE_LFSR_MASK = 0x7fffff;
const SID_NOISE_LFSR_SEED = 0x7ffff8;
const SID_NOISE_CLOCK_DIVISOR = 0x100000;
const SID_NOISE_MAX_MODEL_STEPS = 4096;
const SID_OSCILLATOR_PHASE_PITCH_DIVISOR = 4096;
const SID_PHOSPHOR_DECAY_MS = 1000;
const SID_PHOSPHOR_DECAY_INTERVAL_MS = 100;
const SID_PHOSPHOR_STORAGE_KEY = "module-player.sid-phosphor-persistence";
let player;
let xmpPlayer;
let sidPlayer;
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
let sidPhosphorDecayTimer;
let lastTrackerPositionKey;
let sidTrackerRenderQueued = false;
let lastSidScopeRevision = -1;
let sidRegisterDetailEnabled = true;
let sidPhosphorEnabled = readStoredBoolean(SID_PHOSPHOR_STORAGE_KEY, false);
let lastMegaSidState;
let lastMegaSidStateRevision = -1;
let immersiveCursorTimer;
let immersiveOwnedFullscreen = false;
let immersiveMode = "visualizer";
let lastMegaPatternKey;
let selectedSidChip = 0;
const sidEnvelopeStates = new Map();
const sidNoiseStates = new Map();
const sidOscillatorPhases = new Map();
const immersiveVisualizer = new ImmersiveVisualizer($("immersive-canvas"), {
  getSource: () => activeEngine === "xmp" ? xmpPlayer?.visualization : activeEngine === "sid" ? sidPlayer?.visualization : player?.visualization,
  getSidState: () => {
    if (!sidRegisterDetailEnabled || immersiveMode !== "mega" || activeEngine !== "sid") return undefined;
    const revision = sidPlayer?.visualization?.revision;
    if (lastMegaSidState?.chip === selectedSidChip && revision === lastMegaSidStateRevision) return lastMegaSidState;
    const status = sidPlayer?.getSidStatus(selectedSidChip);
    if (!status) return undefined;
    lastMegaSidStateRevision = revision;
    lastMegaSidState = {
      chip: selectedSidChip,
      voices: [0, 1, 2].map((voice) => {
        const offset = voice * 7;
        return {
          frequency: status[offset] | (status[offset + 1] << 8),
          pulseWidth: status[offset + 2] | ((status[offset + 3] & 0x0f) << 8),
          control: status[offset + 4]
        };
      }),
      writes: sidPlayer.getSidWriteTraceSnapshot(selectedSidChip)
    };
    return lastMegaSidState;
  },
  onFrame: renderMegaFrame,
  reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
});

function readStoredBoolean(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch { return fallback; }
}
function storeBoolean(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* Storage can be unavailable in private contexts. */ }
}
function showStatus(message) { $("status").textContent = message; }
function updateSidWriteTracing() {
  const trackerDetailActive = $("tracker-dialog").open && activeEngine === "sid" && sidRegisterDetailEnabled;
  const megaDetailActive = $("immersive-dialog").open && activeEngine === "sid" && immersiveMode === "mega" && sidRegisterDetailEnabled;
  sidPlayer?.setSidWriteTraceEnabled(trackerDetailActive || megaDetailActive);
}
function stopScopeLoop() {
  if (scopeTimer === undefined) return;
  clearInterval(scopeTimer);
  scopeTimer = undefined;
}
function startScopeLoop() {
  stopScopeLoop();
  draw(performance.now());
  if (!scopesEnabled || !(activeEngine === "xmp" ? xmpPlayer?.visualization : activeEngine === "sid" ? sidPlayer?.visualization : player?.visualization)) return;
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
    : activeEngine === "sid"
      ? sidPlayer?.getDiagnostics() ?? {}
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
  const trackerControl = $("tracker-track");
  const trackerReadout = $("tracker-track-readout");
  const trackerPrevious = $("tracker-previous-track");
  const trackerNext = $("tracker-next-track");
  const trackerSubsongControl = $("tracker-subsong-control");
  const subsong = subsongState;
  trackerSubsongControl.hidden = activeEngine !== "sid";
  if (!Number.isInteger(subsong?.minimum) || !Number.isInteger(subsong?.maximum)) {
    control.disabled = true;
    control.min = "0";
    control.max = "0";
    control.value = "0";
    previous.disabled = true;
    next.disabled = true;
    readout.value = "--";
    readout.textContent = readout.value;
    trackerControl.disabled = true;
    trackerControl.min = "0";
    trackerControl.max = "0";
    trackerControl.value = "0";
    trackerPrevious.disabled = true;
    trackerNext.disabled = true;
    trackerReadout.value = "--";
    trackerReadout.textContent = trackerReadout.value;
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
  trackerControl.min = control.min;
  trackerControl.max = control.max;
  trackerControl.value = control.value;
  trackerControl.disabled = control.disabled;
  trackerPrevious.disabled = previous.disabled;
  trackerNext.disabled = next.disabled;
  trackerReadout.value = readout.value;
  trackerReadout.textContent = trackerReadout.value;
}
function selectSubsong(track) {
  const control = $("track");
  selectedSubsong = Math.min(Number(control.max), Math.max(Number(control.min), track));
  control.value = String(selectedSubsong);
  $("tracker-track").value = control.value;
  stageRestart("subsong");
  updateSubsongControl();
  return selectedSubsong;
}
async function restartWithSubsong(track) {
  const selectedTrack = Number(selectSubsong(track));
  if (activeEngine === "sid" && sidPlayer?.state !== "disposed") {
    await sidPlayer.selectSong(selectedTrack);
    return;
  }
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
  updateImmersiveLabels();
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
  delete $("tracker-grid").dataset.sidStructureKey;
  updateSubsongControl();
  renderMetadata();
  renderTrackerView();
  updateImmersiveLabels();
}
function setSidMetadata(info) {
  sidEnvelopeStates.clear();
  sidNoiseStates.clear();
  sidOscillatorPhases.clear();
  const configured = sidPlayer?.getEmulationConfig?.();
  const configuredClock = configured?.c64Model && configured.forceC64Model ? `C64 ${configured.c64Model}` : undefined;
  const configuredModel = configured?.sidModel && configured.forceSidModel ? `Emulating ${configured.sidModel}` : undefined;
  metadataState = {
    title: info.title || info.fileName,
    fileName: info.fileName,
    fileLengthBytes: info.fileLengthBytes,
    format: info.format,
    player: info.engine || "libsidplayfp",
    subsong: { minimum: 0, maximum: info.songCount - 1, current: info.currentSong },
    summary: [info.author, info.released, `${info.installedSids} SID chip${info.installedSids === 1 ? "" : "s"}`, `Tune ${info.clock}`, `Tune ${info.sidModel}`, configuredClock, configuredModel].filter(Boolean),
    raw: info
  };
  subsongState = metadataState.subsong;
  selectedSubsong = info.currentSong;
  updateSubsongControl();
  renderMetadata();
  renderTrackerView();
  updateImmersiveLabels();
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
  const pixelRatio = 1;
  const renderWidth = Math.max(1, Math.min(TRACKER_SCOPE_MAX_WIDTH, Math.round(canvas.clientWidth * pixelRatio)));
  const renderHeight = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));
  if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
    canvas.width = renderWidth;
    canvas.height = renderHeight;
  }
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
  const points = Math.min(TRACKER_SCOPE_POINTS, data.length);
  for (let index = 0; index < points; index++) {
    const position = index / Math.max(1, points - 1);
    const sample = data[Math.min(data.length - 1, Math.round(position * (data.length - 1)))];
    const x = position * width;
    const y = (1 - sample) * height / 2;
    index ? context.lineTo(x, y) : context.moveTo(x, y);
  }
  context.stroke();
}
function readVisualizationChannels(source) {
  if (!source) return [];
  if (typeof source.readChannels === "function") return source.readChannels();
  const count = source.streamCount;
  const channels = [];
  for (let channel = 0; channel < count; channel++) channels.push(source.readChannel(channel));
  return channels;
}
function renderTrackerScopes() {
  const container = $("tracker-scopes");
  const source = activeEngine === "xmp" ? xmpPlayer?.visualization : activeEngine === "sid" ? sidPlayer?.visualization : undefined;
  if (!source) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }
  if (activeEngine === "sid" && source.revision === lastSidScopeRevision) return;
  if (activeEngine === "sid") lastSidScopeRevision = source.revision;
  container.hidden = false;
  const channels = readVisualizationChannels(source);
  const labels = activeEngine === "sid" ? ["FINAL MIX PCM L", "FINAL MIX PCM R"] : ["OUT L", "OUT R"];
  if (container.children.length !== 2) {
    container.replaceChildren(...labels.map((label, channel) => {
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
    const label = container.children[channel].querySelector(".tracker-scope-label");
    if (label.textContent !== labels[channel]) label.textContent = labels[channel];
    const data = channels[channel] ?? new Float32Array();
    drawTrackerScope(container.children[channel].querySelector("canvas"), data);
  }
}
function sidWaveforms(control) {
  return [[0x10, "TRI"], [0x20, "SAW"], [0x40, "PULSE"], [0x80, "NOISE"]]
    .filter(([mask]) => control & mask)
    .map(([, name]) => name);
}
function sidHex(value, width = 2) { return `0x${value.toString(16).toUpperCase().padStart(width, "0")}`; }
function sidClockHz() {
  const model = sidPlayer?.getEmulationConfig?.()?.c64Model;
  return { NTSC: 1022727, OLD_NTSC: 1022727, DREAN: 1023440, PAL_M: 1022727 }[model] ?? 985248;
}
function sidPitch(frequency) {
  if (!frequency) return { note: "-- ", hertz: "    --.- Hz", register: sidHex(0, 4) };
  const hertz = frequency * sidClockHz() / 16777216;
  const midi = Math.round(69 + 12 * Math.log2(hertz / 440));
  const note = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][((midi % 12) + 12) % 12];
  return { note: `${note}${Math.floor(midi / 12) - 1}`.padEnd(3), hertz: `${hertz.toFixed(1).padStart(8)} Hz`, register: sidHex(frequency, 4) };
}
function advanceSidNoiseLfsr(lfsr) {
  const feedback = ((lfsr >>> 22) ^ (lfsr >>> 17)) & 1;
  return ((lfsr << 1) & SID_NOISE_LFSR_MASK) | feedback;
}
function sidNoiseSample(lfsr) {
  const output = ((lfsr >>> 22) & 0x80) | ((lfsr >>> 20) & 0x40) | ((lfsr >>> 16) & 0x20) | ((lfsr >>> 13) & 0x10) | ((lfsr >>> 11) & 0x08) | ((lfsr >>> 7) & 0x04) | ((lfsr >>> 4) & 0x02) | ((lfsr >>> 2) & 0x01);
  return output / 127.5 - 1;
}
function updateSidNoiseState(voice, frequency, control) {
  const now = performance.now();
  const key = `${selectedSidChip}:${voice}`;
  let state = sidNoiseStates.get(key);
  if (!state) {
    state = { lfsr: SID_NOISE_LFSR_SEED, remainder: 0, lastUpdatedAt: now };
    sidNoiseStates.set(key, state);
  }
  const elapsedSeconds = Math.max(0, now - state.lastUpdatedAt) / 1000;
  state.lastUpdatedAt = now;
  if (control & 0x08) {
    state.lfsr = SID_NOISE_LFSR_SEED;
    state.remainder = 0;
    return state.lfsr;
  }
  const clocks = elapsedSeconds * frequency * sidClockHz() / SID_NOISE_CLOCK_DIVISOR + state.remainder;
  const totalSteps = Math.floor(clocks);
  const steps = Math.min(totalSteps, SID_NOISE_MAX_MODEL_STEPS);
  state.remainder = totalSteps > SID_NOISE_MAX_MODEL_STEPS ? 0 : clocks - steps;
  for (let index = 0; index < Math.min(steps, SID_NOISE_LFSR_MASK); index += 1) state.lfsr = advanceSidNoiseLfsr(state.lfsr);
  return state.lfsr;
}
function updateSidOscillatorPhase(voice, frequency, control) {
  const key = `${selectedSidChip}:${voice}`;
  let state = sidOscillatorPhases.get(key);
  if (!state) {
    state = { phase: 0, frequency };
    sidOscillatorPhases.set(key, state);
  }
  if (control & 0x08) state.phase = 0;
  else state.phase = (state.phase + (frequency - state.frequency) / SID_OSCILLATOR_PHASE_PITCH_DIVISOR + 1) % 1;
  state.frequency = frequency;
  return state.phase;
}
function sidVoiceFacts(frequency, pulseWidth, filterRouting, voice) {
  const pitch = sidPitch(frequency);
  return [`${pitch.note}  ${pitch.hertz}  ${pitch.register}`, String(pulseWidth).padStart(4, "0"), filterRouting & (1 << voice) ? "ROUTED" : "BYPASS"];
}
function advanceSidEnvelope(state, elapsedMs) {
  let remaining = elapsedMs;
  const sustain = state.sustain / 15;
  while (remaining > 0) {
    if (state.phase === "attack") {
      const duration = Math.max(1, SID_ATTACK_MS[state.attack] * (1 - state.level));
      if (remaining < duration) { state.level += remaining / SID_ATTACK_MS[state.attack]; break; }
      state.level = 1;
      state.phase = "decay";
      remaining -= duration;
      continue;
    }
    if (state.phase === "decay") {
      const distance = Math.max(0, state.level - sustain);
      const duration = Math.max(1, SID_DECAY_RELEASE_MS[state.decay] * distance);
      if (remaining < duration) { state.level -= remaining / SID_DECAY_RELEASE_MS[state.decay]; break; }
      state.level = sustain;
      state.phase = "sustain";
      remaining -= duration;
      continue;
    }
    if (state.phase === "release") {
      const duration = Math.max(1, SID_DECAY_RELEASE_MS[state.release] * state.level);
      if (remaining < duration) { state.level -= remaining / SID_DECAY_RELEASE_MS[state.release]; break; }
      state.level = 0;
      state.phase = "idle";
    }
    break;
  }
  state.level = Math.min(1, Math.max(0, state.level));
}
function updateSidEnvelope(voice, attack, decay, sustain, release, gate, writes) {
  const now = performance.now();
  let state = sidEnvelopeStates.get(voice);
  const isNewState = !state;
  if (!state) {
    state = { attack, decay, sustain, release, gate: false, level: 0, phase: "idle", lastUpdatedAt: now, lastWriteCycle: undefined, history: [] };
    sidEnvelopeStates.set(voice, state);
  }
  const base = voice * 7;
  let wroteEnvelopeRegister = false;
  for (const write of writes) {
    if (write.address < base + 4 || write.address > base + 6 || write.cyclePhi1 <= (state.lastWriteCycle ?? -Infinity)) continue;
    wroteEnvelopeRegister = true;
    if (state.lastWriteCycle !== undefined) advanceSidEnvelope(state, Math.max(0, write.cyclePhi1 - state.lastWriteCycle) / SID_CYCLES_PER_SECOND * 1000);
    state.lastWriteCycle = write.cyclePhi1;
    if (write.address === base + 4) {
      const nextGate = Boolean(write.value & 1);
      if (nextGate !== state.gate) {
        state.gate = nextGate;
        state.phase = nextGate ? "attack" : "release";
      }
    } else if (write.address === base + 5) {
      state.attack = write.value >> 4;
      state.decay = write.value & 0x0f;
    } else {
      state.sustain = write.value >> 4;
      state.release = write.value & 0x0f;
    }
    if (isNewState) state.history.push(state.level);
  }
  if (isNewState) {
    state.attack = attack;
    state.decay = decay;
    state.sustain = sustain;
    state.release = release;
    state.gate = gate;
    state.level = gate ? sustain / 15 : 0;
    state.phase = gate ? "sustain" : "idle";
  } else advanceSidEnvelope(state, Math.max(0, now - state.lastUpdatedAt));
  if (state.history.length > SID_ENVELOPE_HISTORY_LIMIT) state.history.splice(0, state.history.length - SID_ENVELOPE_HISTORY_LIMIT);
  state.lastUpdatedAt = now;
  state.attack = attack;
  state.decay = decay;
  state.sustain = sustain;
  state.release = release;
  if (!wroteEnvelopeRegister && gate !== state.gate) { state.gate = gate; state.phase = gate ? "attack" : "release"; }
  state.history.push(state.level);
  if (state.history.length > SID_ENVELOPE_HISTORY_LIMIT) state.history.shift();
  return state;
}
function drawSidEnvelopeReconstruction(canvas, envelope) {
  const pixelRatio = 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
  const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext("2d");
  context.fillStyle = "#08191e";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(119, 213, 187, .12)";
  context.setLineDash([3 * pixelRatio, 3 * pixelRatio]);
  const sustainY = height * (1 - envelope.sustain / 15);
  context.beginPath();
  context.moveTo(0, sustainY);
  context.lineTo(width, sustainY);
  context.stroke();
  context.setLineDash([]);
  const samples = envelope.history;
  if (!samples.length) return;
  context.strokeStyle = "#77d5bb";
  context.lineWidth = Math.max(1, pixelRatio * 1.5);
  context.beginPath();
  for (let index = 0; index < samples.length; index += 1) {
    const x = index / Math.max(1, samples.length - 1) * width;
    const y = height * (1 - samples[index]);
    index ? context.lineTo(x, y) : context.moveTo(x, y);
  }
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fillStyle = "rgba(119, 213, 187, .12)";
  context.fill();
  context.stroke();
}
function drawSidOscillatorGrid(context, width, height) {
  context.strokeStyle = "rgba(119, 213, 187, .12)";
  context.lineWidth = 1;
  const originY = Math.round(height / 2) + .5;
  for (const y of [height * .25, originY, height * .75]) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}
function decaySidPhosphor() {
  if (!sidPhosphorEnabled) {
    sidPhosphorDecayTimer = undefined;
    return;
  }
  const now = performance.now();
  let active = false;
  for (const canvas of document.querySelectorAll(".sid-register-trace canvas")) {
    if (!canvas._sidPhosphorUntil || now >= canvas._sidPhosphorUntil) {
      canvas._sidPhosphorUntil = undefined;
      continue;
    }
    const elapsed = Math.max(0, now - (canvas._sidPhosphorUpdatedAt ?? now));
    canvas._sidPhosphorUpdatedAt = now;
    const context = canvas.getContext("2d");
    context.globalAlpha = 1;
    context.fillStyle = `rgba(8, 25, 30, ${1 - Math.pow(.01, elapsed / SID_PHOSPHOR_DECAY_MS)})`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawSidOscillatorGrid(context, canvas.width, canvas.height);
    active = true;
  }
  if (active) sidPhosphorDecayTimer = window.setTimeout(decaySidPhosphor, SID_PHOSPHOR_DECAY_INTERVAL_MS);
  else sidPhosphorDecayTimer = undefined;
}
function startSidPhosphorDecay(canvas) {
  if (!sidPhosphorEnabled) return;
  const now = performance.now();
  canvas._sidPhosphorUpdatedAt = now;
  canvas._sidPhosphorUntil = now + SID_PHOSPHOR_DECAY_MS;
  if (sidPhosphorDecayTimer === undefined) sidPhosphorDecayTimer = window.setTimeout(decaySidPhosphor, SID_PHOSPHOR_DECAY_INTERVAL_MS);
}
function drawSidOscillatorReconstruction(canvas, { frequency, pulseWidth, control, envelopeLevel, noiseLfsr, phase }) {
  const pixelRatio = 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
  const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));
  const resized = canvas.width !== width || canvas.height !== height;
  if (resized) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.globalAlpha = 1;
  context.fillStyle = !sidPhosphorEnabled || resized || !canvas._sidPhosphorPainted ? "#08191e" : "rgba(8, 25, 30, .5)";
  context.fillRect(0, 0, width, height);
  canvas._sidPhosphorPainted = sidPhosphorEnabled;
  drawSidOscillatorGrid(context, width, height);
  const originY = Math.round(height / 2) + .5;
  const gated = control & 1;
  const test = control & 0x08;
  const ring = control & 0x04;
  const sync = control & 0x02;
  const cycles = Math.max(1, Math.min(16, frequency / 2048));
  const phaseOffset = phase ?? 0;
  const dutyCycle = Math.max(.03, Math.min(.97, pulseWidth / 4095));
  const points = Math.min(width, 320);
  const noiseStep = Math.max(1, Math.round(points / (16 * cycles)));
  let noiseRegister = noiseLfsr ?? SID_NOISE_LFSR_SEED;
  let noiseMean = 0;
  if (control & 0x80) {
    let previewRegister = noiseRegister;
    for (let index = 0; index < points; index += 1) {
      if (index && index % noiseStep === 0) previewRegister = advanceSidNoiseLfsr(previewRegister);
      noiseMean += sidNoiseSample(previewRegister);
    }
    noiseMean /= points;
  }
  context.strokeStyle = gated ? "#77d5bb" : "#426568";
  context.lineWidth = Math.max(1, pixelRatio * 1.5);
  context.beginPath();
  for (let index = 0; index < points; index += 1) {
    const position = index / Math.max(1, points - 1);
    let step = (position * cycles + phaseOffset) % 1;
    if (sync) step = (step * 2) % 1;
    const triangle = 1 - 4 * Math.abs(step - .5);
    const saw = step * 2 - 1;
    const pulse = step < dutyCycle ? 1 : -1;
    if (index && index % noiseStep === 0) noiseRegister = advanceSidNoiseLfsr(noiseRegister);
    const noise = sidNoiseSample(noiseRegister) - noiseMean;
    let waveformTotal = 0;
    let waveformCount = 0;
    if (control & 0x10) { waveformTotal += triangle; waveformCount++; }
    if (control & 0x20) { waveformTotal += saw; waveformCount++; }
    if (control & 0x40) { waveformTotal += pulse; waveformCount++; }
    if (control & 0x80) { waveformTotal += noise; waveformCount++; }
    let sample = test || !waveformCount ? 0 : waveformTotal / waveformCount;
    if (ring && control & 0x10) sample *= Math.sin((position * cycles * 2 + phaseOffset) * Math.PI * 2);
    const y = originY - sample * height * .38 * envelopeLevel;
    const x = position * width;
    index ? context.lineTo(x, y) : context.moveTo(x, y);
  }
  context.stroke();
  startSidPhosphorDecay(canvas);
}
function sidVoiceMonitor(voice, status, filterRouting, envelopeState) {
  const offset = voice * 7;
  const frequency = status[offset] | (status[offset + 1] << 8);
  const pulseWidth = status[offset + 2] | ((status[offset + 3] & 0x0f) << 8);
  const control = status[offset + 4];
  const attackDecay = status[offset + 5];
  const sustainRelease = status[offset + 6];
  const waveforms = sidWaveforms(control);
  const card = document.createElement("article");
  card.className = `sid-voice${control & 1 ? " is-gated" : ""}${control & 0x80 ? " is-noise" : ""}`;
  const heading = document.createElement("header");
  heading.className = "sid-voice-head";
  heading.append(textElement("p", `V${voice + 1}`, "sid-voice-label"));
  const waveform = document.createElement("div");
  waveform.className = "sid-waveforms";
  for (const name of ["TRI", "SAW", "PULSE", "NOISE", "GATE"]) waveform.append(textElement("span", name, waveforms.includes(name) || name === "GATE" && control & 1 ? "is-active" : ""));
  heading.append(waveform);
  card.append(heading);
  const envelope = document.createElement("section");
  envelope.className = "sid-envelope";
  const envelopeHeader = document.createElement("div");
  envelopeHeader.className = "sid-envelope-header";
  envelopeHeader.append(textElement("p", "ENVELOPE", "sid-envelope-label"), textElement("p", envelopeState.phase.toUpperCase(), "sid-envelope-phase"));
  const settings = document.createElement("div");
  settings.className = "sid-envelope-settings";
  for (const [name, value] of [["ATTACK", attackDecay >> 4], ["DECAY", attackDecay & 0x0f], ["SUSTAIN", sustainRelease >> 4], ["RELEASE", sustainRelease & 0x0f]]) settings.append(textElement("span", name), textElement("strong", String(value)));
  envelopeHeader.append(settings);
  envelope.append(envelopeHeader);
  const envelopeCanvas = document.createElement("canvas");
  envelopeCanvas.className = "sid-envelope-canvas";
  envelopeCanvas._sidEnvelope = envelopeState;
  envelopeCanvas.setAttribute("aria-label", `Voice ${voice + 1} ADSR envelope reconstruction`);
  envelope.append(envelopeCanvas);
  card.append(envelope);
  const values = document.createElement("div");
  values.className = "sid-voice-values";
  const valuesForVoice = sidVoiceFacts(frequency, pulseWidth, filterRouting, voice);
  const facts = [["PITCH", valuesForVoice[0]], ["PULSE WIDTH", valuesForVoice[1]], ["FILTER", valuesForVoice[2]]];
  for (const [label, value] of facts) {
    const fact = document.createElement("div");
    fact.append(textElement("span", label), textElement("strong", value));
    values.append(fact);
  }
  card.append(values);
  const trace = document.createElement("section");
  trace.className = "sid-register-trace";
  trace.append(textElement("p", "OSCILLATOR WAVEFORM  /  SID-STYLE REGISTER MODEL", "sid-trace-label"));
  const canvas = document.createElement("canvas");
  canvas._sidOscillator = { frequency, pulseWidth, control, envelopeLevel: envelopeState.level, noiseLfsr: updateSidNoiseState(voice, frequency, control), phase: updateSidOscillatorPhase(voice, frequency, control) };
  canvas.setAttribute("aria-label", `Voice ${voice + 1} oscillator waveform reconstruction`);
  trace.append(canvas);
  card.append(trace);
  return card;
}
function updateSidVoiceMonitor(card, voice, status, filterRouting, envelopeState) {
  const offset = voice * 7;
  const frequency = status[offset] | (status[offset + 1] << 8);
  const pulseWidth = status[offset + 2] | ((status[offset + 3] & 0x0f) << 8);
  const control = status[offset + 4];
  const attackDecay = status[offset + 5];
  const sustainRelease = status[offset + 6];
  const key = `${frequency}:${pulseWidth}:${control}:${attackDecay}:${sustainRelease}:${filterRouting}`;
  if (card.dataset.sidRegisterKey !== key) {
    card.dataset.sidRegisterKey = key;
    card.classList.toggle("is-gated", Boolean(control & 1));
    card.classList.toggle("is-noise", Boolean(control & 0x80));
    const waveforms = sidWaveforms(control);
    for (const [index, name] of ["TRI", "SAW", "PULSE", "NOISE", "GATE"].entries()) {
      card.querySelectorAll(".sid-waveforms span")[index].classList.toggle("is-active", waveforms.includes(name) || name === "GATE" && Boolean(control & 1));
    }
    card.querySelector(".sid-envelope-phase").textContent = envelopeState.phase.toUpperCase();
    const settings = [attackDecay >> 4, attackDecay & 0x0f, sustainRelease >> 4, sustainRelease & 0x0f];
    for (const [index, value] of settings.entries()) card.querySelectorAll(".sid-envelope-settings strong")[index].textContent = String(value);
    const facts = sidVoiceFacts(frequency, pulseWidth, filterRouting, voice);
    for (const [index, value] of facts.entries()) card.querySelectorAll(".sid-voice-values strong")[index].textContent = value;
  }
  const oscillator = card.querySelector(".sid-register-trace canvas");
  oscillator._sidOscillator = { frequency, pulseWidth, control, envelopeLevel: envelopeState.level, noiseLfsr: updateSidNoiseState(voice, frequency, control), phase: updateSidOscillatorPhase(voice, frequency, control) };
}
function renderSidTrackerView() {
  const dialog = $("tracker-dialog");
  const title = metadataState?.title || metadataState?.fileName || "Tracker View";
  const source = metadataState?.fileName
    ? `${metadataState.fileName}  |  ${metadataState.player || "libsidplayfp"}`
    : "No module loaded.";
  if (!dialog.classList.contains("sid-tracker")) dialog.classList.add("sid-tracker");
  if ($("tracker-dialog-title").textContent !== title) $("tracker-dialog-title").textContent = title;
  if ($("tracker-dialog-source").textContent !== source) $("tracker-dialog-source").textContent = source;
  const grid = $("tracker-grid");
  const registerDetailControl = $("tracker-sid-register-detail-control");
  const phosphorControl = $("tracker-sid-phosphor-control");
  registerDetailControl.hidden = activeEngine !== "sid";
  phosphorControl.hidden = activeEngine !== "sid";
  if ($("tracker-sid-register-detail").checked !== sidRegisterDetailEnabled) $("tracker-sid-register-detail").checked = sidRegisterDetailEnabled;
  if ($("tracker-sid-phosphor").checked !== sidPhosphorEnabled) $("tracker-sid-phosphor").checked = sidPhosphorEnabled;
  if (!sidRegisterDetailEnabled) {
    $("tracker-dialog-kicker").textContent = "SID FINAL MIX WAVEFORMS";
    $("tracker-status").textContent = "FINAL MIX PCM WAVEFORMS";
    $("tracker-sid-chip-control").hidden = true;
    grid.hidden = true;
    if (grid.childElementCount) grid.replaceChildren();
    delete grid.dataset.sidStructureKey;
    return;
  }
  grid.hidden = false;
  const installedSids = sidPlayer?.getInstalledSids() ?? 0;
  selectedSidChip = Math.min(selectedSidChip, Math.max(0, installedSids - 1));
  const status = sidPlayer?.getSidStatus(selectedSidChip);
  const orderMap = $("tracker-order-map");
  if (!orderMap.hidden || orderMap.childElementCount) {
    orderMap.hidden = true;
    orderMap.replaceChildren();
    delete orderMap.dataset.orders;
  }
  const chipControl = $("tracker-sid-chip-control");
  chipControl.hidden = activeEngine !== "sid" || installedSids < 2;
  const chipKey = `${installedSids}:${selectedSidChip}`;
  if (installedSids > 1 && chipControl.dataset.sidChipKey !== chipKey) {
    chipControl.replaceChildren(...Array.from({ length: installedSids }, (_, chip) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.sidChip = String(chip);
      button.className = chip === selectedSidChip ? "is-selected" : "";
      button.textContent = `SID ${chip + 1}`;
      button.setAttribute("aria-pressed", String(chip === selectedSidChip));
      return button;
    }));
    chipControl.dataset.sidChipKey = chipKey;
  }
  if (!status) {
    $("tracker-status").textContent = "Awaiting live SID register state.";
    grid.replaceChildren();
    delete grid.dataset.sidStructureKey;
    return;
  }
  const filterRouting = status[0x17] & 0x07;
  const structureKey = `${selectedSidChip}:${installedSids}`;
  const filterMode = [status[0x18] & 0x10 ? "LP" : undefined, status[0x18] & 0x20 ? "BP" : undefined, status[0x18] & 0x40 ? "HP" : undefined].filter(Boolean).join(" + ") || "OFF";
  const cutoff = (status[0x15] & 0x07) | (status[0x16] << 3);
  const trackerStatus = `SID ${String(selectedSidChip + 1).padStart(2, "0")} / ${String(installedSids).padStart(2, "0")}  |  FILTER ${filterMode.padEnd(12)}  |  CUTOFF ${String(cutoff).padStart(4, "0")}  |  RESONANCE ${String(status[0x17] >> 4).padStart(2, "0")}  |  VOLUME ${String(status[0x18] & 0x0f).padStart(2, "0")}`;
  if ($("tracker-dialog-kicker").textContent !== "SID LIVE REGISTER VISUALIZATION") $("tracker-dialog-kicker").textContent = "SID LIVE REGISTER VISUALIZATION";
  if ($("tracker-status").textContent !== trackerStatus) $("tracker-status").textContent = trackerStatus;
  const writesByVoice = [[], [], []];
  for (const write of sidPlayer.getSidEnvelopeWriteHistorySnapshot(selectedSidChip)) {
    const voice = Math.floor(write.address / 7);
    if (voice >= 0 && voice < writesByVoice.length && write.address % 7 >= 4) writesByVoice[voice].push(write);
  }
  const envelopes = [0, 1, 2].map((voice) => {
    const offset = voice * 7;
    return updateSidEnvelope(voice, status[offset + 5] >> 4, status[offset + 5] & 0x0f, status[offset + 6] >> 4, status[offset + 6] & 0x0f, Boolean(status[offset + 4] & 1), writesByVoice[voice]);
  });
  if (grid.dataset.sidStructureKey !== structureKey) {
    grid.replaceChildren(...[0, 1, 2].map((voice) => sidVoiceMonitor(voice, status, filterRouting, envelopes[voice])));
    grid.dataset.sidStructureKey = structureKey;
  }
  for (const [voice, card] of [...grid.querySelectorAll(".sid-voice")].entries()) updateSidVoiceMonitor(card, voice, status, filterRouting, envelopes[voice]);
  for (const [voice, canvas] of [...grid.querySelectorAll(".sid-envelope-canvas")].entries()) {
    canvas._sidEnvelope = envelopes[voice];
    drawSidEnvelopeReconstruction(canvas, canvas._sidEnvelope);
  }
  for (const [voice, canvas] of [...grid.querySelectorAll(".sid-register-trace canvas")].entries()) {
    const oscillator = canvas._sidOscillator;
    const oscillatorKey = `${oscillator.frequency}:${oscillator.pulseWidth}:${oscillator.control}:${Math.round(oscillator.envelopeLevel * 16)}:${oscillator.noiseLfsr}:${Math.floor(oscillator.phase * 256)}`;
    if (canvas._sidRenderKey !== oscillatorKey) {
      canvas._sidRenderKey = oscillatorKey;
      drawSidOscillatorReconstruction(canvas, oscillator);
    }
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
  if (activeEngine === "sid") {
    renderSidTrackerView();
    return;
  }
  dialog.classList.toggle("sid-tracker", activeEngine === "sid");
  const title = metadataState?.title || metadataState?.fileName || "Tracker View";
  $("tracker-dialog-title").textContent = title;
  $("tracker-dialog-kicker").textContent = "TRACKER LIVE VISUALIZATION";
  $("tracker-dialog-source").textContent = metadataState?.fileName
    ? `${metadataState.fileName}  |  ${metadataState.player || "webXMP"}`
    : "No module loaded.";
  $("tracker-order-map").hidden = false;
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
  if (trackerAnimationFrame !== undefined) {
    window.cancelAnimationFrame(trackerAnimationFrame);
    trackerAnimationFrame = undefined;
  }
  if (sidPhosphorDecayTimer !== undefined) {
    clearTimeout(sidPhosphorDecayTimer);
    sidPhosphorDecayTimer = undefined;
  }
}
function scheduleSidTrackerRender() {
  if (sidTrackerRenderQueued || activeEngine !== "sid" || !$("tracker-dialog").open) return;
  sidTrackerRenderQueued = true;
  window.requestAnimationFrame(() => {
    sidTrackerRenderQueued = false;
    renderSidTrackerView();
  });
}
function startTrackerAnimation() {
  stopTrackerAnimation();
  if (activeEngine === "sid") {
    renderSidTrackerView();
    const paintScopes = () => {
      if (!$("tracker-dialog").open || activeEngine !== "sid") return;
      renderTrackerScopes();
      trackerAnimationFrame = window.requestAnimationFrame(paintScopes);
    };
    paintScopes();
    return;
  }
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
  await sidPlayer?.dispose();
  sidPlayer = undefined;
  if (!xmpPlayer || xmpPlayer.state === "disposed") {
    xmpPlayer = await createXmpPlayer({
      assetBaseUrl: "../xmp",
      processorBufferSize: Number($("buffer").value),
      audioContextSampleRate: Number($("audio-rate").value)
    });
    xmpPlayer.setVolume(Number($("volume").value));
    xmpPlayer.visualization?.setZoom(Number($("zoom").value));
    xmpPlayer.setStreamPanning(Number($("pan").value));
    xmpPlayer.setSilenceTimeout(Number($("silence").value));
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
async function loadWithSid(buffer, filename) {
  activeEngine = "sid";
  selectedSidChip = 0;
  scopesEnabled = $("visualizer").checked;
  stopScopeLoop();
  // Construct the AudioContext before any awaited teardown so a click that
  // selects a SID remains a valid Web Audio user gesture.
  const newSidPlayer = !sidPlayer || sidPlayer.state === "disposed" || sidPlayer.getDiagnostics().processorBufferSize !== SID_SCOPE_PROCESSOR_BUFFER_SIZE
    ? createSidPlayer({
      assetBaseUrl: "../sid/assets",
      engine: "residfp",
      processorBufferSize: SID_SCOPE_PROCESSOR_BUFFER_SIZE,
      audioContextSampleRate: Number($("audio-rate").value),
      emulationConfig: sidEmulationConfig()
    })
    : undefined;
  await player?.dispose();
  player = undefined;
  await xmpPlayer?.dispose();
  xmpPlayer = undefined;
  if (newSidPlayer) {
    await sidPlayer?.dispose();
    sidPlayer = await newSidPlayer;
    sidPlayer.setVolume(Number($("volume").value));
    sidPlayer.visualization?.setZoom(Number($("zoom").value));
    sidPlayer.setStreamPanning(Number($("pan").value));
    sidPlayer.on("state", () => updateControls());
    sidPlayer.on("audio", scheduleSidTrackerRender);
    sidPlayer.on("ended", () => showStatus($("loop").checked ? "Looping SID tune." : "SID tune ended."));
    sidPlayer.on("error", (error) => { loadFailure = error.message; showStatus(loadFailure); renderMetadata(); });
  }
  const metadata = await sidPlayer.load(buffer, { ...options(filename), silenceTimeoutSeconds: Number($("silence").value) });
  loadFailure = undefined;
  setSidMetadata(metadata);
  showStatus("Player state: playing");
  showDiagnostics();
  startScopeLoop();
  updateControls();
}
function songUrl(name) { return `assets/music/${name.split("/").map(encodeURIComponent).join("/")}`; }
function selectionUrl(selection) {
  return selection.type === "remote" ? selection.url : songUrl(selection.filename);
}
function hasSidExtension(filename) {
  return /\.(?:sid|psid|rsid)$/i.test(String(filename ?? "").split(/[\\/]/).pop() ?? "");
}
function prefersXmp(filename) {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension === "mod") return $("prefer-xmp-mod").checked;
  return XMP_PREFERRED_EXTENSIONS.has(extension);
}
function renderSourceControl() {
  $("songs-control").hidden = false;
}
async function inspectSelection(selection) {
  const token = ++pendingScoutToken;
  pendingScoutState = undefined;
  pendingScoutError = undefined;
  renderMetadata();
  try {
    const buffer = selection.type === "file"
      ? selection.buffer
      : await fetch(selectionUrl(selection)).then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      });
    if (token !== pendingScoutToken || lastSelection !== selection) return;
    pendingScoutState = scoutFile(buffer, { filename: selection.filename, uade: !hasSidExtension(selection.filename) });
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
function selectRemoteSong(url) {
  const parsedUrl = new URL(url, window.location.href);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("moduleUrl must use HTTP or HTTPS.");
  const filename = decodeURIComponent(parsedUrl.pathname.split("/").pop()) || "remote-module";
  $("songs").selectedIndex = -1;
  loadFailure = undefined;
  subsongState = undefined;
  selectedSubsong = undefined;
  selectedTrackerOrder = 0;
  updateSubsongControl();
  lastSelection = { type: "remote", filename, url: parsedUrl.href };
  renderSourceControl();
  void inspectSelection(lastSelection);
}
function selectFile(selection) {
  $("songs").selectedIndex = -1;
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
  if (requestedModuleUrl) {
    selectRemoteSong(requestedModuleUrl);
    return;
  }
  if (requestedDemo) {
    const requestedSong = songs.find((song) => song.toLowerCase() === requestedDemo.toLowerCase());
    if (requestedSong) {
      selectBundledSong(requestedSong);
      return;
    }
    showStatus(`Demo module not found: ${requestedDemo}.`);
  }
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
function sidEmulationConfig() {
  const c64Model = $("sid-c64-model").value;
  const sidModel = $("sid-model").value;
  return {
    ...(c64Model ? { c64Model, forceC64Model: true } : { forceC64Model: false }),
    ...(sidModel ? { sidModel, forceSidModel: true } : { forceSidModel: false }),
    digiBoost: $("sid-digi-boost").checked
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
  const isXmpOutput = activeEngine === "xmp" || activeEngine === "sid";
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
  const source = activeEngine === "xmp" ? xmpPlayer?.visualization : activeEngine === "sid" ? sidPlayer?.visualization : player?.visualization;
  const container = $("scopes");
  if (!scopesEnabled || !source) {
    stopScopeLoop();
    if (!container.children.length || container.querySelector("canvas")) container.replaceChildren(...Array.from({ length: 4 }, (_, index) => makeScopeCard(index, false)));
    $("scope-readout").textContent = "Output --";
    return;
  }
  const channels = readVisualizationChannels(source);
  if (container.children.length !== 4 || [...container.children].some((card, index) => Boolean(card.querySelector("canvas")) !== (index < channels.length))) {
    container.replaceChildren(...Array.from({ length: 4 }, (_, index) => makeScopeCard(index, index < channels.length)));
  }
  if (!channels.length) {
    $("scope-readout").textContent = "Output --";
    return;
  }
  const levels = [];
  for (const canvas of container.querySelectorAll("canvas")) {
    const channel = Number(canvas.dataset.channel);
    const data = channels[channel];
    const meter = meterLevel(data);
    levels.push(meter);
    drawScope(canvas, data, meter);
  }
  const outputMeter = combinedMeter(levels);
  $("scope-readout").textContent = `Output ${formatNumber(outputMeter.decibels, 0)} dBFS`;
}
function activeVisualizationSource() {
  return activeEngine === "xmp" ? xmpPlayer?.visualization : activeEngine === "sid" ? sidPlayer?.visualization : player?.visualization;
}
function updateImmersiveLabels() {
  const title = metadataState?.title || metadataState?.fileName || lastSelection?.filename || "No module loaded";
  $("immersive-title").textContent = title;
}
function sampledChannelLevel(data) {
  if (!data?.length) return 0;
  const stride = Math.max(1, Math.floor(data.length / 96));
  let squareSum = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += stride) {
    squareSum += data[index] * data[index];
    count++;
  }
  return Math.min(1, Math.sqrt(squareSum / count) * 3.4);
}
function renderMegaChannels(channels) {
  const target = $("mega-channels");
  if (target.children.length !== channels.length) {
    target.replaceChildren(...channels.map((_, index) => {
      const channel = document.createElement("div");
      channel.className = "mega-channel";
      const label = activeEngine === "xmp" || activeEngine === "sid" ? ["L", "R"][index] ?? "--" : `CH ${String(index + 1).padStart(2, "0")}`;
      channel.append(textElement("span", label), document.createElement("i"));
      return channel;
    }));
  }
  channels.forEach((data, index) => target.children[index].style.setProperty("--channel-level", sampledChannelLevel(data).toFixed(3)));
}
function renderMegaOrders(tracker, position) {
  const target = $("mega-orders");
  const currentOrder = position?.order ?? 0;
  const start = Math.max(0, Math.min(tracker.orders.length - 13, currentOrder - 6));
  const orders = tracker.orders.slice(start, start + 13);
  const key = `${start}:${currentOrder}:${orders.join(",")}`;
  if (target.dataset.key === key) return;
  target.replaceChildren(...orders.map((pattern, index) => {
    const order = start + index;
    const marker = textElement("span", String(pattern).padStart(2, "0"), order === currentOrder ? "is-current" : "");
    return marker;
  }));
  target.dataset.key = key;
}
function renderMegaTracker(frame, tracker) {
  const position = tracker.getPosition() ?? { order: 0, pattern: tracker.orders[0], row: 0 };
  const visibleChannelCapacity = innerWidth < 680 ? 3 : Math.max(5, Math.floor((innerWidth - 160) / 112));
  const visibleChannels = Math.min(tracker.channelCount, visibleChannelCapacity);
  const bankCount = Math.max(1, Math.ceil(tracker.channelCount / visibleChannels));
  const bank = Math.floor(frame.music.beatCount / 16) % bankCount;
  const channelStart = Math.min(bank * visibleChannels, tracker.channelCount - visibleChannels);
  const pattern = tracker.patterns[position.pattern];
  const patternKey = `${position.pattern}:${position.row}:${channelStart}:${visibleChannels}`;
  $("mega-source").textContent = `${tracker.format} PATTERN STREAM`;
  $("mega-position").textContent = `ORDER ${String(position.order).padStart(2, "0")}  /  PATTERN ${String(position.pattern).padStart(2, "0")}  /  ROW ${String(position.row).padStart(2, "0")}`;
  renderMegaOrders(tracker, position);
  if (!pattern || patternKey === lastMegaPatternKey) return;
  const heading = $("mega-pattern-heading");
  const grid = $("mega-pattern");
  heading.style.setProperty("--mega-columns", visibleChannels);
  grid.style.setProperty("--mega-columns", visibleChannels);
  heading.replaceChildren(textElement("span", "ROW"), ...Array.from({ length: visibleChannels }, (_, index) => textElement("span", `CHANNEL ${String(channelStart + index + 1).padStart(2, "0")}`)));
  const rows = [];
  for (let offset = -4; offset <= 4; offset++) {
    const rowIndex = position.row + offset;
    const row = document.createElement("div");
    row.className = `mega-pattern-row${offset === 0 ? " is-current" : ""}`;
    row.style.setProperty("--row-distance", Math.abs(offset));
    row.append(textElement("span", rowIndex >= 0 && rowIndex < pattern.rows.length ? String(rowIndex).padStart(2, "0") : "--", "mega-row-number"));
    for (let channel = channelStart; channel < channelStart + visibleChannels; channel++) {
      const event = pattern.rows[rowIndex]?.[channel];
      row.append(textElement("span", event ? trackerCell(event, tracker.format) : "--- .. .. ...", "mega-event"));
    }
    rows.push(row);
  }
  grid.replaceChildren(...rows);
  lastMegaPatternKey = patternKey;
}
function signalGlyphs(data, length = 34) {
  const glyphs = " .:-=+*#%@";
  if (!data?.length) return " ".repeat(length);
  return Array.from({ length }, (_, index) => {
    const sample = Math.abs(data[Math.min(data.length - 1, Math.floor(index / length * data.length))] || 0);
    return glyphs[Math.min(glyphs.length - 1, Math.floor(Math.sqrt(sample) * glyphs.length))];
  }).join("");
}
function renderMegaSignal(frame) {
  const channels = frame.channels;
  $("mega-source").textContent = activeEngine === "sid" ? "SID FINAL PCM SIGNAL MATRIX" : "UADE CHANNEL SIGNAL MATRIX";
  $("mega-position").textContent = `${channels.length} LIVE STREAMS  /  BEAT ${String(frame.music.beatCount).padStart(4, "0")}  /  ${frame.scene.toUpperCase()}`;
  $("mega-pattern-heading").replaceChildren(textElement("span", "LIVE AMPLITUDE TELEMETRY"));
  $("mega-pattern").replaceChildren(...channels.map((data, index) => {
    const row = document.createElement("div");
    row.className = "mega-signal-row";
    row.append(textElement("span", `CH ${String(index + 1).padStart(2, "0")}`), textElement("span", signalGlyphs(data), "mega-signal-glyphs"));
    return row;
  }));
  const orders = $("mega-orders");
  const beat = frame.music.beatCount % 16;
  orders.replaceChildren(...Array.from({ length: 16 }, (_, index) => textElement("span", String(index + 1).padStart(2, "0"), index === beat ? "is-current" : "")));
  lastMegaPatternKey = undefined;
}
function renderMegaFrame(frame) {
  if (immersiveMode !== "mega" || !$("immersive-dialog").open) return;
  const stage = $("immersive-stage");
  stage.style.setProperty("--mega-level", frame.signal.level.toFixed(3));
  stage.style.setProperty("--mega-low", frame.signal.low.toFixed(3));
  stage.style.setProperty("--mega-high", frame.signal.high.toFixed(3));
  stage.classList.toggle("mega-beat", frame.musicalEvent.beat);
  renderMegaChannels(frame.channels);
  const tracker = activeEngine === "xmp" ? xmpPlayer?.tracker : undefined;
  if (tracker?.available) renderMegaTracker(frame, tracker);
  else renderMegaSignal(frame);
}
function setImmersiveMode(mode) {
  immersiveMode = mode;
  lastMegaPatternKey = undefined;
  const mega = mode === "mega";
  $("immersive-stage").classList.toggle("mega-active", mega);
  $("mega-layer").setAttribute("aria-hidden", String(!mega));
  $("immersive-kicker").lastChild.textContent = mega ? " #AFWD Chamber / INIT MEGABOOST engaged" : " #AFWD Chamber / Visualizer activated";
  updateSidWriteTracing();
}
function updateControls(state = player?.state) {
  const xmpActive = activeEngine === "xmp";
  const sidActive = activeEngine === "sid";
  const currentState = xmpActive ? xmpPlayer?.state : sidActive ? sidPlayer?.state : state;
  const ready = !initializing && (xmpActive || sidActive || (player && !["initializing", "disposed"].includes(currentState)));
  $("play").disabled = !ready || !["ready", "paused", "stopped", "ended"].includes(currentState);
  $("pause").disabled = !ready || currentState !== "playing";
  $("stop").disabled = !ready || !["playing", "paused", "loading"].includes(currentState);
  $("open-tracker").disabled = !(sidActive || (xmpActive && xmpPlayer?.tracker?.available));
  $("open-visualizer").disabled = !ready || !scopesEnabled || !activeVisualizationSource();
  $("open-mega").disabled = !ready || !scopesEnabled || !activeVisualizationSource();
  $("songs").disabled = initializing || (!xmpActive && currentState === "disposed") || !songs.length;
  $("file").disabled = initializing || (!xmpActive && currentState === "disposed");
  updateImmersiveLabels();
}
async function loadBuffer(buffer, filename) {
  if (hasSidExtension(filename) || isSidFile(buffer)) {
    // A PSID/RSID signature is authoritative; malformed containers must not
    // fall through to UADE's extension-based Amiga SIDMon mapping. A SID
    // filename is likewise reserved for C64 SID playback in this demo.
    parseSidMetadata(buffer, { filename });
    await loadWithSid(buffer, filename);
    return;
  }
  if (activeEngine === "xmp") {
    await loadWithXmp(buffer, filename);
    return;
  }
  formatScoutState = scoutFile(buffer, { filename, uade: !hasSidExtension(filename) });
  if (prefersXmp(filename)) {
    await loadWithXmp(buffer, filename);
    return;
  }
  if (!player || player.state === "initializing" || player.state === "disposed") {
    if (activeEngine === "sid") {
      await initializePlayer();
      return;
    }
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
  const response = await fetch(selectionUrl(lastSelection));
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
    if (lastSelection && hasSidExtension(lastSelection.filename)) {
      await playLastSelection();
      $("initialize").textContent = "Reinitialize";
      restartSettings.clear();
      updateRestartButton();
      return;
    }
    const previousPlayer = player;
    player = undefined;
    activeEngine = "uade";
    await xmpPlayer?.dispose();
    xmpPlayer = undefined;
    await sidPlayer?.dispose();
    sidPlayer = undefined;
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
    player.setStreamPanning(Number($("pan").value));
    player.setSilenceTimeout(Number($("silence").value));
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
  const activePlayer = activeEngine === "xmp" ? xmpPlayer : activeEngine === "sid" ? sidPlayer : player;
  return Boolean(activePlayer && activePlayer.state !== "disposed");
}
async function loadLocalFile(file) {
  if (!file) return;
  selectFile({ type: "file", filename: file.name, buffer: await file.arrayBuffer() });
  if (!hasActivePlayer() || activeEngine === "xmp") await initializePlayer();
  else await playLastSelection();
}
function hasDraggedFiles(event) {
  return event.dataTransfer?.types.includes("Files");
}

$("initialize").addEventListener("click", initializePlayer);
$("play").addEventListener("click", async () => { try { const activePlayer = activeEngine === "xmp" ? xmpPlayer : activeEngine === "sid" ? sidPlayer : player; if (activePlayer?.state === "paused") return activePlayer.resume(); await playLastSelection(); } catch (error) { showStatus(error.message); } });
$("pause").addEventListener("click", () => (activeEngine === "xmp" ? xmpPlayer : activeEngine === "sid" ? sidPlayer : player)?.pause());
$("stop").addEventListener("click", () => (activeEngine === "xmp" ? xmpPlayer : activeEngine === "sid" ? sidPlayer : player)?.stop());
$("volume").addEventListener("input", (event) => { updateRangeReadout(event.target); (activeEngine === "xmp" ? xmpPlayer : activeEngine === "sid" ? sidPlayer : player)?.setVolume(Number(event.target.value)); });
$("rate").addEventListener("input", (event) => { updateRangeReadout(event.target); if (activeEngine !== "sid") (activeEngine === "xmp" ? xmpPlayer : player)?.setPitchCoupledRate(Number(event.target.value)); });
$("pan").addEventListener("input", (event) => { updateRangeReadout(event.target); (activeEngine === "xmp" ? xmpPlayer : activeEngine === "sid" ? sidPlayer : player)?.setStreamPanning(Number(event.target.value)); });
$("loop").addEventListener("change", (event) => (activeEngine === "xmp" ? xmpPlayer : activeEngine === "sid" ? sidPlayer : player)?.setLooping(event.target.checked));
$("tracker-sid-register-detail").addEventListener("change", (event) => {
  sidRegisterDetailEnabled = event.target.checked;
  if (!sidRegisterDetailEnabled) sidEnvelopeStates.clear();
  updateSidWriteTracing();
  if ($("tracker-dialog").open && activeEngine === "sid") renderSidTrackerView();
});
$("tracker-sid-phosphor").addEventListener("change", (event) => {
  sidPhosphorEnabled = event.target.checked;
  storeBoolean(SID_PHOSPHOR_STORAGE_KEY, sidPhosphorEnabled);
  if (sidPhosphorDecayTimer !== undefined) {
    clearTimeout(sidPhosphorDecayTimer);
    sidPhosphorDecayTimer = undefined;
  }
  for (const canvas of document.querySelectorAll(".sid-register-trace canvas")) {
    canvas._sidPhosphorPainted = false;
    canvas._sidPhosphorUntil = undefined;
    delete canvas._sidRenderKey;
  }
  if ($("tracker-dialog").open && activeEngine === "sid") renderSidTrackerView();
});
$("silence").addEventListener("change", (event) => (activeEngine === "xmp" ? xmpPlayer : activeEngine === "sid" ? sidPlayer : player)?.setSilenceTimeout(Number(event.target.value)));
$("zoom").addEventListener("input", (event) => { updateRangeReadout(event.target); (activeEngine === "xmp" ? xmpPlayer : activeEngine === "sid" ? sidPlayer : player)?.visualization?.setZoom(Number(event.target.value)); });
for (const control of [$("sid-c64-model"), $("sid-model"), $("sid-digi-boost")]) {
  control.addEventListener("change", () => {
    if (activeEngine !== "sid" || !sidPlayer) return;
    try {
      sidPlayer.setEmulationConfig(sidEmulationConfig());
      showStatus("SID emulation updated; restarted current subtune.");
    } catch (error) {
      showStatus(error.message);
    }
  });
}
$("scope-hz").addEventListener("change", startScopeLoop);
$("visualizer").addEventListener("change", (event) => {
  scopesEnabled = event.target.checked;
  if (!scopesEnabled) {
    clearStagedRestart("scopes");
    if ($("immersive-dialog").open) $("immersive-dialog").close();
    draw(performance.now());
    updateControls();
    return;
  }
  const visualization = activeEngine === "xmp" ? xmpPlayer?.visualization : activeEngine === "sid" ? sidPlayer?.visualization : player?.visualization;
  if (!visualization) {
    stageRestart("scopes");
    return;
  }
  clearStagedRestart("scopes");
  startScopeLoop();
  updateControls();
});
$("tracker-order-map").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-order]");
  if (!button) return;
  const order = Number(button.dataset.order);
  const playingOrder = xmpPlayer?.tracker.getPosition()?.order;
  setTrackerOrder(order, order === playingOrder);
});
$("tracker-sid-chip-control").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-sid-chip]");
  if (!button) return;
  selectedSidChip = Number(button.dataset.sidChip);
  sidEnvelopeStates.clear();
  renderSidTrackerView();
});
$("buffer").addEventListener("change", () => stageRestart("audio buffer"));
$("audio-rate").addEventListener("change", () => stageRestart("audio rate"));
$("track").addEventListener("input", (event) => selectSubsong(Number(event.target.value)));
$("tracker-track").addEventListener("input", (event) => selectSubsong(Number(event.target.value)));
$("tracker-track").addEventListener("change", (event) => {
  if (activeEngine === "sid") void restartWithSubsong(Number(event.target.value));
});
$("previous-track").addEventListener("click", () => restartWithSubsong(Number($("track").value) - 1));
$("next-track").addEventListener("click", () => restartWithSubsong(Number($("track").value) + 1));
$("tracker-previous-track").addEventListener("click", () => restartWithSubsong(Number($("track").value) - 1));
$("tracker-next-track").addEventListener("click", () => restartWithSubsong(Number($("track").value) + 1));
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
    await loadLocalFile(event.target.files[0]);
  } catch (error) {
    showStatus(error.message);
  }
});
document.addEventListener("dragover", (event) => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  document.body.classList.add("is-dragging-file");
});
document.addEventListener("dragleave", (event) => {
  if (event.relatedTarget) return;
  document.body.classList.remove("is-dragging-file");
});
document.addEventListener("drop", async (event) => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  document.body.classList.remove("is-dragging-file");
  try {
    await loadLocalFile(event.dataTransfer.files[0]);
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
  updateSidWriteTracing();
  stopScopeLoop();
  startTrackerAnimation();
});
function showImmersiveCursor() {
  clearTimeout(immersiveCursorTimer);
  $("immersive-stage").classList.add("cursor-visible");
  immersiveCursorTimer = window.setTimeout(() => {
    $("immersive-stage").classList.remove("cursor-visible");
    immersiveCursorTimer = undefined;
  }, 1800);
}
function openImmersive(mode, opener) {
  setImmersiveMode(mode);
  updateImmersiveLabels();
  openDialog("immersive-dialog", opener);
  updateSidWriteTracing();
  immersiveVisualizer.start();
  showImmersiveCursor();
  if (!document.fullscreenElement) void $("immersive-stage").requestFullscreen().catch(() => {});
}
$("open-visualizer").addEventListener("click", (event) => openImmersive("visualizer", event.currentTarget));
$("open-mega").addEventListener("click", (event) => openImmersive("mega", event.currentTarget));
$("immersive-stage").addEventListener("pointermove", showImmersiveCursor, { passive: true });
document.addEventListener("fullscreenchange", () => {
  const fullscreen = document.fullscreenElement === $("immersive-stage");
  if (fullscreen) immersiveOwnedFullscreen = true;
  else if (immersiveOwnedFullscreen) {
    immersiveOwnedFullscreen = false;
    if ($("immersive-dialog").open) closeDialog($("immersive-dialog"));
  }
});
$("settings-toggle").addEventListener("click", () => setSettingsPanel(!$("settings-panel").classList.contains("is-open")));
$("settings-close").addEventListener("click", () => setSettingsPanel(false));
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if ($("immersive-dialog").open) {
    event.preventDefault();
    closeDialog($("immersive-dialog"));
  } else if ($("settings-panel").classList.contains("is-open")) {
    setSettingsPanel(false);
  }
});
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("close", () => {
    if (dialog.id === "tracker-dialog") {
      stopTrackerAnimation();
      updateSidWriteTracing();
      lastSidScopeRevision = -1;
      startScopeLoop();
    }
    if (dialog.id === "immersive-dialog") {
      clearTimeout(immersiveCursorTimer);
      immersiveCursorTimer = undefined;
      $("immersive-stage").classList.remove("cursor-visible");
      immersiveVisualizer.stop();
      updateSidWriteTracing();
      if (document.fullscreenElement === $("immersive-stage")) void document.exitFullscreen();
    }
  });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) closeDialog(dialog); });
  dialog.querySelector(".dialog-close")?.addEventListener("click", () => closeDialog(dialog));
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
  stop: () => (activeEngine === "xmp" ? xmpPlayer : activeEngine === "sid" ? sidPlayer : player)?.stop(),
  dispose: () => (activeEngine === "xmp" ? xmpPlayer : activeEngine === "sid" ? sidPlayer : player)?.dispose()
});
window.addEventListener("beforeunload", () => { stopScopeLoop(); stopTrackerAnimation(); immersiveVisualizer.dispose(); clearInterval(diagnosticsTimer); player?.dispose(); xmpPlayer?.dispose(); sidPlayer?.dispose(); });