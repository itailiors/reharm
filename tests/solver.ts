/** Test-only brute-force helpers over the puzzle bank. */
import type { BarIndex, DailyPuzzle } from '../src/types';
import {
  type Chord, type PuzzleContext, colorize, findClashes, barNotes, makeChord, parseChord, scoreProgression, typeBySuffix,
} from '../src/theory';
import { puzzleKey } from '../src/puzzles';

export const ctxFor = (p: DailyPuzzle): PuzzleContext => ({
  key: puzzleKey(p),
  melody: p.melody,
  lockedBarIndex: p.lockedBarIndex,
});

export function legalCandidates(p: DailyPuzzle, bar: BarIndex, suffixes: string[]): Chord[] {
  const notes = barNotes(p.melody, bar);
  const out: Chord[] = [];
  for (let root = 0; root < 12; root++) {
    for (const s of suffixes) {
      const c = makeChord(root, typeBySuffix(s));
      if (findClashes(c, notes).length === 0) out.push(colorize(c, notes));
    }
  }
  return out;
}

export function bestProgression(p: DailyPuzzle, suffixes = ['', 'm', 'Maj7', 'm7', '7']) {
  const ctx = ctxFor(p);
  const anchor = parseChord(p.anchorChord.symbol)!;
  const lists = ([0, 1, 2, 3] as BarIndex[]).map((b) =>
    b === p.lockedBarIndex ? [anchor] : legalCandidates(p, b, suffixes),
  );
  let best = { total: -1, symbols: [] as string[] };
  for (const a of lists[0]!) for (const b of lists[1]!) for (const c of lists[2]!) for (const d of lists[3]!) {
    const s = scoreProgression(ctx, [a, b, c, d]);
    if (s.total > best.total) best = { total: s.total, symbols: [a, b, c, d].map((x) => x.symbol) };
  }
  return best;
}
