export function createPlaybackAudioContext(sampleRate) {
  if (sampleRate !== undefined && (!Number.isInteger(sampleRate) || sampleRate <= 0)) {
    throw new RangeError("AudioContext sample rate must be a positive integer.");
  }
  const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextConstructor) throw new Error("Web Audio is unavailable in this browser.");
  try {
    if (globalThis.navigator?.audioSession) globalThis.navigator.audioSession.type = "playback";
  } catch {}
  const context = new AudioContextConstructor(sampleRate === undefined ? undefined : { sampleRate });
  if (sampleRate !== undefined && context.sampleRate !== sampleRate) {
    context.close().catch(() => {});
    throw new Error(`The browser selected ${context.sampleRate} Hz instead of the requested ${sampleRate} Hz AudioContext.`);
  }
  let needsActivation = true;
  const events = ["touchend", "click", "keydown"];
  const activate = () => {
    if (context.state === "closed" || !needsActivation) return;
    context.resume().catch(() => {});
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, context.sampleRate);
    source.connect(context.destination);
    source.onended = () => source.disconnect();
    source.start(0);
  };
  const stateChanged = () => {
    if (context.state === "running") needsActivation = false;
    if (context.state === "interrupted") needsActivation = true;
    if (context.state === "closed") {
      for (const event of events) document.removeEventListener(event, activate, true);
      context.removeEventListener("statechange", stateChanged);
    }
  };
  for (const event of events) document.addEventListener(event, activate, { capture: true, passive: true });
  context.addEventListener("statechange", stateChanged);
  activate();
  stateChanged();
  return context;
}