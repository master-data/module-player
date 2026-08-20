export { defineFormatRule, FORMAT_SCOUT_RULES, UADE_EXTENSION_FORMATS, scoutFormat, scoutUadeFileMagic } from "./format-scout.js";
export { scoutBatch, scoutFile, UADE_EAGLEPLAYER_PREFIXES } from "./format-scout-file.js";

export function isUadeCompatible(report) {
	const candidate = report?.primary;
	return Boolean(candidate && !candidate.rejected && (candidate.id.startsWith("uade/") || candidate.id.startsWith("uade-extension/") || candidate.id.startsWith("uade-eagleplayer/")));
}