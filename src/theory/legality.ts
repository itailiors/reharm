import type { BarIndex, ChordQuality, ConsonantHint, MelodyNote, NoteName } from '../types';
import {
  type Chord, PALETTE_QUALITIES, chordPcs, hasInterval, isDominant, makeChord, paletteChord, typeBySuffix,
} from './chords';
import { type KeyContext, isDiatonic } from './key';
import { mod12, pcName } from './pitch';

/** Notes the legality engine judges strictly: accented or at least a beat long. Short passing tones are free. */
export const isCheckedNote = (n: MelodyNote): boolean => n.isAccent || n.durationBeats >= 1;

export const barNotes = (melody: readonly MelodyNote[], bar: BarIndex): MelodyNote[] =>
  melody.filter((n) => n.barIndex === bar);

export const checkedBarNotes = (melody: readonly MelodyNote[], bar: BarIndex): MelodyNote[] =>
  barNotes(melody, bar).filter(isCheckedNote);

export interface Clash {
  note: MelodyNote;
  /** Chord pitch class the melody rubs against. */
  against: number;
  kind: 'minor-9th' | 'cross-relation';
}

/** Interval of a melody pitch class above the chord root (0..11). */
export const relToRoot = (chord: Chord, pc: number): number => mod12(pc - chord.root);

/**
 * Harsh-clash test for one melody pitch class against a chord.
 * Allowed: chord tones, and consonant colour tones (9, #11, 13, 11 on minor, altered tensions on dominants).
 * Flagged: a minor 9th above any chord tone, and major/minor cross-relations.
 */
export function clashFor(chord: Chord, melodyPc: number): Omit<Clash, 'note'> | null {
  const pcs = chordPcs(chord);
  const m = mod12(melodyPc);
  if (pcs.has(m)) return null;
  const rel = relToRoot(chord, m);
  const dom = isDominant(chord);
  // Altered dominant tensions (b9 over root, b13 over the fifth) are legal colour on a dominant.
  if (dom && (rel === 1 || rel === 8 || rel === 3)) return null;

  // Cross relations: natural 3 vs minor-3 chord handled by m9 rule; #9 over a non-dominant major chord,
  // or b7 against a major seventh chord, are cross-relations.
  if (rel === 3 && hasInterval(chord, 4) && !dom) {
    return { against: mod12(chord.root + 4), kind: 'cross-relation' };
  }
  if (rel === 10 && hasInterval(chord, 11)) {
    return { against: mod12(chord.root + 11), kind: 'cross-relation' };
  }
  for (const c of pcs) {
    if (mod12(m - c) === 1) return { against: c, kind: 'minor-9th' };
  }
  return null;
}

export function findClashes(chord: Chord, notes: readonly MelodyNote[]): Clash[] {
  const out: Clash[] = [];
  for (const note of notes) {
    if (!isCheckedNote(note)) continue;
    const c = clashFor(chord, note.midi);
    if (c) out.push({ note, ...c });
  }
  return out;
}

export const isLegalForBar = (chord: Chord, melody: readonly MelodyNote[], bar: BarIndex): boolean =>
  findClashes(chord, barNotes(melody, bar)).length === 0;

export function describeClash(bar: BarIndex, chord: Chord, clash: Clash): string {
  const mel = pcName(clash.note.midi);
  const what = clash.kind === 'minor-9th' ? 'b9' : 'cross-relation';
  return `Clash on Bar ${bar + 1}: ${mel} melody rubs against ${pcName(clash.against)} in ${chord.symbol} (${what}).`;
}

// ---------------------------------------------------------------------------
// Beginner Consonant Helper
// ---------------------------------------------------------------------------

const HELPER_SUFFIXES = ['', 'm', 'dim', 'Maj7', 'm7', '7', 'ø7'];
export const HELPER_MIDI_RANGE = { low: 60, high: 77 } as const; // C4..F5 piano

/** Safe diatonic roots/qualities and piano keys for one bar of melody. */
export function consonantHint(key: KeyContext, melody: readonly MelodyNote[], bar: BarIndex): ConsonantHint {
  const notes = barNotes(melody, bar);
  const roots = new Set<NoteName>();
  const quals = new Set<ChordQuality>();
  for (const root of key.scale) {
    for (const suffix of HELPER_SUFFIXES) {
      const chord = makeChord(root, typeBySuffix(suffix));
      if (!isDiatonic(key, chord)) continue;
      if (findClashes(chord, notes).length) continue;
      roots.add(pcName(root));
      quals.add(chord.type.family);
    }
  }
  const checked = notes.filter(isCheckedNote).map((n) => mod12(n.midi));
  const melodyPcs = new Set(notes.map((n) => mod12(n.midi)));
  const safeMidiNotes: number[] = [];
  for (let midi = HELPER_MIDI_RANGE.low; midi <= HELPER_MIDI_RANGE.high; midi++) {
    const pc = mod12(midi);
    // A key directly a semitone under a held melody note would make a b9 against it.
    const rubs = checked.some((m) => mod12(m - pc) === 1);
    if ((key.scale.has(pc) && !rubs) || melodyPcs.has(pc)) safeMidiNotes.push(midi);
  }
  const order = (q: ChordQuality) => PALETTE_QUALITIES.indexOf(q);
  return {
    safeRoots: [...roots].sort((a, b) => mod12(noteIdx(a) - key.tonic) - mod12(noteIdx(b) - key.tonic)),
    safeQualities: [...quals].sort((a, b) => order(a) - order(b)),
    safeMidiNotes,
  };
}

const noteIdx = (n: NoteName): number =>
  ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'].indexOf(n);

/** Palette qualities that are clash-free for a given root under this bar (for live helper LEDs). */
export function safeQualitiesForRoot(melody: readonly MelodyNote[], bar: BarIndex, root: NoteName): ChordQuality[] {
  const notes = barNotes(melody, bar);
  return PALETTE_QUALITIES.filter((q) => findClashes(paletteChord(root, q), notes).length === 0);
}
