export type XmpPlayerState = "initializing" | "ready" | "loading" | "playing" | "paused" | "stopped" | "ended" | "error" | "disposed";

export interface XmpPlayerOptions {
  assetBaseUrl?: string;
  audioContextSampleRate?: number;
  processorBufferSize?: number;
}
export interface XmpLoadOptions { filename?: string; track?: number; timeoutSeconds?: number; loop?: boolean; }

export interface XmpVisualizationSource {
  readonly streamCount: number;
  readonly sampleLength: number;
  getZoom(): number;
  setZoom(level: number): void;
  readChannel(channel: number): Float32Array;
  readVu(channel: number): number;
  readOverallVu(): number;
}

export class XmpPlaybackError extends Error { operation: string; filename?: string; cause: unknown; }
export class XmpPlayer {
  readonly state: XmpPlayerState;
  readonly visualization?: XmpVisualizationSource;
  on(event: "state" | "metadata" | "ended" | "error", listener: (payload?: unknown) => void): () => void;
  getDiagnostics(): Record<string, unknown>;
  load(input: File | ArrayBuffer, options?: XmpLoadOptions): Promise<Record<string, unknown>>;
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
  setUadePanning(panning: number): void;
  dispose(): Promise<void>;
}
export function createXmpPlayer(options?: XmpPlayerOptions): Promise<XmpPlayer>;