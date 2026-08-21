export type UadePlayerState = "initializing" | "ready" | "loading" | "playing" | "paused" | "stopped" | "ended" | "error" | "disposed";

export interface UadePlayerOptions {
  assetBaseUrl: string;
  visualization?: boolean;
  processorBufferSize?: number;
  audioContextSampleRate?: number;
}

export interface UadeLoadOptions {
  filename?: string;
  track?: number;
  timeoutSeconds?: number;
  loop?: boolean;
}

export interface UadeInstrument {
  index: number;
  name?: string;
  size: number;
  volume: number;
  fineTune: number;
  loopStart: number;
  loopSize: number;
}

export interface ParsedUadeSongInfo {
  title?: string;
  fileName?: string;
  fileLengthBytes?: number;
  filePrefix?: string;
  maxPositions?: number;
  format?: string;
  player?: string;
  summary: string[];
  subsong?: { minimum?: number; maximum?: number; current?: number };
  instruments: UadeInstrument[];
  unparsedLines: string[];
}

export interface UadeVisualizationSource {
  readonly streamCount: number;
  readonly sampleLength: number;
  getZoom(): number;
  setZoom(level: 1 | 2 | 3 | 4 | 5): void;
  readChannel(channel: number): Float32Array;
  readVu(channel: number): number;
  readOverallVu(): number;
}

export class UadePlaybackError extends Error {
  operation: string;
  filename?: string;
  cause: unknown;
}

export class UadePlayer {
  readonly state: UadePlayerState;
  readonly visualization?: UadeVisualizationSource;
  getDiagnostics(): {
    audioContextSampleRate?: number;
    requestedAudioContextSampleRate?: number;
    audioContextState?: string;
    processorBufferSize?: number;
    visualizationEnabled: boolean;
    visualizationStreams: number;
    transformerOutputSampleRate?: number;
    transformerInputSampleRate?: number;
    audioCallbackBudgetMs?: number;
    audioCallbackCount: number;
    audioGenerationAverageMs: number;
    audioGenerationMaxMs: number;
    audioCallbackIntervalAverageMs: number;
    audioCallbackIntervalMaxMs: number;
    lateAudioCallbackCount: number;
    wasmComputeCallCount: number;
    wasmComputeAverageMs: number;
    wasmComputeMaxMs: number;
    wasmSourceFrames: number;
    wasmSourceFramesPerAudioSecond: number;
    wasmSourceRateToConfiguredRatio: number;
    wallElapsedSeconds: number;
    audioElapsedSeconds: number;
    audioClockToWallClockRatio: number;
    outputTimestampContextTime?: number;
    outputTimestampPerformanceTime?: number;
  };
  on(event: "state" | "metadata" | "format-scout" | "ended" | "error", listener: (payload?: unknown) => void): () => void;
  load(input: File | ArrayBuffer, options?: UadeLoadOptions): Promise<Record<string, unknown>>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  setVolume(level: number): void;
  getVolume(): number;
  setLooping(enabled: boolean): void;
  setPitchCoupledRate(rate: number): void;
  setTimeout(seconds: number | null): void;
  setSilenceTimeout(seconds: number): void;
  setPanning(pan: number | null): void;
  setStreamPanning(panning: number): void;
  dispose(): Promise<void>;
}

export function createUadePlayer(options: UadePlayerOptions): Promise<UadePlayer>;
export function parseUadeSongInfo(songInfo?: Record<string, unknown>): ParsedUadeSongInfo;
