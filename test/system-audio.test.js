import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { SystemAudioCapture } from "../demo/system-audio.js";

function fixture({ channelCount = 2, audio = true, capture, sampleRate = 48000 } = {}) {
  const tracks = Array.from({ length: audio ? 2 : 1 }, () => Object.assign(new EventTarget(), {
    readyState: "live", stops: 0,
    stop() { this.stops++; this.readyState = "ended"; },
    getSettings: () => ({ channelCount })
  }));
  const stream = { getTracks: () => tracks, getAudioTracks: () => audio ? [tracks[1]] : [] };
  const nodes = [];
  let sample = .25;
  const node = () => {
    const value = { connections: [], disconnected: false,
      connect(...args) { this.connections.push(args); },
      disconnect() { this.disconnected = true; },
      getFloatTimeDomainData(buffer) { buffer.fill(sample); }
    };
    nodes.push(value);
    return value;
  };
  const context = { state: "running", destination: {}, sampleRate,
    resume: async () => {}, close: async () => { context.state = "closed"; },
    createMediaStreamSource: node, createChannelSplitter: node, createAnalyser: node,
    createBiquadFilter: () => Object.assign(node(), { frequency: { value: 0 }, Q: { value: 0 } })
  };
  let options;
  const adapter = new SystemAudioCapture({
    mediaDevices: { getDisplayMedia: async value => { options = value; return capture ? capture() : stream; } },
    createContext: () => context
  });
  return { adapter, context, nodes, tracks, stream, options: () => options, setSample: value => { sample = value; } };
}

test("demo stylesheet retains capture, strobe and SID presentation contracts", async () => {
  const css = await readFile(new URL("../demo/styles.css", import.meta.url), "utf8");
  for (const selector of [".capture-controls", ".immersive-actions", ".immersive-effect", ".mega-sid-voice", ".sid-filter-trace", ".sid-filter-value"]) {
    assert(css.includes(`${selector} {`), `Missing presentation rules for ${selector}`);
  }
  const strobe = css.match(/\.immersive-strobe-control\s*\{([^}]+)\}/)?.[1];
  assert(strobe, "Strobe control styling must remain present");
  assert.match(strobe, /opacity:\s*0\s*;/);
  assert.match(strobe, /pointer-events:\s*none\s*;/);
  assert(css.includes(".cursor-visible .immersive-strobe-control"));
  assert(css.includes(".immersive-strobe-control:has(input:focus-visible)"));
  assert(css.includes("#close-immersive-visualizer[hidden]"));
});

test("scope display refresh paints every callback and manual rates remain frame synchronized", async () => {
  const source = (await readFile(new URL("../demo/main.js", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const html = await readFile(new URL("../demo/index.html", import.meta.url), "utf8");
  assert.match(html, /value="auto" selected>Display/);
  for (const hz of [60, 120, 144, 240, 360]) {
    for (const setting of ["auto", "30", "90", "240"]) {
      let callback;
      let paints = 0;
      const controls = { "scope-hz": { value: setting }, "immersive-dialog": {}, "tracker-dialog": {} };
      const runtime = vm.createContext({
        scopeTimer: undefined, scopesEnabled: true, activeEngine: "uade", player: { visualization: {} },
        $: name => controls[name], performance: { now: () => 0 }, draw: () => paints++,
        window: { requestAnimationFrame: next => { callback = next; return 1; }, cancelAnimationFrame: () => { callback = undefined; } }
      });
      vm.runInContext(source.slice(source.indexOf("function stopScopeLoop()"), source.indexOf("function updateRestartButton()")), runtime);
      runtime.startScopeLoop();
      for (let frame = 0; frame < hz; frame++) callback(frame * 1000 / hz);
      assert.equal(paints, 1 + (setting === "auto" ? hz : Math.min(hz, Number(setting))), `${hz} Hz / ${setting}`);
      runtime.stopScopeLoop();
      assert.equal(callback, undefined);
      controls["immersive-dialog"].open = true;
      runtime.startScopeLoop();
      assert.equal(callback, undefined);
    }
  }
});

test("arrow shortcuts navigate only the open visualizer without taking over controls", async () => {
  const source = await readFile(new URL("../demo/main.js", import.meta.url), "utf8");
  const directions = [];
  let cursorShows = 0;
  const dialog = { open: true };
  const runtime = vm.createContext({
    $: () => dialog, immersiveVisualizer: { stepScene: direction => directions.push(direction) },
    showImmersiveCursor: () => cursorShows++
  });
  vm.runInContext(source.slice(source.indexOf("function handleImmersiveKeydown("), source.indexOf("function openImmersive(")), runtime);
  assert(source.includes('document.addEventListener("keydown", handleImmersiveKeydown)'));
  const send = (key, properties = {}) => {
    let prevented = false;
    runtime.handleImmersiveKeydown({ key, preventDefault: () => { prevented = true; }, ...properties });
    return prevented;
  };
  for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) assert.equal(send(key), true);
  assert.deepEqual(directions, [1, 1, -1, -1]);
  assert.equal(cursorShows, 4);
  assert.equal(send("ArrowRight", { target: { closest: selector => {
    assert(selector.includes("input:not([type='checkbox'])"));
    return null;
  } } }), true, "The auto-focused strobe checkbox must not block navigation");
  assert.equal(send("ArrowRight", { repeat: true }), true);
  for (const property of ["defaultPrevented", "altKey", "ctrlKey", "metaKey", "shiftKey"]) {
    assert.equal(send("ArrowRight", { [property]: true }), false);
  }
  assert.equal(send("ArrowRight", { target: { closest: () => ({}) } }), false);
  assert.equal(send("Escape"), false);
  dialog.open = false;
  assert.equal(send("ArrowRight"), false);
  assert.equal(directions.length, 5);
});

test("system audio refreshes stable stereo buffers and revision without audible routing", async () => {
  const setup = fixture();
  assert.equal(await setup.adapter.start(), true);
  assert.equal(setup.options().systemAudio, "include");
  assert.equal(setup.options().video.displaySurface, "monitor");
  const source = setup.adapter.readSource();
  const channels = source.readChannels();
  assert.equal(source.streamCount, 2);
  assert.notEqual(channels[0], channels[1]);
  assert.equal(channels[0][0], .25);
  assert.equal(source.revision, 1);
  setup.setSample(0);
  assert.equal(setup.adapter.readSource(), source);
  assert.equal(source.readChannels(), channels);
  assert.equal(channels[0][0], 0);
  assert.equal(source.revision, 2);
  assert(setup.nodes.every(node => node.connections.every(([target]) => target !== setup.context.destination)));
  setup.adapter.stop();
  assert.equal(setup.context.state, "closed");
  assert(setup.nodes.every(node => node.disconnected));
  assert(setup.tracks.every(track => track.stops === 1));
  assert.equal(setup.adapter.readSource(), undefined);
  setup.adapter.stop();
  assert(setup.tracks.every(track => track.stops === 1));
});

test("capture history covers frame intervals and reuses bounded storage across refresh rates", async () => {
  for (const sampleRate of [44100, 48000, 96000, 192000]) {
    const setup = fixture({ sampleRate });
    await setup.adapter.start();
    const source = setup.adapter.readSource(0);
    const channels = source.readChannels();
    const storage = channels.map(channel => channel.buffer);
    let time = 0;
    for (const hz of [30, 60, 120, 144, 240, 360]) {
      for (let frame = 0; frame < 65; frame++) {
        time += 1000 / hz;
        assert.equal(setup.adapter.readSource(time), source);
        assert(source.sampleLength >= sampleRate / hz + 128);
        assert.equal(source.readChannels(), channels);
        assert.equal(source.sampleRate, sampleRate);
        channels.forEach((channel, index) => {
          assert.equal(channel.buffer, storage[index]);
          assert.equal(channel.length, source.sampleLength);
          assert.equal(setup.adapter.session.analysers[index].fftSize, channel.length);
        });
      }
    }
    setup.adapter.readSource(time + 5000);
    assert.equal(source.sampleLength, 32768, "Suspended tabs must not allocate unbounded history");
    for (let frame = 1; frame <= 60; frame++) setup.adapter.readSource(time + 5000 + frame * 1000 / 120);
    assert.equal(source.sampleLength, 2 ** Math.ceil(Math.log2(sampleRate * .02)));
    setup.adapter.stop();
  }
});

test("system audio exposes separate 35-110 Hz bass analysis without changing channel samples", async () => {
  const setup = fixture();
  await setup.adapter.start();
  const filters = setup.nodes.filter(node => node.frequency);
  assert.deepEqual(filters.map(filter => [filter.type, filter.frequency.value]), [
    ["highpass", 35], ["lowpass", 110], ["lowpass", 110],
    ["highpass", 35], ["lowpass", 110], ["lowpass", 110]
  ]);
  assert(filters.every(filter => filter.Q.value === Math.SQRT1_2));
  assert.equal(setup.adapter.session.bassSamples.length, 1024);
  assert(setup.adapter.session.bassAnalysers.every(analyser => analyser.fftSize === 1024));
  setup.setSample(.02);
  const source = setup.adapter.readSource();
  assert(Math.abs(source.readBassEnergy() - .08) < 1e-6);
  assert(Math.abs(source.readChannel(0)[0] - .02) < 1e-6);
  setup.setSample(0);
  setup.adapter.readSource();
  assert.equal(source.readBassEnergy(), 0);
  for (const analyser of setup.adapter.session.bassAnalysers) {
    analyser.getFloatTimeDomainData = buffer => {
      buffer.fill(0);
      buffer.fill(.05, buffer.length * .75);
    };
  }
  setup.adapter.readSource();
  assert(Math.abs(source.readBassEnergy() - .2) < 1e-6, "A fresh bass attack must not be diluted by preceding silence");
  setup.adapter.stop();
  assert(setup.nodes.every(node => node.disconnected));
});

test("bass and full-band onset measurements retain headroom above one", async () => {
  const setup = fixture();
  await setup.adapter.start();
  assert(setup.adapter.session.referenceAnalysers.every(analyser => analyser.fftSize === 1024));
  setup.setSample(.5);
  for (const analyser of setup.adapter.session.bassAnalysers) {
    analyser.getFloatTimeDomainData = buffer => buffer.fill(.1);
  }
  const source = setup.adapter.readSource();
  assert(Math.abs(source.readBassRatio() - .2) < 1e-6, "Loud non-bass audio must not saturate the reference level");
  for (const analyser of setup.adapter.session.bassAnalysers) {
    analyser.getFloatTimeDomainData = buffer => buffer.fill(.4);
  }
  setup.adapter.readSource();
  assert(Math.abs(source.readBassEnergy() - 1.6) < 1e-6);
  assert.equal(source.readFullBandEnergy(), 2);
  assert(Math.abs(source.readBassRatio() - .8) < 1e-6);
  setup.setSample(0);
  setup.adapter.readSource();
  assert.equal(source.readBassRatio(), 0);
  setup.adapter.stop();
  assert(setup.nodes.every(node => node.disconnected));
});

test("mono capture stays mono and ending screen sharing releases audio", async () => {
  const setup = fixture({ channelCount: 1 });
  await setup.adapter.start();
  assert.equal(setup.adapter.readSource().streamCount, 1);
  setup.tracks[0].dispatchEvent(new Event("ended"));
  assert.equal(setup.adapter.state, "idle");
  assert(setup.tracks.every(track => track.stops === 1));
});

test("missing audio and denied permission produce recoverable errors", async () => {
  const silent = fixture({ audio: false });
  assert.equal(await silent.adapter.start(), false);
  assert.match(silent.adapter.error, /No audio/);
  assert(silent.tracks.every(track => track.stops === 1));
  const denied = fixture({ capture: () => { throw new DOMException("Denied", "NotAllowedError"); } });
  assert.equal(await denied.adapter.start(), false);
  assert.match(denied.adapter.error, /cancelled or denied/);
  assert.equal(denied.context.state, "closed");
  assert.equal(denied.adapter.session, undefined);
});

test("cancelling pending permission releases a late stream and prevents activation", async () => {
  let resolve;
  const setup = fixture({ capture: () => new Promise(done => { resolve = done; }) });
  const pending = setup.adapter.start();
  assert.equal(setup.adapter.state, "requesting");
  assert.equal(await setup.adapter.start(), false);
  setup.adapter.stop();
  resolve(setup.stream);
  assert.equal(await pending, false);
  assert.equal(setup.adapter.state, "idle");
  assert(setup.tracks.every(track => track.stops === 1));
});

test("unsupported capture reports an error without opening a context", async () => {
  const adapter = new SystemAudioCapture({ mediaDevices: {} });
  assert.equal(adapter.supported, false);
  assert.equal(await adapter.start(), false);
  assert.match(adapter.error, /Chrome or Edge/);
});

test("new capture survives a cancelled session returning late", async () => {
  let resolve;
  const first = fixture({ capture: () => new Promise(done => { resolve = done; }) });
  const pending = first.adapter.start();
  first.adapter.stop();
  const second = fixture();
  first.adapter.mediaDevices = { getDisplayMedia: async () => second.stream };
  first.adapter.createContext = () => second.context;
  assert.equal(await first.adapter.start(), true);
  resolve(first.stream);
  assert.equal(await pending, false);
  assert.equal(first.adapter.state, "active");
  assert.equal(second.context.state, "running");
  assert(first.tracks.every(track => track.stops === 1));
  first.adapter.stop();
  assert(second.tracks.every(track => track.stops === 1));
});

test("context resume failure releases all tracks and allows a retry", async () => {
  const setup = fixture();
  setup.context.resume = async () => { throw new Error("Audio activation failed"); };
  assert.equal(await setup.adapter.start(), false);
  assert.match(setup.adapter.error, /Audio activation failed/);
  assert(setup.tracks.every(track => track.stops === 1));
  assert.equal(setup.context.state, "closed");
  const retry = fixture();
  setup.adapter.mediaDevices = { getDisplayMedia: async () => retry.stream };
  setup.adapter.createContext = () => retry.context;
  assert.equal(await setup.adapter.start(), true);
  setup.adapter.stop();
});

test("closing and reopening the visualizer reuses live capture until explicitly stopped", async () => {
  const source = (await readFile(new URL("../demo/main.js", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const setup = fixture();
  await setup.adapter.start();
  const audioSource = setup.adapter.readSource();
  setup.adapter.mediaDevices.getDisplayMedia = () => assert.fail("Reopening must not request another share");
  let starts = 0;
  let stops = 0;
  let strobeEnabled = true;
  let onClose;
  let onCloseClick;
  const dialog = { id: "immersive-dialog", addEventListener: (_, handler) => { onClose = handler; } };
  const closeButton = { addEventListener: (_, handler) => { onCloseClick = handler; } };
  const stage = { classList: { remove() {} } };
  const runtime = vm.createContext({
    dialog, visualizationInput: "system", systemAudio: setup.adapter,
    immersiveStrobePreference: true,
    immersiveCursorTimer: undefined, clearTimeout,
    $: name => name === "close-immersive-visualizer" ? closeButton : name === "immersive-dialog" ? dialog : stage,
    document: { fullscreenElement: {} }, closeDialog: () => onClose(),
    setImmersiveMode() {}, updateImmersiveLabels() {}, openDialog() {},
    setImmersiveStrobe: enabled => { strobeEnabled = enabled; },
    stopScopeLoop() {}, startScopeLoop() {}, updateSidWriteTracing() {}, showImmersiveCursor() {},
    immersiveVisualizer: { start: () => starts++, stop: () => stops++ }
  });
  vm.runInContext(source.slice(source.indexOf('dialog.addEventListener("close",'), source.indexOf('\n  dialog.addEventListener("click",')), runtime);
  vm.runInContext(source.slice(source.indexOf("function openImmersive("), source.indexOf('$("open-visualizer").addEventListener')), runtime);
  vm.runInContext(source.split("\n").find(line => line.startsWith('$("close-immersive-visualizer").addEventListener')), runtime);
  runtime.openImmersive("visualizer", {});
  onCloseClick();
  assert.equal(stops, 1);
  assert.equal(strobeEnabled, false);
  assert.equal(setup.adapter.state, "active");
  assert(setup.tracks.every(track => track.readyState === "live" && track.stops === 0));
  runtime.openImmersive("visualizer", {});
  assert.equal(starts, 2);
  assert.equal(strobeEnabled, true);
  assert.equal(setup.adapter.readSource(), audioSource);
  onClose();
  setup.adapter.stop();
  assert(setup.tracks.every(track => track.readyState === "ended" && track.stops === 1));
});

test("strobe controls persist explicit choices independently of reduced motion without confirmation", async () => {
  const source = (await readFile(new URL("../demo/main.js", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const css = await readFile(new URL("../demo/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(source, /matchMedia|immersiveMotionPreference|reducedMotion/);
  assert.doesNotMatch(css, /prefers-reduced-motion/);
  let onToggle;
  let onClick;
  let active = false;
  const checkbox = { checked: false, disabled: false, addEventListener: (name, callback) => {
    if (name === "change") onToggle = callback;
    if (name === "click") onClick = callback;
  } };
  const control = { title: "" };
  const stage = { classList: { toggle: (_, value) => { active = value; } } };
  const visualizer = {
    reducedMotion: false,
    setStrobeEnabled: enabled => Boolean(enabled)
  };
  const stored = new Map();
  const storageKey = "module-player.immersive-strobe";
  let storageBlocked = false;
  const globals = {
    $: name => name === "immersive-strobe" ? checkbox : name === "immersive-strobe-control" ? control : stage,
    immersiveVisualizer: visualizer,
    window: { confirm: () => assert.fail("Strobe must not request confirmation") },
    localStorage: {
      getItem: key => { if (storageBlocked) throw new Error("Storage blocked"); return stored.get(key) ?? null; },
      setItem: (key, value) => { if (storageBlocked) throw new Error("Storage blocked"); stored.set(key, value); }
    }
  };
  const loadControls = () => {
    const runtime = vm.createContext({ ...globals });
    vm.runInContext(source.slice(source.indexOf("function readStoredBoolean("), source.indexOf("function readStoredNumber(")), runtime);
    vm.runInContext(source.slice(source.indexOf("const STROBE_STORAGE_KEY"), source.indexOf("function showImmersiveCursor(")), runtime);
    return runtime;
  };
  const runtime = loadControls();
  assert.equal(checkbox.disabled, false);
  assert.equal(checkbox.checked, false);
  checkbox.checked = true;
  onToggle();
  assert.equal(checkbox.checked, true);
  assert.equal(active, true);
  assert.equal(stored.get(storageKey), "true");
  runtime.setImmersiveStrobe(false);
  assert.equal(stored.get(storageKey), "true");
  loadControls();
  assert.equal(checkbox.checked, true);
  checkbox.checked = false;
  onToggle();
  assert.equal(active, false);
  assert.equal(stored.get(storageKey), "false");
  loadControls();
  assert.equal(checkbox.checked, false);
  checkbox.checked = true;
  onToggle();
  assert.equal(active, true);
  assert.equal(checkbox.checked, true);
  assert.equal(checkbox.disabled, false);
  assert.equal(visualizer.reducedMotion, false);
  assert.match(control.title, /Flashing lights may trigger seizures/);
  assert.equal(stored.get(storageKey), "true");
  loadControls();
  assert.equal(active, true);
  checkbox.checked = false;
  onToggle();
  loadControls();
  assert.equal(active, false);
  assert.equal(checkbox.disabled, false);
  checkbox.checked = true;
  onToggle();
  assert.equal(active, true);
  assert.equal(visualizer.reducedMotion, false);
  assert.equal(checkbox.disabled, false);
  assert.equal(checkbox.checked, true);
  assert.equal(visualizer.reducedMotion, false);
  loadControls();
  assert.equal(checkbox.checked, true);
  let blurs = 0;
  onClick({ detail: 0, currentTarget: { blur: () => blurs++ } });
  assert.equal(blurs, 0);
  onClick({ detail: 1, currentTarget: { blur: () => blurs++ } });
  assert.equal(blurs, 1);
  storageBlocked = true;
  const blockedRuntime = loadControls();
  assert.equal(checkbox.checked, false);
  assert.equal(checkbox.disabled, false);
  assert.equal(visualizer.reducedMotion, false);
  checkbox.checked = true;
  onToggle();
  assert.equal(active, true);
  assert.equal(vm.runInContext("immersiveStrobePreference", blockedRuntime), true);
});

test("effect label follows scene changes in system audio and general module views", async () => {
  const source = (await readFile(new URL("../demo/main.js", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const label = { textContent: "" };
  const runtime = vm.createContext({
    visualizationInput: "system", immersiveMode: "visualizer",
    $: name => { assert.equal(name, "immersive-effect"); return label; }
  });
  vm.runInContext(source.slice(source.indexOf("function renderMegaFrame("), source.indexOf("function setImmersiveMode(")), runtime);
  runtime.renderMegaFrame({ scene: "terrain" });
  assert.equal(label.textContent, "TERRAIN");
  runtime.renderMegaFrame({ scene: "wavegarden" });
  assert.equal(label.textContent, "WAVEGARDEN");
  runtime.visualizationInput = "module";
  runtime.renderMegaFrame({ scene: "sid-crystal" });
  assert.equal(label.textContent, "CRYSTAL");
});

test("demo enables system visualization without a module or scopes and returns without autoplay", async () => {
  const source = (await readFile(new URL("../demo/main.js", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const elements = new Map();
  const element = name => {
    if (!elements.has(name)) elements.set(name, { open: false });
    return elements.get(name);
  };
  const runtime = vm.createContext({
    $: element, visualizationInput: "system", activeEngine: "uade", player: undefined,
    xmpPlayer: undefined, sidPlayer: undefined, initializing: false, scopesEnabled: false,
    songs: [], metadataState: undefined, lastSelection: undefined,
    systemAudio: { state: "idle", supported: true, error: "" },
    closeDialog: dialog => { dialog.open = false; }
  });
  for (const name of ["activeVisualizationSource", "updateSystemAudio", "useModuleAudio", "updateImmersiveLabels", "updateControls"]) {
    const start = source.indexOf(`function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), runtime);
  }
  runtime.updateControls();
  assert.equal(element("open-visualizer").disabled, true);
  assert.equal(element("capture-audio").disabled, false);
  runtime.systemAudio.state = "requesting";
  runtime.updateControls();
  assert.equal(element("capture-audio").textContent, "Cancel capture");
  const audioSource = {};
  runtime.systemAudio.state = "active";
  runtime.systemAudio.session = { source: audioSource };
  runtime.updateControls();
  assert.equal(runtime.activeVisualizationSource(), audioSource);
  assert.equal(element("open-visualizer").disabled, false);
  assert.equal(element("open-mega").disabled, true);
  assert.equal(element("immersive-title").textContent, "System Audio");
  assert.equal(element("immersive-title").hidden, true);
  let pauses = 0;
  runtime.player = { state: "playing", pause() { pauses++; this.state = "paused"; } };
  runtime.updateSystemAudio();
  assert.equal(pauses, 1);
  element("immersive-dialog").open = true;
  runtime.systemAudio.state = "idle";
  runtime.updateSystemAudio();
  assert.equal(element("immersive-dialog").open, false);
  runtime.systemAudio.stop = () => { runtime.systemAudio.state = "idle"; runtime.updateSystemAudio(); };
  runtime.metadataState = { title: "Module title" };
  runtime.useModuleAudio();
  assert.equal(runtime.visualizationInput, "module");
  assert.equal(element("visualizer-source").value, "module");
  assert.equal(element("capture-audio").hidden, true);
  assert.equal(element("immersive-title").hidden, false);
  assert.equal(element("immersive-title").textContent, "Module title");
  assert.equal(runtime.player.state, "paused");
});