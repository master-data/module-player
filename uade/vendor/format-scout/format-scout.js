/**
 * Public compatibility facade for Format Scout.
 *
 * Use scoutFile() for new integrations. It combines the generic catalog with
 * UADE's legacy-compatible detector and reports uncertainty explicitly.
 *
 * The detailed amifilemagic port lives in format-scout-uade-filemagic.js so its numerous
 * historical byte-level heuristics do not obscure the general scouting API.
 */
export {
  defineFormatRule,
  FORMAT_SCOUT_RULES,
  scoutFormat,
  scoutUadeFileMagic,
  UADE_EXTENSION_FORMATS
} from "./format-scout-uade-filemagic.js";
