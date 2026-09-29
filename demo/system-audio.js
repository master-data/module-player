export class SystemAudioCapture {
  constructor({ mediaDevices = globalThis.navigator?.mediaDevices, createContext = () => new AudioContext(), onChange = () => {},
    platform = globalThis.navigator?.userAgentData?.platform ?? globalThis.navigator?.platform ?? "" } = {}) {
    this.mediaDevices = mediaDevices;
    this.createContext = createContext;
    this.onChange = onChange;
    this.isMac = /mac/i.test(platform);
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
      this.notify("error", "Audio sharing is unavailable. Try current Chrome or Edge over HTTPS or localhost; audio support depends on the browser and selected source.");
      return false;
    }
    const session = { nodes: [], onEnded: () => this.stop() };
    this.session = session;
    this.notify("requesting");
    try {
      session.context = this.createContext();
      const resumed = session.context.resume().then(() => undefined, error => error);
      const stream = await this.mediaDevices.getDisplayMedia({
        video: { displaySurface: this.isMac ? "window" : "monitor", frameRate: 1 },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
        systemAudio: "include",
        ...(this.isMac ? { windowAudio: "system" } : {}),
        selfBrowserSurface: "exclude"
      });
      session.stream = stream;
      if (this.session !== session) {
        this.release(session);
        return false;
      }
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack || audioTrack.readyState !== "live") {
        throw new Error(this.isMac
          ? "No audio was shared. Select Window, choose Module Player, and enable system audio if offered. If unavailable, try a music-playing browser tab with Share tab audio. Audio options depend on your macOS and browser version."
          : "No audio was shared. Enable audio sharing for the selected screen or browser tab; not every source supports audio.");
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
      const sampleRate = session.context.sampleRate || 48000;
      const sampleLength = Math.min(32768, 2 ** Math.ceil(Math.log2(sampleRate * .02)));
      session.analysers = Array.from({ length: streamCount }, (_, index) => {
        const analyser = session.context.createAnalyser();
        session.nodes.push(analyser);
        analyser.fftSize = sampleLength;
        splitter.connect(analyser, index);
        return analyser;
      });
      session.waveformBuffers = session.analysers.map(() => new Float32Array(32768));
      const channels = session.waveformBuffers.map(buffer => buffer.subarray(0, sampleLength));
      session.shorterReads = 0;
      const bassSampleLength = Math.min(32768, 2 ** Math.ceil(Math.log2((session.context.sampleRate || 48000) * .02)));
      session.referenceAnalysers = Array.from({ length: streamCount }, (_, index) => {
        const analyser = session.context.createAnalyser();
        analyser.fftSize = bassSampleLength;
        session.nodes.push(analyser);
        splitter.connect(analyser, index);
        return analyser;
      });
      session.bassAnalysers = Array.from({ length: streamCount }, (_, index) => {
        let previous;
        for (const [type, frequency] of [["highpass", 35], ["lowpass", 110], ["lowpass", 110]]) {
          const filter = session.context.createBiquadFilter();
          filter.type = type;
          filter.frequency.value = frequency;
          filter.Q.value = Math.SQRT1_2;
          session.nodes.push(filter);
          if (previous) previous.connect(filter);
          else splitter.connect(filter, index);
          previous = filter;
        }
        const analyser = session.context.createAnalyser();
        analyser.fftSize = bassSampleLength;
        session.nodes.push(analyser);
        previous.connect(analyser);
        return analyser;
      });
      session.bassSamples = new Float32Array(bassSampleLength);
      session.bassEnergy = 0;
      session.fullBandEnergy = 0;
      session.bassRatio = 0;
      session.source = {
        streamCount, sampleLength, sampleRate, revision: 0,
        readChannel: index => channels[index],
        readChannels: () => channels,
        readBassEnergy: () => session.bassEnergy,
        readFullBandEnergy: () => session.fullBandEnergy,
        readBassRatio: () => session.bassRatio
      };
      this.notify("active");
      return true;
    } catch (error) {
      this.release(session);
      if (this.session !== session) return false;
      this.session = undefined;
      const message = ["NotAllowedError", "NotReadableError", "AbortError"].includes(error.name)
        ? this.isMac
          ? "Audio sharing could not start. The picker may have been dismissed, or capture may be blocked. Check System Settings > Privacy & Security > Screen & System Audio Recording (Screen Recording on older macOS) for your browser, then quit and reopen the browser if macOS requests it. Select Window and enable system audio if offered, or try a music-playing browser tab with Share tab audio."
          : "Audio sharing could not start. The picker may have been dismissed, permission denied, or capture blocked by the browser or operating system. Check capture permissions and try again."
        : error.message || "System audio capture failed.";
      this.notify("error", message);
      return false;
    }
  }

  readSource(time = performance.now()) {
    if (this.state !== "active") return undefined;
    const session = this.session;
    const { source, analysers } = session;
    const interval = Number.isFinite(time) && Number.isFinite(session.lastReadAt) && time >= session.lastReadAt
      ? (time - session.lastReadAt) / 1000 : 1 / 60;
    session.lastReadAt = time;
    const requiredSamples = Math.max(source.sampleRate * .02, source.sampleRate * interval + 128);
    const sampleLength = Math.min(32768, 2 ** Math.ceil(Math.log2(requiredSamples)));
    session.shorterReads = sampleLength < source.sampleLength ? session.shorterReads + 1 : 0;
    if (sampleLength > source.sampleLength || session.shorterReads >= 60) {
      const channels = source.readChannels();
      analysers.forEach((analyser, index) => {
        analyser.fftSize = sampleLength;
        channels[index] = session.waveformBuffers[index].subarray(0, sampleLength);
      });
      source.sampleLength = sampleLength;
      session.shorterReads = 0;
    }
    analysers.forEach((analyser, index) => analyser.getFloatTimeDomainData(source.readChannel(index)));
    const { bassAnalysers, referenceAnalysers, bassSamples } = this.session;
    const readEnergy = analyser => {
      analyser.getFloatTimeDomainData(bassSamples);
      const blockLength = bassSamples.length / 4;
      let energy = 0;
      for (let offset = 0; offset < bassSamples.length; offset += blockLength) {
        let squareSum = 0;
        for (let index = offset; index < offset + blockLength; index++) squareSum += bassSamples[index] ** 2;
        energy = Math.max(energy, Math.sqrt(squareSum / blockLength) * 4);
      }
      return energy;
    };
    const bassEnergy = Math.max(...bassAnalysers.map(readEnergy));
    const fullBandEnergy = Math.max(...referenceAnalysers.map(readEnergy));
    this.session.bassEnergy = bassEnergy;
    this.session.fullBandEnergy = fullBandEnergy;
    this.session.bassRatio = fullBandEnergy > 1e-6 ? Math.min(1, bassEnergy / fullBandEnergy) : 0;
    source.revision++;
    return source;
  }
}