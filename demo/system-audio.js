export class SystemAudioCapture {
  constructor({ mediaDevices = globalThis.navigator?.mediaDevices, createContext = () => new AudioContext(), onChange = () => {} } = {}) {
    this.mediaDevices = mediaDevices;
    this.createContext = createContext;
    this.onChange = onChange;
    this.state = "idle";
    this.error = "";
    this.session = undefined;
  }

  get supported() {
    return typeof this.mediaDevices?.getDisplayMedia === "function";
  }

  notify(state, error = "") {
    this.state = state;
    this.error = error;
    this.onChange(this);
  }

  release(session) {
    if (!session) return;
    const stream = session.stream;
    session.stream = undefined;
    for (const track of stream?.getTracks() ?? []) {
      track.removeEventListener("ended", session.onEnded);
      track.stop();
    }
    for (const node of session.nodes) node.disconnect();
    session.nodes.length = 0;
    const context = session.context;
    session.context = undefined;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }

  stop() {
    const session = this.session;
    this.session = undefined;
    this.release(session);
    this.notify("idle");
  }

  async start() {
    if (this.session) return false;
    if (!this.supported) {
      this.notify("error", "System audio capture is unavailable. Use Chrome or Edge on Windows over HTTPS or localhost.");
      return false;
    }
    const session = { nodes: [], onEnded: () => this.stop() };
    this.session = session;
    this.notify("requesting");
    try {
      session.context = this.createContext();
      const resumed = session.context.resume().then(() => undefined, error => error);
      const stream = await this.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor", frameRate: 1 },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
        systemAudio: "include",
        selfBrowserSurface: "exclude"
      });
      session.stream = stream;
      if (this.session !== session) {
        this.release(session);
        return false;
      }
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack || audioTrack.readyState !== "live") {
        throw new Error("No audio was shared. Select Entire Screen and enable Share system audio.");
      }
      for (const track of stream.getTracks()) track.addEventListener("ended", session.onEnded);
      const resumeError = await resumed;
      if (this.session !== session) return false;
      if (resumeError) throw resumeError;
      const streamCount = audioTrack.getSettings().channelCount === 1 ? 1 : 2;
      const input = session.context.createMediaStreamSource(stream);
      session.nodes.push(input);
      const splitter = session.context.createChannelSplitter(streamCount);
      session.nodes.push(splitter);
      input.connect(splitter);
      session.analysers = Array.from({ length: streamCount }, (_, index) => {
        const analyser = session.context.createAnalyser();
        session.nodes.push(analyser);
        analyser.fftSize = 256;
        splitter.connect(analyser, index);
        return analyser;
      });
      const channels = session.analysers.map(() => new Float32Array(256));
      session.source = {
        streamCount, sampleLength: 256, revision: 0,
        readChannel: index => channels[index],
        readChannels: () => channels
      };
      this.notify("active");
      return true;
    } catch (error) {
      this.release(session);
      if (this.session !== session) return false;
      this.session = undefined;
      const message = error.name === "NotAllowedError"
        ? "Audio sharing was cancelled or denied."
        : error.message || "System audio capture failed.";
      this.notify("error", message);
      return false;
    }
  }

  readSource() {
    if (this.state !== "active") return undefined;
    const { source, analysers } = this.session;
    analysers.forEach((analyser, index) => analyser.getFloatTimeDomainData(source.readChannel(index)));
    source.revision++;
    return source;
  }
}