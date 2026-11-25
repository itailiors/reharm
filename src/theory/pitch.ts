import type { NoteName } from '../types';

/** Canonical flat spellings, indexed by pitch class (C = 0). */
export const NOTE_NAMES: readonly NoteName[] = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
] as const;

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** Parse a note letter with optional accidentals (b, #, ♭, ♯) into a pitch class. */
export function parsePitchClass(name: string): number | null {
  const m = /^([A-Ga-g])([b#♭♯]*)$/.exec(name.trim());
  if (!m) return null;
  let pc = LETTER_PC[m[1]!.toUpperCase()]!;
  for (const acc of m[2]!) pc += acc === '#' || acc === '♯' ? 1 : -1;
  return mod12(pc);
}

export const pcName = (pc: number): NoteName => NOTE_NAMES[mod12(pc)]!;

/** Normalize any spelling (F#, Gb, E#) to the canonical flat NoteName. */
export function toNoteName(name: string): NoteName | null {
  const pc = parsePitchClass(name);
  return pc === null ? null : pcName(pc);
}

/** "Bb4" -> 70. Octave 4 contains middle C (60). */
export function parseMidi(label: string): number | null {
  const m = /^([A-Ga-g])([b#]*)(-?\d)$/.exec(label.trim());
  if (!m) return null;
  const letterPc = LETTER_PC[m[1]!.toUpperCase()]!;
  let acc = 0;
  for (const ch of m[2]!) acc += ch === '#' ? 1 : -1;
  return (Number(m[3]) + 1) * 12 + letterPc + acc;
}

export const midiLabel = (midi: number): string => `${pcName(midi)}${Math.floor(midi / 12) - 1}`;

/** Shortest distance between two pitch classes (0..6). */
export const pcDistance = (a: number, b: number): number => {
  const d = mod12(a - b);
  return Math.min(d, 12 - d);
};
