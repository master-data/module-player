export interface SidMetadata {
  format: "PSID" | "RSID";
  version: number;
  fileName?: string;
  fileLengthBytes: number;
  dataOffset: number;
  loadAddress: number;
  initAddress: number;
  playAddress: number;
  songCount: number;
  startSong: number;
  currentSong: number;
  speed: number;
  title?: string;
  author?: string;
  released?: string;
  clock: "PAL" | "NTSC" | "PAL/NTSC" | "unknown";
  sidModel: "MOS6581" | "MOS8580" | "unknown";
  installedSids: 1 | 2 | 3;
  sid2Address?: number;
  sid3Address?: number;
  requiresRoms: boolean;
}

export function isSidFile(input: ArrayBuffer | Uint8Array): boolean;
export function parseSidMetadata(input: ArrayBuffer | Uint8Array, options?: { filename?: string; track?: number }): SidMetadata;

export type SidPlayerState = "initializing" | "ready" | "loading" | "playing" | "paused" | "stopped" | "ended" | "error" | "disposed";
export type SidEngine = "sidlite" | "residfp";

export interface SidSystemRoms {
  kernal?: ArrayBuffer | Uint8Array;
  basic?: ArrayBuffer | Uint8Array;
  chargen?: ArrayBuffer | Uint8Array;
}

export interface SidEmulationConfig {
  c64Model?: "PAL" | "NTSC" | "OLD_NTSC" | "DREAN" | "PAL_M";
  forceC64Model?: boolean;
  sidModel?: "MOS6581" | "MOS8580";
  forceSidModel?: boolean;
  digiBoost?: boolean;
}

export interface SidVisualizationSource {
  readonly streamCount: number;
  readonly sampleLength: number;
  getZoom(): number;
  setZoom(level: 1 | 2 | 3 | 4 | 5): void;
  readChannel(channel: number): Float32Array;
  readVu(channel: number): number;
  readOverallVu(): number;
}

export interface SidWriteTrace {
  address: number;
  value: number;
  cyclePhi1: number;
}

export interface SidPlayerOptions {
  assetBaseUrl?: string;
  audioContextSampleRate?: number;
  processorBufferSize?: number;
  engine?: SidEngine;
  emulationConfig?: SidEmulationConfig;
  systemRoms?: SidSystemRoms;
}

export interface SidLoadOptions {
  filename?: string;
  track?: number;
  timeoutSeconds?: number;
  loop?: boolean;
}

export class SidPlaybackError extends Error {
  operation: string;
  filename?: string;
  cause: unknown;
}

export class SidPlayer {
  readonly state: SidPlayerState;
  readonly visualization: SidVisualizationSource;
  on(event: "state" | "metadata" | "ended" | "error", listener: (payload?: unknown) => void): () => void;
  load(input: File | ArrayBuffer, options?: SidLoadOptions): Promise<SidMetadata & { raw: unknown; engine?: string; md5?: string }>;
  selectSong(track: number): Promise<number>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  setVolume(level: number): void;
  getVolume(): number;
  setLooping(enabled: boolean): void;
  setTimeout(seconds: number | null): void;
  setSystemRoms(roms?: SidSystemRoms): void;
  setEmulationConfig(config: SidEmulationConfig): void;
  getEmulationConfig(): Record<string, unknown> | undefined;
  getSidStatus(sidNumber?: number): Uint8Array | undefined;
  getSidWriteTrace(sidNumber?: number): SidWriteTrace[];
  getInstalledSids(): number;
  getDiagnostics(): Record<string, unknown>;
  dispose(): Promise<void>;
}

export function createSidPlayer(options?: SidPlayerOptions): Promise<SidPlayer>;