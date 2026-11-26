import { describe, expect, it } from 'vitest';
import type { BarIndex } from '../src/types';
import {
  EPOCH_ISO, PUZZLE_BANK, bankIndexFor, buildPuzzle, dateISOForPuzzle, getDailyPuzzle, getPuzzleByNumber,
  puzzleNumberForDate, parseBar,
} from '../src/puzzles';
import {
  analyzeProgression, findClashes, barNotes, isDiatonic, makeChord, parseChord, typeBySuffix, type Chord,
} from '../src/theory';
import { ctxFor, legalCandidates } from './solver';

const PALETTE = ['', 'm', '7', 'Maj7', 'm7', 'ø7', 'dim7', 'sus4', 'aug', '7alt'];
const puzzles = PUZZLE_BANK.map((e, i) => buildPuzzle(e, i + 1, '2026-11-25'));
const openBars = (lock: number) => ([0, 1, 2, 3] as BarIndex[]).filter((b) => b !== lock);

describe('curated melody bank', () => {
  it('has 30+ uniquely named melodies', () => {
    expect(PUZZLE_BANK.length).toBeGreaterThanOrEqual(30);
    expect(new Set(PUZZLE_BANK.map((e) => e.id)).size).toBe(PUZZLE_BANK.length);
  });

  it('varies keys, modes, tempos and anchor positions', () => {
    expect(new Set(PUZZLE_BANK.map((e) => `${e.tonic} ${e.mode}`)).size).toBeGreaterThanOrEqual(12);
    expect(new Set(PUZZLE_BANK.map((e) => e.mode))).toEqual(new Set(['major', 'minor']));
    expect(new Set(PUZZLE_BANK.map((e) => e.anchorBar)).size).toBeGreaterThanOrEqual(2);
    const bpms = PUZZLE_BANK.map((e) => e.bpm);
    expect(Math.max(...bpms) - Math.min(...bpms)).toBeGreaterThanOrEqual(40);
  });

  it('rejects malformed bars', () => {
    expect(() => parseBar('C4/1 D4/1', 0, 'x')).toThrow(/sums to 2/);
    expect(() => parseBar('H4/4', 0, 'x')).toThrow(/Bad pitch/);
  });

  it.each(puzzles.map((p) => [p.bankId!, p] as const))('%s is well-formed', (_id, p) => {
    expect(new Set(p.melody.map((n) => n.id)).size).toBe(p.melody.length);
    for (const n of p.melody) {
      expect(n.yNorm).toBeGreaterThanOrEqual(0);
      expect(n.yNorm).toBeLessThanOrEqual(1);
      expect(n.midi).toBeGreaterThanOrEqual(60);
      expect(n.midi).toBeLessThanOrEqual(84);
    }
    for (const b of [0, 1, 2, 3] as BarIndex[]) {
      expect(p.melody.some((n) => n.barIndex === b && n.isAccent)).toBe(true);
      expect(p.consonantHintsByBar[b].safeRoots.length).toBeGreaterThan(0);
    }
    // The anchor chord itself must be legal under its bar.
    const anchor = parseChord(p.anchorChord.symbol)!;
    expect(findClashes(anchor, barNotes(p.melody, p.lockedBarIndex))).toHaveLength(0);
  });

  it.each(puzzles.map((p) => [p.bankId!, p] as const))('%s admits pop, jazz and deep solutions', (_id, p) => {
    const ctx = ctxFor(p);
    const anchor = parseChord(p.anchorChord.symbol)!;
    const pools = ([0, 1, 2, 3] as BarIndex[]).map((b) =>
      b === p.lockedBarIndex ? [anchor] : legalCandidates(p, b, PALETTE),
    );
    // Breadth: every open bar has many legal palette chords
    for (const b of openBars(p.lockedBarIndex)) expect(pools[b]!.length).toBeGreaterThanOrEqual(20);

    // Pop: every open bar takes a legal diatonic triad
    for (const b of openBars(p.lockedBarIndex)) {
      // (triad family: colorize may name an add9 the melody implies)
      expect(pools[b]!.some((c) => isDiatonic(ctx.key, c) && (c.type.family === 'Maj' || c.type.family === 'm'))).toBe(true);
    }

    // Jazz & Deep: look for a legal adjacent pair forming the device
    const pairKinds = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      for (const a of pools[i]!) for (const b of pools[j]!) {
        for (const d of analyzeProgression(ctx.key, pairArr(i, j, a, b)).devices) pairKinds.add(d.kind);
      }
    }
    expect(['ii-v', 'secondary-dominant', 'authentic-cadence'].some((k) => pairKinds.has(k))).toBe(true);
    expect(['tritone-sub', 'backdoor-dominant'].some((k) => pairKinds.has(k))).toBe(true);
    expect(pairKinds.has('modal-borrow')).toBe(true);
  });
});

function pairArr(i: number, j: number, a: Chord, b: Chord): (Chord | null)[] {
  const arr: (Chord | null)[] = [null, null, null, null];
  arr[i] = a;
  arr[j] = b;
  return arr;
}

// `new Date(y, monthIndex, d, h, min)` is LOCAL time, so these hold in any test-runner time zone.
describe('deterministic local-date daily selector', () => {
  it('numbers puzzles from the launch epoch', () => {
    expect(EPOCH_ISO).toBe('2026-11-25');
    expect(puzzleNumberForDate(new Date(2026, 10, 25, 0, 0))).toBe(1);
    expect(puzzleNumberForDate(new Date(2026, 10, 25, 23, 59, 59))).toBe(1);
    expect(puzzleNumberForDate(new Date(2026, 10, 26, 0, 0))).toBe(2);
    expect(puzzleNumberForDate(new Date(2027, 0, 5, 12, 0))).toBe(42);
    expect(puzzleNumberForDate(new Date(2020, 0, 1))).toBe(1);
    expect(dateISOForPuzzle(42)).toBe('2027-01-05');
  });

  it('rolls over at local midnight, not UTC midnight', () => {
    expect(puzzleNumberForDate(new Date(2026, 11, 1, 23, 59))).toBe(7);
    expect(puzzleNumberForDate(new Date(2026, 11, 2, 0, 1))).toBe(8);
  });

  it('counts calendar days across DST changes', () => {
    // Spring-forward / fall-back days are 23h / 25h in many zones; the count must not drift.
    expect(puzzleNumberForDate(new Date(2027, 2, 29, 12)) - puzzleNumberForDate(new Date(2027, 2, 27, 12))).toBe(2);
    expect(puzzleNumberForDate(new Date(2027, 10, 8, 0, 30)) - puzzleNumberForDate(new Date(2027, 10, 6, 23, 30))).toBe(2);
  });

  it('is deterministic', () => {
    const d = new Date(2027, 2, 14, 0, 5);
    expect(getDailyPuzzle(d).bankId).toBe(getDailyPuzzle(new Date(2027, 2, 14, 23, 55)).bankId);
    expect(getPuzzleByNumber(42).puzzleNumber).toBe(42);
    expect(getPuzzleByNumber(42).dateISO).toBe('2027-01-05');
    expect(bankIndexFor(77)).toBe(bankIndexFor(77));
  });

  it('plays every melody exactly once per cycle, with no repeat across cycle boundaries', () => {
    const n = PUZZLE_BANK.length;
    for (let cycle = 0; cycle < 6; cycle++) {
      const seen = new Set<number>();
      for (let k = 1; k <= n; k++) seen.add(bankIndexFor(cycle * n + k));
      expect(seen.size).toBe(n);
    }
    for (let num = 1; num < n * 8; num++) expect(bankIndexFor(num)).not.toBe(bankIndexFor(num + 1));
  });

  it('builds the same puzzle object for the same number (cached)', () => {
    expect(getPuzzleByNumber(5)).toBe(getPuzzleByNumber(5));
    expect(makeChord(0, typeBySuffix('Maj7')).symbol).toBe('CMaj7');
  });
});
