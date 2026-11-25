import type { ChordInput, ChordQuality, NoteName } from '../types';
import { mod12, parsePitchClass, pcName } from './pitch';

export type ChordKind =
  | 'major' | 'minor' | 'dominant' | 'halfdim' | 'dim' | 'sus' | 'aug' | 'power';

export interface ChordType {
  /** Display suffix appended to the root, e.g. "Maj7", "7#11", "" */
  suffix: string;
  /** Voicing intervals above the root. Values >= 12 are upper-structure tensions. */
  intervals: readonly number[];
  family: ChordQuality;
  kind: ChordKind;
  /** Has a minor seventh and functions as a dominant (includes 7sus4). */
  dominant: boolean;
  /** Recognition preference (lower = more common / preferred name). */
  rank: number;
}

const T = (
  suffix: string,
  intervals: number[],
  family: ChordQuality,
  kind: ChordKind,
  rank: number,
  dominant = kind === 'dominant',
): ChordType => ({ suffix, intervals, family, kind, rank, dominant });

/** ~45 chord qualities used by the parser and the Piano Mode recognizer. */
export const CHORD_TYPES: readonly ChordType[] = [
  // Triads & dyads
  T('', [0, 4, 7], 'Maj', 'major', 1),
  T('m', [0, 3, 7], 'm', 'minor', 1),
  T('dim', [0, 3, 6], 'dim', 'dim', 3),
  T('aug', [0, 4, 8], 'aug', 'aug', 3),
  T('sus4', [0, 5, 7], 'sus', 'sus', 2),
  T('sus2', [0, 2, 7], 'sus', 'sus', 3),
  T('5', [0, 7], 'Maj', 'power', 6),
  // Sixths
  T('6', [0, 4, 7, 9], 'Maj', 'major', 3),
  T('m6', [0, 3, 7, 9], 'm', 'minor', 4),
  T('69', [0, 4, 7, 9, 14], 'Maj', 'major', 4),
  T('m69', [0, 3, 7, 9, 14], 'm', 'minor', 6),
  // Sevenths
  T('Maj7', [0, 4, 7, 11], 'maj7', 'major', 1),
  T('m7', [0, 3, 7, 10], 'm7', 'minor', 1),
  T('7', [0, 4, 7, 10], '7', 'dominant', 1),
  T('ø7', [0, 3, 6, 10], 'ø7', 'halfdim', 2),
  T('dim7', [0, 3, 6, 9], 'dim', 'dim', 2),
  T('mMaj7', [0, 3, 7, 11], 'm', 'minor', 4),
  T('Maj7#5', [0, 4, 8, 11], 'aug', 'aug', 5),
  T('7#5', [0, 4, 8, 10], '7', 'dominant', 4),
  T('7b5', [0, 4, 6, 10], '7', 'dominant', 9), // same notes read as 7#11 (no 5) by jazz convention
  T('7sus4', [0, 5, 7, 10], 'sus', 'sus', 3, true),
  // Ninths
  T('Maj9', [0, 4, 7, 11, 14], 'maj7', 'major', 2),
  T('m9', [0, 3, 7, 10, 14], 'm7', 'minor', 2),
  T('9', [0, 4, 7, 10, 14], '7', 'dominant', 2),
  T('add9', [0, 4, 7, 14], 'Maj', 'major', 2),
  T('madd9', [0, 3, 7, 14], 'm', 'minor', 3),
  T('7b9', [0, 4, 7, 10, 13], '7', 'dominant', 3),
  T('7#9', [0, 4, 7, 10, 15], '7', 'dominant', 3),
  T('9sus4', [0, 5, 7, 10, 14], 'sus', 'sus', 4, true),
  T('mMaj9', [0, 3, 7, 11, 14], 'm', 'minor', 6),
  T('m7b9', [0, 3, 7, 10, 13], 'm7', 'minor', 7),
  // Elevenths
  T('m11', [0, 3, 7, 10, 14, 17], 'm7', 'minor', 3),
  T('Maj7#11', [0, 4, 7, 11, 18], 'maj7', 'major', 3),
  T('7#11', [0, 4, 7, 10, 18], '7', 'dominant', 3),
  T('9#11', [0, 4, 7, 10, 14, 18], '7', 'dominant', 4),
  T('Maj9#11', [0, 4, 7, 11, 14, 18], 'maj7', 'major', 5),
  // Thirteenths
  T('13', [0, 4, 7, 10, 14, 21], '7', 'dominant', 3),
  T('m13', [0, 3, 7, 10, 14, 21], 'm7', 'minor', 5),
  T('Maj13', [0, 4, 7, 11, 14, 21], 'maj7', 'major', 5),
  T('13#11', [0, 4, 7, 10, 14, 18, 21], '7', 'dominant', 6),
  // Altered dominants
  T('7alt', [0, 4, 10, 13, 15, 20], 'alt', 'dominant', 4),
  T('7b13', [0, 4, 7, 10, 20], '7', 'dominant', 6),
  T('7b9b13', [0, 4, 7, 10, 13, 20], '7', 'dominant', 6),
  T('7#9b13', [0, 4, 10, 15, 20], '7', 'dominant', 6),
  T('7b9#11', [0, 4, 10, 13, 18], '7', 'dominant', 6),
];

const BY_SUFFIX = new Map(CHORD_TYPES.map((t) => [t.suffix, t]));

/** Default chord type produced by each 2-tap palette quality key. */
export const PALETTE_SUFFIX: Record<ChordQuality, string> = {
  Maj: '',
  m: 'm',
  '7': '7',
  maj7: 'Maj7',
  m7: 'm7',
  'ø7': 'ø7',
  dim: 'dim7',
  sus: 'sus4',
  aug: 'aug',
  alt: '7alt',
};

export const PALETTE_QUALITIES: readonly ChordQuality[] = [
  'Maj', 'm', '7', 'maj7', 'm7', 'ø7', 'dim', 'sus', 'aug', 'alt',
];

const ALIASES: Record<string, string> = {
  M: '', maj: '', major: '', min: 'm', '-': 'm', mi: 'm',
  M7: 'Maj7', maj7: 'Maj7', 'Δ': 'Maj7', 'Δ7': 'Maj7', ma7: 'Maj7',
  M9: 'Maj9', maj9: 'Maj9', M13: 'Maj13', maj13: 'Maj13',
  'maj7#11': 'Maj7#11', 'maj9#11': 'Maj9#11', 'maj7#5': 'Maj7#5',
  '-7': 'm7', min7: 'm7', 'm7b5': 'ø7', 'ø': 'ø7', 'h7': 'ø7', h: 'ø7',
  o: 'dim', '°': 'dim', o7: 'dim7', '°7': 'dim7',
  '+': 'aug', '+7': '7#5', aug7: '7#5',
  sus: 'sus4', '7sus': '7sus4', '9sus': '9sus4',
  alt: '7alt', '7(alt)': '7alt',
  'mM7': 'mMaj7', 'm(maj7)': 'mMaj7', 'mmaj7': 'mMaj7',
  '6/9': '69', add2: 'add9', '2': 'sus2',
};

export function chordTypeFor(suffix: string): ChordType | null {
  const direct = BY_SUFFIX.get(suffix);
  if (direct) return direct;
  const alias = ALIASES[suffix];
  if (alias !== undefined) return BY_SUFFIX.get(alias) ?? null;
  // Case-insensitive "maj..." prefix forms (maj7#11 -> Maj7#11)
  if (/^maj/i.test(suffix)) return BY_SUFFIX.get('Maj' + suffix.slice(3)) ?? null;
  return null;
}

export interface Chord {
  root: number;
  type: ChordType;
  /** Slash bass pitch class (only when it differs from the root). */
  bass: number | null;
  symbol: string;
}

export function chordSymbol(root: number, type: ChordType, bass: number | null): string {
  const base = `${pcName(root)}${type.suffix}`;
  return bass !== null && mod12(bass) !== mod12(root) ? `${base}/${pcName(bass)}` : base;
}

export function makeChord(root: number, type: ChordType, bass: number | null = null): Chord {
  const r = mod12(root);
  const b = bass === null || mod12(bass) === r ? null : mod12(bass);
  return { root: r, type, bass: b, symbol: chordSymbol(r, type, b) };
}

/** Parse "Db7#11", "CMaj7/E", "F#m7b5", "Bbalt" ... Returns null for unknown symbols. */
export function parseChord(symbol: string): Chord | null {
  const s = symbol.trim();
  const m = /^([A-G](?:b|#|♭|♯)?)(.*)$/.exec(s);
  if (!m) return null;
  const root = parsePitchClass(m[1]!);
  if (root === null) return null;
  let rest = m[2]!;
  let bass: number | null = null;
  const slash = /\/([A-G](?:b|#|♭|♯)?)$/.exec(rest);
  if (slash && !rest.endsWith('6/9')) {
    bass = parsePitchClass(slash[1]!);
    rest = rest.slice(0, slash.index);
  }
  const type = chordTypeFor(rest);
  if (!type) return null;
  return makeChord(root, type, bass);
}

/** Pitch classes sounded by the chord (including slash bass). */
export function chordPcs(chord: Chord): Set<number> {
  const set = new Set(chord.type.intervals.map((i) => mod12(chord.root + i)));
  if (chord.bass !== null) set.add(chord.bass);
  return set;
}

/** Root/3rd/5th/7th (or 6th) — the "body" used for diatonic membership checks. */
export function chordCorePcs(chord: Chord): number[] {
  return chord.type.intervals.filter((i) => i < 12).map((i) => mod12(chord.root + i));
}

export const bassPc = (chord: Chord): number => chord.bass ?? chord.root;

export const hasInterval = (chord: Chord, semis: number): boolean =>
  chord.type.intervals.some((i) => mod12(i) === mod12(semis));

export const isDominant = (chord: Chord): boolean => chord.type.dominant;
export const isMajorType = (chord: Chord): boolean => chord.type.kind === 'major';
export const isMinorType = (chord: Chord): boolean => chord.type.kind === 'minor';

export function toChordInput(chord: Chord, customMidiNotes?: number[]): ChordInput {
  const input: ChordInput = {
    root: pcName(chord.root),
    quality: chord.type.family,
    symbol: chord.symbol,
  };
  if (chord.bass !== null) input.slashBass = pcName(chord.bass);
  if (customMidiNotes && customMidiNotes.length) input.customMidiNotes = [...customMidiNotes];
  return input;
}

export function fromChordInput(input: ChordInput): Chord | null {
  return parseChord(input.symbol);
}

/** Build a chord from a palette selection (root + quality key + optional slash bass). */
export function paletteChord(root: NoteName, quality: ChordQuality, slashBass?: NoteName | null): Chord {
  const type = BY_SUFFIX.get(PALETTE_SUFFIX[quality])!;
  const bass = slashBass ? parsePitchClass(slashBass) : null;
  return makeChord(parsePitchClass(root)!, type, bass);
}

/** Return the chord type with the given suffix (throws on typo — for internal use). */
export function typeBySuffix(suffix: string): ChordType {
  const t = BY_SUFFIX.get(suffix);
  if (!t) throw new Error(`Unknown chord suffix "${suffix}"`);
  return t;
}

// ---------------------------------------------------------------------------
// Piano Mode recognizer
// ---------------------------------------------------------------------------

const setKey = (pcs: Iterable<number>): string => [...new Set(pcs)].sort((a, b) => a - b).join(',');

interface Template { type: ChordType; key: string; penalty: number }

const TEMPLATES: Template[] = (() => {
  const out: Template[] = [];
  for (const type of CHORD_TYPES) {
    const pcs = type.intervals.map(mod12);
    out.push({ type, key: setKey(pcs), penalty: 0 });
    // Allow the perfect fifth to be omitted from 4+ note chords (common jazz voicing)
    if (pcs.length >= 4 && pcs.includes(7)) {
      out.push({ type, key: setKey(pcs.filter((p) => p !== 7)), penalty: 5 });
    }
  }
  return out;
})();

export interface Recognition {
  chord: Chord;
  /** Sorted pitch classes that were held. */
  pcs: number[];
}

/**
 * Identify a chord from held MIDI notes. The lowest note is treated as the bass;
 * root-position readings are preferred, otherwise a slash chord is returned.
 */
export function recognizeChord(midiNotes: readonly number[]): Recognition | null {
  if (midiNotes.length < 2) return null;
  const sorted = [...midiNotes].sort((a, b) => a - b);
  const pcs = [...new Set(sorted.map(mod12))];
  if (pcs.length < 2) return null;
  const bass = mod12(sorted[0]!);
  let best: { chord: Chord; score: number } | null = null;
  for (const root of pcs) {
    const key = setKey(pcs.map((p) => mod12(p - root)));
    for (const t of TEMPLATES) {
      if (t.key !== key) continue;
      const score = t.type.rank + t.penalty + (root === bass ? 0 : 4);
      if (!best || score < best.score) best = { chord: makeChord(root, t.type, bass), score };
    }
  }
  return best ? { chord: best.chord, pcs: pcs.sort((a, b) => a - b) } : null;
}
