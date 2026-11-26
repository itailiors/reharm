/**
 * Chord play styles: how one bar's voicing is spread over 4 beats.
 * Pure (no Tone.js) so the audio engine and the MIDI export play the exact same notes.
 */
import type { Voicing } from '../theory';
import type { UserSettings } from '../types';

export type ChordStyle = UserSettings['chordStyle'];
export const CHORD_STYLES: { id: ChordStyle; label: string; hint: string }[] = [
  { id: 'block', label: 'Block', hint: 'all notes held together for the whole bar' },
  { id: 'arpeggio', label: 'Arpeggio', hint: 'notes one at a time, up then back down' },
  { id: 'outside-in', label: 'Outside-in', hint: 'lowest, highest, then working toward the middle' },
  { id: 'random', label: 'Random', hint: 'the chord’s notes in a shuffled order' },
  { id: 'bach', label: 'Bach', hint: 'low notes held, upper notes broken in quick 16ths, like a Bach prelude' },
];

export interface PatternNote {
  midi: number;
  /** Beat offset inside the bar (0..4). */
  start: number;
  /** Length in beats. */
  dur: number;
}

const BAR = 4;
/** Notes ring like a half-pedalled piano, but never past the barline. */
const ring = (start: number, beats: number) => Math.min(beats, BAR - start) * 0.97;

/** Fill `slots` evenly-spaced hits from a note order, cycling it. */
function cycle(order: number[], slots: number, sustain: number): PatternNote[] {
  const step = BAR / slots;
  return Array.from({ length: slots }, (_, i) => {
    const start = i * step;
    return { midi: order[i % order.length]!, start, dur: ring(start, sustain) };
  });
}

/** Lowest, highest, 2nd lowest, 2nd highest, … */
export function outsideInOrder(notes: readonly number[]): number[] {
  const out: number[] = [];
  let lo = 0;
  let hi = notes.length - 1;
  while (lo <= hi) {
    out.push(notes[lo++]!);
    if (lo <= hi) out.push(notes[hi--]!);
  }
  return out;
}

/**
 * Upper-structure notes for one bar in the given style. The bass note is not included
 * (it always lands on the downbeat). `rng` is only used by 'random'.
 */
export function chordPattern(voicing: Voicing, style: ChordStyle, rng: () => number = Math.random): PatternNote[] {
  const up = [...voicing.upper].sort((a, b) => a - b);
  if (!up.length) return [];
  switch (style) {
    case 'arpeggio': {
      // Up then back down (no repeated top or bottom), 8ths.
      const order = up.length > 2 ? [...up, ...up.slice(1, -1).reverse()] : up;
      return cycle(order, 8, 2);
    }
    case 'outside-in':
      return cycle(outsideInOrder(up), 8, 2);
    case 'random': {
      const out: PatternNote[] = [];
      let last = -1;
      for (let i = 0; i < 8; i++) {
        let idx = Math.floor(rng() * up.length);
        if (up.length > 1 && idx === last) idx = (idx + 1) % up.length;
        last = idx;
        const start = i / 2;
        out.push({ midi: up[idx]!, start, dur: ring(start, 1.5) });
      }
      return out;
    }
    case 'bach': {
      // Prelude-style figuration: per half bar, two low notes held, the upper notes broken in 16ths.
      const low = up.slice(0, up.length >= 4 ? 2 : Math.min(1, up.length - 1));
      const top = up.slice(low.length);
      const out: PatternNote[] = [];
      for (const half of [0, 2]) {
        low.forEach((midi, i) => {
          const start = half + i * 0.25;
          out.push({ midi, start, dur: (2 - i * 0.25) * 0.97 });
        });
        for (let s = low.length; s < 8; s++) {
          const start = half + s * 0.25;
          out.push({ midi: top[(s - low.length) % top.length]!, start, dur: ring(start, 0.4) });
        }
      }
      return out;
    }
    default: // 'block' (and any unknown stored value)
      return up.map((midi) => ({ midi, start: 0, dur: BAR * 0.97 }));
  }
}

/** Small deterministic RNG (mulberry32) for reproducible 'random' MIDI exports. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
