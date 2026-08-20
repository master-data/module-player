export interface FormatScoutMatch {
  id: string;
  family: string;
  name: string;
  mime?: string;
  extensions: string[];
  uadePrefix?: string;
  confidence: string;
  rejected?: boolean;
  evidence: { kind: "signature" | "structural" | "filename-extension"; offset: number; filenameExtension?: string };
}

export interface FormatScoutReport {
  filename?: string;
  extension?: string;
  byteLength: number;
  matches: FormatScoutMatch[];
  primary?: FormatScoutMatch;
}

export interface FileScoutCandidate {
  id: string;
  format: string;
  player?: string;
  platform?: string;
  mime?: string;
  confidence: "high" | "medium" | "low";
  rejected?: boolean;
  needsContext: boolean;
  evidence: Array<Record<string, unknown>>;
}

export interface FileScoutReport {
  filename?: string;
  extension?: string;
  size: number;
  primary?: FileScoutCandidate;
  alternatives: FileScoutCandidate[];
  ambiguous: boolean;
  needsContext: boolean;
  limitations: string[];
}

export interface UadeExtensionFormat { extension: string; name: string; }
export const UADE_EAGLEPLAYER_PREFIXES: Readonly<Record<string, string>>;

export interface FormatScoutRule {
  id: string;
  name: string;
  family?: string;
  mime?: string;
  extensions?: string[];
  uadePrefix?: string;
  offset?: number;
  signature?: string | number[] | Uint8Array;
  confidence?: string;
  test?: (data: Uint8Array, context: { filename?: string; extension?: string }) => boolean;
}

export const FORMAT_SCOUT_RULES: readonly FormatScoutRule[];
export const UADE_EXTENSION_FORMATS: readonly UadeExtensionFormat[];
export function defineFormatRule(rule: FormatScoutRule): FormatScoutRule;
export function scoutFormat(input: ArrayBuffer | Uint8Array, options?: { filename?: string; rules?: readonly FormatScoutRule[]; fileSize?: number; uade?: boolean }): FormatScoutReport;
export function scoutUadeFileMagic(input: ArrayBuffer | Uint8Array, options?: { fileSize?: number }): { prefix: string; name: string; rejected?: boolean } | undefined;
export function scoutFile(input: ArrayBuffer | Uint8Array, options?: { filename?: string; fileSize?: number; uade?: boolean }): FileScoutReport;
export function scoutBatch(entries: Array<{ input: ArrayBuffer | Uint8Array; filename?: string; fileSize?: number; context?: Record<string, unknown> }>, options?: { uade?: boolean }): FileScoutReport[];
export function isUadeCompatible(report: FileScoutReport): boolean;