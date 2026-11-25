import { type Chord, bassPc } from './chords';
import { mod12 } from './pitch';

export interface Voicing {
  /** Bass note (C2..B2). */
  bass: number;
  /** Rhodes upper-structure notes, ascending. */
  upper: number[];
}

const LOW = 52; // E3
const HIGH = 74; // D5
const CENTER = 62;

/** Upper-structure pitch classes: drop the root for 5+ note chords, drop the 5th if still crowded. */
function upperPcs(chord: Chord): number[] {
  let ints = [...chord.type.intervals];
  if (ints.length >= 5) ints = ints.filter((i) => i !== 0);
  if (ints.length > 5) ints = ints.filter((i) => i !== 7);
  return [...new Set(ints.map((i) => mod12(chord.root + i)))];
}

function stack(pcs: number[], startMidi: number): number[] {
  const out: number[] = [];
  let cur = startMidi - 1;
  for (const pc of pcs) {
    let n = cur + 1;
    while (mod12(n) !== pc) n++;
    out.push(n);
    cur = n;
  }
  return out;
}

const centroid = (ns: number[]) => ns.reduce((s, n) => s + n, 0) / ns.length;

/** Voice-led close voicing: picks the inversion nearest the previous chord (or the mid register). */
export function voiceChord(chord: Chord, prev?: number[] | null, custom?: number[]): Voicing {
  const b = bassPc(chord);
  const bass = 36 + b; // C2..B2
  if (custom && custom.length) return { bass, upper: [...custom].sort((x, y) => x - y) };
  const pcs = upperPcs(chord);
  let best: number[] | null = null;
  let bestCost = Infinity;
  for (let r = 0; r < pcs.length; r++) {
    const rot = [...pcs.slice(r), ...pcs.slice(0, r)];
    for (let start = LOW; start < LOW + 12; start++) {
      if (mod12(start) !== rot[0]) continue;
      const notes = stack(rot, start);
      if (notes[notes.length - 1]! > HIGH) continue;
      let cost: number;
      if (prev && prev.length) {
        cost = notes.reduce((s, n) => s + Math.min(...prev.map((p) => Math.abs(p - n))), 0);
      } else {
        cost = Math.abs(centroid(notes) - CENTER) * 2;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = notes;
      }
    }
  }
  return { bass, upper: best ?? stack(pcs, 55) };
}
