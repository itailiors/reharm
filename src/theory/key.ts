import type { NoteName } from '../types';
import { type Chord, chordCorePcs, isDominant, isMajorType, isMinorType } from './chords';
import { mod12, parsePitchClass, pcName } from './pitch';

export type Mode = 'major' | 'minor';

export interface KeyContext {
  tonic: number;
  mode: Mode;
  /** Diatonic scale pitch classes (natural minor for minor keys). */
  scale: Set<number>;
}

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

export function makeKey(tonic: NoteName | number, mode: Mode): KeyContext {
  const t = typeof tonic === 'number' ? mod12(tonic) : parsePitchClass(tonic)!;
  const steps = mode === 'major' ? MAJOR_STEPS : MINOR_STEPS;
  return { tonic: t, mode, scale: new Set(steps.map((s) => mod12(t + s))) };
}

export const keyLabel = (key: KeyContext): string =>
  `${pcName(key.tonic)} ${key.mode === 'major' ? 'Major' : 'Minor'}`;

/** Scale degree in semitones above the tonic (0..11). */
export const degreeOf = (key: KeyContext, pc: number): number => mod12(pc - key.tonic);

/** Is the chord's body (root/3/5/7) inside the key? Minor keys also accept harmonic-minor V and vii°. */
export function isDiatonic(key: KeyContext, chord: Chord): boolean {
  const core = chordCorePcs(chord);
  if (core.every((pc) => key.scale.has(pc))) return true;
  if (key.mode === 'minor') {
    const deg = degreeOf(key, chord.root);
    const harmonic = new Set([...key.scale].map((p) => (degreeOf(key, p) === 10 ? mod12(key.tonic + 11) : p)));
    if ((deg === 7 || deg === 11) && core.every((pc) => harmonic.has(pc))) return true;
  }
  return false;
}

/**
 * Modal interchange: chord borrowed from the parallel mode (aeolian/phrygian/mixolydian
 * for major keys; ionian/dorian for minor keys). Returns a roman label or null.
 */
export function borrowedLabel(key: KeyContext, chord: Chord): string | null {
  if (isDiatonic(key, chord)) return null;
  const deg = degreeOf(key, chord.root);
  const maj = isMajorType(chord);
  const min = isMinorType(chord);
  const halfDim = chord.type.kind === 'halfdim';
  const dom = isDominant(chord);
  if (key.mode === 'major') {
    if (deg === 5 && min) return 'iv';
    if (deg === 8 && maj) return 'bVI';
    if (deg === 3 && maj) return 'bIII';
    if (deg === 10 && (maj || dom)) return dom ? 'bVII7' : 'bVII';
    if (deg === 2 && halfDim) return 'iiø7';
    if (deg === 7 && min) return 'v';
    if (deg === 1 && maj) return 'bII';
    if (deg === 0 && min) return 'i';
    if (deg === 8 && dom) return 'bVI7';
  } else {
    if (deg === 5 && (maj || dom)) return dom ? 'IV7' : 'IV';
    if (deg === 0 && maj) return 'I';
    if (deg === 2 && min) return 'ii';
    if (deg === 9 && halfDim) return 'viø7';
    if (deg === 1 && maj) return 'bII';
  }
  return null;
}

const ROMAN = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];

/** Compact roman numeral for summaries, e.g. "bII7", "ii7", "bVImaj7". */
export function romanFor(key: KeyContext, chord: Chord): string {
  const deg = degreeOf(key, chord.root);
  let r = ROMAN[deg]!;
  const kind = chord.type.kind;
  if (kind === 'minor' || kind === 'halfdim' || kind === 'dim') r = r.replace(/[IV]+/, (s) => s.toLowerCase());
  const f = chord.type.family;
  if (f === 'maj7') r += 'maj7';
  else if (f === 'm7' || f === '7') r += '7';
  else if (f === 'alt') r += '7alt';
  else if (f === 'ø7') r += 'ø7';
  else if (kind === 'dim') r += '°';
  else if (kind === 'aug') r += '+';
  else if (kind === 'sus') r += 'sus';
  return r;
}
