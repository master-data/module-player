import { CONTEXT_HINTS, scoutCatalog } from "./format-scout-catalog.js";
import { scoutUadeFileMagic, UADE_EXTENSION_FORMATS } from "./format-scout-uade-filemagic.js";

// Generated from webuade_rip/public/uade/eagleplayer.conf. This mirrors
// UADE's filename prefix and postfix lookup after content detection fails.
export const UADE_EAGLEPLAYER_PREFIXES = Object.freeze({"!pm!":"PTK-Prowiz","40a":"PTK-Prowiz","40b":"PTK-Prowiz","41a":"PTK-Prowiz","4q":"Quartet_ST","4v":"Quartet_ST","50a":"PTK-Prowiz","60a":"PTK-Prowiz","61a":"PTK-Prowiz","aam":"ArtAndMagic","abk":"AMOS","ac1":"PTK-Prowiz","ac1d":"PTK-Prowiz","adpcm":"ADPCM_mono","adsc":"AudioSculpture","agi":"Sierra-AGI","ahx":"AbyssHighestExperience","alp":"Alcatraz_Packer","amad":"PlayAY","amc":"AM-Composer","aon":"ArtOfNoise-4V","aon4":"ArtOfNoise-4V","aon8":"ArtOfNoise-8V","aps":"AProSys","arp":"MajorTom","ash":"AshleyHogg","ast":"ActionAmics","aval":"PTK-Prowiz","avp":"MartinWalker","ay":"PlayAY","bd":"BenDaglish","bds":"BenDaglish-SID","bfc":"FutureComposer-BSI","bp":"SoundMon2.0","bp3":"SoundMon2.2","bsi":"FutureComposer-BSI","bss":"BeathovenSynthesizer","bye":"AndrewParton","ch1":"PTK-Prowiz","ch2":"PTK-Prowiz","ch3":"PTK-Prowiz","chan":"PTK-Prowiz","cin":"Cinemaware","cm":"CustomMade","core":"CoreDesign","cp":"PTK-Prowiz","cplx":"PTK-Prowiz","crb":"PTK-Prowiz","cus":"custom","cust":"custom","custom":"custom","dat":"PaulRobotham","db":"DIGI-Booster","dh":"DavidHanney","digi":"DIGI-Booster","dl":"DaveLowe","dl_deli":"DaveLowe_Deli","dlm1":"DeltaMusic1.3","dlm2":"DeltaMusic2.0","dln":"DaveLoweNew","dm":"DeltaMusic1.3","dm1":"DeltaMusic1.3","dm2":"DeltaMusic2.0","dmu":"Mugician","dmu2":"MugicianII","dns":"DynamicSynthesizer","doda":"Special-FX_ST","dp":"Tronic","dsc":"DigitalSonixChrome","dsr":"Desire","dss":"DigitalSoundStudio","dum":"Infogrames","dux":"GTGameSystems","dw":"DavidWhittaker","dwold":"DavidWhittaker","dz":"DariusZendeh","ea":"EarAche","emod":"QuadraComposer","ems":"EMS","emsv6":"EMS-6","ex":"FashionTracker","fc":"FutureComposer1.4","fc-bsi":"FutureComposer-BSI","fc-m":"PTK-Prowiz","fc13":"FutureComposer1.3","fc14":"FutureComposer1.4","fc3":"FutureComposer1.3","fc4":"FutureComposer1.4","fcm":"PTK-Prowiz","fp":"FuturePlayer","fred":"Fred","ft":"PTK-Prowiz","ftm":"FaceTheMusic","fuchs":"PTK-Prowiz","fuz":"PTK-Prowiz","fuzz":"PTK-Prowiz","fuzzac":"PTK-Prowiz","fw":"ForgottenWorlds_Game","glue":"GlueMon","gm":"GlueMon","gmc":"GMC","gray":"FredGray","gv":"PTK-Prowiz","han":"DigitalSoundCreations","hd":"HowieDavies","hip":"JochenHippel","hip7":"JochenHippel-7V","hipc":"JochenHippel-CoSo","hmc":"PTK-Prowiz","hn":"MajorTom","hot":"Anders-0land","hrt":"PTK-Prowiz","hrt!":"PTK-Prowiz","hst":"Hippel-ST_note","ice":"PTK-Prowiz","ims":"ImagesMusicSystem","is":"InStereo","is20":"InStereo2.0","it1":"PTK-Prowiz","jam":"JamCracker","jb":"JasonBrooke","jc":"JamCracker","jcb":"JasonBrooke","jcbo":"JasonBrooke","jd":"Special-FX","jmf":"JankoMrsicFlogel","jo":"JesperOlsen","jp":"JasonPage_JP","jpn":"JasonPage","jpnd":"JasonPage","jpo":"SteveTurner","jpold":"SteveTurner","js":"JanneSalmijarviOptimizer","jt":"JeroenTel","kef":"PTK-Prowiz","kef7":"PTK-Prowiz","kh":"KrisHatlelid","kim":"KimChristensen","kris":"ChipTracker","krs":"PTK-Prowiz","ksm":"PTK-Prowiz","lax":"PTK-Prowiz","lion":"Lionheart_Game","lme":"LegglessMusicEditor","ma":"MusicAssembler","max":"Maximum_Effect","mc":"Mark_Cooksey","mcmd":"JochenHippel","mcmd_org":"MCMD","mco":"Mark_Cooksey_Old","mcr":"Mark_Cooksey","md":"MikeDavies","mdat":"TFMX-Pro","mdst":"TFMX_ST","med":"MED","mexxmp":"PTK-Prowiz","mfp":"MagneticFieldsPacker","mg":"EarAche","midi":"MIDI-Loriciel","mk2":"MarkII","mkii":"MarkII","mkiio":"DariusZendeh","ml":"MusiclineEditor","mm4":"MusicMaker-4V","mm8":"MusicMaker-8V","mmd0":"MED","mmd1":"MED","mmd2":"MED","mmdc":"MMDC","mms":"MultiMedia_Sound","mod":"PTK-Prowiz","mod_adsc4":"AudioSculpture","mod_comp":"PTK-Prowiz","mod_doc":"PTK-Prowiz","mod_flt4":"PTK-Prowiz","mod_flt8":"PTK-Prowiz","mod_ntk":"PTK-Prowiz","mod_ntk1":"PTK-Prowiz","mod_ntk2":"PTK-Prowiz","mod_ntkamp":"PTK-Prowiz","mod_pc":"PTK-Prowiz","mod_stpk":"PTK-Prowiz","mod15":"PTK-Prowiz","mod15_mst":"PTK-Prowiz","mod15_st-iv":"Soundtracker-IV","mod15_ust":"UltimateSoundtracker","mok":"Silmarils","mon":"ManiacsOfNoise","mon_old":"JeroenTel","mosh":"MoshPacker","mp":"PTK-Prowiz","mpro":"PTK-Prowiz","mso":"Medley","mtp2":"MajorTom","mug":"Mugician","mug2":"MugicianII","mus":"UFO","mw":"MartinWalker","mx":"Music-X_Driver","mxp":"Music-X_Driver","mxtx":"MaxTrax","noisepacker2":"PTK-Prowiz","noisepacker3":"PTK-Prowiz","np":"PTK-Prowiz","np1":"PTK-Prowiz","np2":"PTK-Prowiz","np3":"PTK-Prowiz","npp":"NickPellingPacker","nr":"PTK-Prowiz","nru":"PTK-Prowiz","ntp":"NovoTradePacker","ntp1":"PTK-Prowiz","ntpk":"PTK-Prowiz","nw1":"PTK-Prowiz","octamed":"Octa-MED","okt":"Oktalyzer","okta":"Oktalyzer","one":"onEscapee","osp":"SynthPack","p10":"PTK-Prowiz","p21":"PTK-Prowiz","p30":"PTK-Prowiz","p40a":"PTK-Prowiz","p40b":"PTK-Prowiz","p41a":"PTK-Prowiz","p4x":"PTK-Prowiz","p50a":"PTK-Prowiz","p5a":"PTK-Prowiz","p5x":"PTK-Prowiz","p60":"PTK-Prowiz","p60a":"PTK-Prowiz","p61":"PTK-Prowiz","p61a":"PTK-Prowiz","p6x":"PTK-Prowiz","pap":"PierreAdane","pat":"Paul_Tonge","pha":"PTK-Prowiz","pin":"PTK-Prowiz","pm":"PTK-Prowiz","pm0":"PTK-Prowiz","pm01":"PTK-Prowiz","pm1":"PTK-Prowiz","pm10":"PTK-Prowiz","pm10c":"PTK-Prowiz","pm18a":"PTK-Prowiz","pm2":"PTK-Prowiz","pm20":"PTK-Prowiz","pm4":"PTK-Prowiz","pm40":"PTK-Prowiz","pmz":"PTK-Prowiz","pn":"Pokeynoise","polk":"PTK-Prowiz","powt":"Laxity","pp":"PTK-Prowiz","pp10":"PTK-Prowiz","pp20":"PTK-Prowiz","pp21":"PTK-Prowiz","pp30":"PTK-Prowiz","ppk":"PTK-Prowiz","pr1":"PTK-Prowiz","pr10":"PTK-Prowiz","pr2":"PTK-Prowiz","pr20":"PTK-Prowiz","prom":"PTK-Prowiz","prt":"PreTracker","pru":"PTK-Prowiz","pru1":"PTK-Prowiz","pru2":"PTK-Prowiz","prun":"PTK-Prowiz","prun1":"PTK-Prowiz","prun2":"PTK-Prowiz","ps":"PaulShields","psa":"ProfessionalSoundArtists","psf":"SoundFactory","pt":"Laxity","puma":"PumaTracker11","pvp":"PeterVerswyvelen","pwr":"PTK-Prowiz","pyg":"PTK-Prowiz","pygm":"PTK-Prowiz","pygmy":"PTK-Prowiz","qc":"QuadraComposer","qpa":"Quartet","qts":"Quartet_ST","rh":"RobHubbard","rho":"RobHubbardOld","riff":"RiffRaff","rjp":"RichardJoseph","rk":"CustomMade","rkb":"CustomMade","s-c":"SeanConnolly","s7g":"JochenHippel-7V","sa":"SonicArranger","sa_old":"SonicArranger-pc-all","sa-p":"Lionheart_Game","sas":"SpeedyA1System","sb":"SteveBarrett","sc":"SoundControl","scn":"SeanConnolly","scr":"SeanConran","sct":"SoundControl","scumm":"SCUMM","sdr":"SynthDream","sfx":"Sound-FX","sfx13":"Sound-FX","sfx20":"MultiMedia_Sound","sg":"TomyTracker","sid":"SIDMon1.0","sid1":"SIDMon1.0","sid2":"SIDMon2.0","sjs":"SoundPlayer","skt":"PTK-Prowiz","skyt":"PTK-Prowiz","sm":"SoundMaster","sm1":"SoundMaster","sm2":"SoundMaster","sm3":"SoundMaster","smn":"SIDMon1.0","smod":"FutureComposer1.3","smpro":"SoundMaster","smus":"SonixMusicDriver","sndmon":"SoundMon2.0","sng":"RichardJoseph","snk":"PaulSummers","snt":"PTK-Prowiz","snt!":"PTK-Prowiz","snx":"SonixMusicDriver","soc":"Hippel-ST_note","sog":"Jochen_Hippel_ST","sonic":"SonicArranger","spl":"SoundProgrammingLanguage","spm":"Stonetracker1.2","sqt":"Quartet_PSG","ss":"SpeedySystem","st":"SynTracker","st2":"PTK-Prowiz","st26":"PTK-Prowiz","st30":"PTK-Prowiz","star":"PTK-Prowiz","stp":"SoundTracker-Pro-II","strc":"PlayAY","sun":"SUN-Tronic","syn":"Synth","synmod":"SynTracker","tcb":"TCB-Tracker","tf":"TimFollin","tfhd1.5":"TFMX-1.5-TFHD","tfhd7v":"TFMX-7V-TFHD","tfhdpro":"TFMX-Pro-TFHD","tfmx":"TFMX-Pro-TFHD","tfmx1.5":"TFMX","tfmx7v":"TFMX-7V","tfmxpro":"TFMX-Pro","thm":"ThomasHermann","thn":"MajorTom","thx":"AbyssHighestExperience","tiny":"SonixMusicDriver","tip":"TitanicsPacker","tits":"TitanicsPacker","tme":"TheMusicalEnlightenment","tmk":"TimeTracker","tp":"PTK-Prowiz","tp1":"PTK-Prowiz","tp2":"PTK-Prowiz","tp3":"PTK-Prowiz","tp6":"PTK-Prowiz","tpu":"DirkBialluch","trc":"Tronic","tro":"Tronic","tronic":"Tronic","tw":"SoundImages","two":"NTSP-system","uds":"BladePacker","ufo":"UFO","un2":"PTK-Prowiz","unic":"PTK-Prowiz","unic2":"PTK-Prowiz","vss":"VoodooSupremeSynthesizer","wb":"WallyBeben","wn":"PTK-Prowiz","xan":"PTK-Prowiz","xann":"PTK-Prowiz","ym":"YM-2149","ymst":"YM-2149","zen":"PTK-Prowiz","zm":"ZoundMonitor"});

function extensionOf(filename) {
  const baseName = String(filename ?? "").split(/[\\/]/).pop() ?? "";
  const separator = baseName.lastIndexOf(".");
  return separator > 0 && separator < baseName.length - 1
    ? baseName.slice(separator + 1).toLowerCase()
    : undefined;
}

function prefixOf(filename) {
  const baseName = String(filename ?? "").split(/[\\/]/).pop() ?? "";
  const separator = baseName.indexOf(".");
  return separator > 0 ? baseName.slice(0, separator).toLowerCase() : undefined;
}

function normalizeInput(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError("File Scout input must be an ArrayBuffer or Uint8Array.");
}

function uadeCandidate(result) {
  return {
    id: `uade/${result.prefix || "rejected"}`.toLowerCase(),
    format: result.name,
    platform: "Amiga",
    confidence: result.rejected ? "high" : "high",
    rejected: Boolean(result.rejected),
    evidence: [{ kind: "uade-amifilemagic", prefix: result.prefix || undefined }],
    needsContext: false
  };
}

function uadeExtensionCandidate(extension) {
  const format = UADE_EXTENSION_FORMATS.find((candidate) => candidate.extension === extension);
  return format ? {
    id: `uade-extension/${extension}`,
    format: format.name,
    platform: "Amiga",
    confidence: "low",
    evidence: [{ kind: "filename-extension", extension }],
    needsContext: true
  } : undefined;
}

function uadeEaglePlayerCandidate(prefix, extension) {
  const lookup = Object.hasOwn(UADE_EAGLEPLAYER_PREFIXES, prefix) ? prefix : extension;
  const player = UADE_EAGLEPLAYER_PREFIXES[lookup];
  return player ? {
    id: `uade-eagleplayer/${lookup}`,
    format: player,
    player,
    platform: "Amiga",
    confidence: "low",
    evidence: [{ kind: "uade-eagleplayer-filename", method: lookup === prefix ? "prefix" : "postfix", prefix: lookup }],
    needsContext: true
  } : undefined;
}

function prefixCandidates(prefix) {
  if (!prefix) return [];
  const catalogHint = CONTEXT_HINTS.find((candidate) => candidate.extension === prefix);
  const uadeFormat = UADE_EXTENSION_FORMATS.find((candidate) => candidate.extension === prefix);
  return [
    ...(catalogHint ? [{
      id: `hint/${prefix}`,
      format: catalogHint.format,
      confidence: "low",
      needsContext: true,
      evidence: [{ kind: "filename-prefix", extension: prefix }],
      extensions: [prefix]
    }] : []),
    ...(uadeFormat ? [{
      id: `uade-prefix/${prefix}`,
      format: uadeFormat.name,
      platform: "Amiga",
      confidence: "low",
      evidence: [{ kind: "filename-prefix", extension: prefix }],
      needsContext: true
    }] : [])
  ];
}

function dedupe(candidates) {
  const byId = new Map();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.id);
    byId.set(candidate.id, existing ? {
      ...existing,
      evidence: [...existing.evidence, ...candidate.evidence],
      needsContext: existing.needsContext && candidate.needsContext
    } : candidate);
  }
  return [...byId.values()];
}

/**
 * Assess a file using reliable byte signatures first, structural rules second,
 * then explicitly low-confidence filename/size context hints.
 *
 * The returned object is compact enough for lists while preserving evidence for
 * inspection. It never interprets an extension-only result as a confirmed type.
 */
export function scoutFile(input, options = {}) {
  const data = normalizeInput(input);
  const extension = extensionOf(options.filename);
  const prefix = prefixOf(options.filename);
  const catalogCandidates = scoutCatalog(data, extension).map((candidate) => ({
    ...candidate,
    needsContext: Boolean(candidate.needsContext)
  }));
  const uade = options.uade === false
    ? undefined
    : scoutUadeFileMagic(data, { fileSize: options.fileSize ?? data.byteLength });
  const uadeEaglePlayer = !uade && options.uade !== false
    ? uadeEaglePlayerCandidate(prefix, extension)
    : undefined;
  const uadeExtension = !uade && !uadeEaglePlayer && options.uade !== false && extension
    ? uadeExtensionCandidate(extension)
    : undefined;
  const assessedCandidates = dedupe([
    ...(uade ? [uadeCandidate(uade)] : []),
    ...(uadeEaglePlayer ? [uadeEaglePlayer] : []),
    ...(uadeExtension ? [uadeExtension] : []),
    ...catalogCandidates
  ]);
  const candidates = assessedCandidates.length ? assessedCandidates : dedupe(prefixCandidates(prefix));

  if (candidates.length > 1) {
    const ids = candidates.map((candidate) => candidate.id);
    return {
      filename: options.filename,
      extension,
      size: options.fileSize ?? data.byteLength,
      primary: candidates[0],
      alternatives: candidates.slice(1),
      ambiguous: true,
      needsContext: candidates.some((candidate) => candidate.needsContext),
      limitations: [`Multiple plausible formats: ${ids.join(", ")}.`]
    };
  }

  if (candidates.length === 1) {
    const primary = candidates[0];
    return {
      filename: options.filename,
      extension,
      size: options.fileSize ?? data.byteLength,
      primary,
      alternatives: [],
      ambiguous: false,
      needsContext: primary.needsContext,
      limitations: primary.needsContext ? ["This identification depends on filename or size context; inspect container, filesystem, or platform metadata for confirmation."] : []
    };
  }

  return {
    filename: options.filename,
    extension,
    size: options.fileSize ?? data.byteLength,
    primary: undefined,
    alternatives: [],
    ambiguous: false,
    needsContext: true,
    limitations: ["No reliable byte signature matched. Use filename, size, filesystem metadata, archive contents, or a platform-specific structural probe."]
  };
}

export function scoutBatch(entries, options = {}) {
  return entries.map(({ input, filename, fileSize, context }) => scoutFile(input, {
    ...options,
    filename,
    fileSize,
    context
  }));
}
