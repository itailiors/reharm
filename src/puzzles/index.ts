import type { BarIndex, ConsonantHint, DailyPuzzle, MelodyNote, NoteName } from '../types';
import bankJson from './bank.json';
import {
  type KeyContext, consonantHint, keyLabel, makeKey, midiLabel, parseChord, parseMidi, toChordInput, toNoteName,
} from '../theory';

export interface BankEntry {
  id: string;
  tonic: string;
  mode: 'major' | 'minor';
  bpm: number;
  anchorBar: number;
  anchor: string;
  bars: string[];
}

export const PUZZLE_BANK: readonly BankEntry[] = (bankJson as { puzzles: BankEntry[] }).puzzles;

/** Puzzle #1 launches on this UTC date. */
export const EPOCH_ISO = '2026-11-25';
const DAY_MS = 86_400_000;
const EPOCH_MS = Date.parse(`${EPOCH_ISO}T00:00:00Z`);

/** Parse bar notation ("E5/1.5 D5/0.5 r/1 G4/1") into notes. Throws on malformed data. */
export function parseBar(bar: string, barIndex: BarIndex, idPrefix: string): Omit<MelodyNote, 'yNorm'>[] {
  const out: Omit<MelodyNote, 'yNorm'>[] = [];
  let beat = 0;
  for (const tok of bar.trim().split(/\s+/)) {
    const [pitch, durStr] = tok.split('/');
    const dur = Number(durStr);
    if (!pitch || !Number.isFinite(dur) || dur <= 0) throw new Error(`Bad token "${tok}"`);
    if (pitch !== 'r') {
      const midi = parseMidi(pitch);
      if (midi === null) throw new Error(`Bad pitch "${pitch}"`);
      const onStrongBeat = (beat === 0 || beat === 2) && dur >= 0.5;
      out.push({
        id: `${idPrefix}b${barIndex}n${out.length}`,
        midi,
        pitchLabel: midiLabel(midi),
        barIndex,
        startBeat: beat,
        durationBeats: dur,
        isAccent: onStrongBeat || dur >= 1.5,
      });
    }
    beat += dur;
  }
  if (Math.abs(beat - 4) > 1e-6) throw new Error(`Bar ${barIndex + 1} sums to ${beat} beats, expected 4`);
  return out;
}

export function buildMelody(entry: BankEntry): MelodyNote[] {
  const raw = entry.bars.flatMap((b, i) => parseBar(b, i as BarIndex, `${entry.id}-`));
  const lo = Math.min(...raw.map((n) => n.midi));
  const hi = Math.max(...raw.map((n) => n.midi));
  const span = Math.max(1, hi - lo);
  return raw.map((n) => ({ ...n, yNorm: (n.midi - lo) / span }));
}

export const keyForEntry = (entry: BankEntry): KeyContext => makeKey(toNoteName(entry.tonic)!, entry.mode);

export function buildPuzzle(entry: BankEntry, puzzleNumber: number, dateISO: string): DailyPuzzle {
  const key = keyForEntry(entry);
  const melody = buildMelody(entry);
  const anchor = parseChord(entry.anchor);
  if (!anchor) throw new Error(`Bad anchor "${entry.anchor}" in ${entry.id}`);
  const hints = {} as Record<BarIndex, ConsonantHint>;
  for (const b of [0, 1, 2, 3] as BarIndex[]) hints[b] = consonantHint(key, melody, b);
  return {
    puzzleNumber,
    dateISO,
    keyLabel: keyLabel(key),
    bpm: entry.bpm,
    lockedBarIndex: entry.anchorBar as BarIndex,
    anchorChord: toChordInput(anchor),
    melody,
    consonantHintsByBar: hints,
    tonic: toNoteName(entry.tonic) as NoteName,
    mode: entry.mode,
    bankId: entry.id,
  };
}

// ---------------------------------------------------------------------------
// Deterministic UTC daily selection
// ---------------------------------------------------------------------------

/** mulberry32 PRNG — tiny, deterministic, good enough for shuffles. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cyclePermutation(cycle: number, n: number): number[] {
  const rand = mulberry32(0x5eed + cycle * 7919);
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  return perm;
}

/**
 * Bank index for a puzzle number. Every cycle of N days plays each melody exactly once
 * in a seeded order; a cycle never opens with the melody that closed the previous one.
 */
export function bankIndexFor(puzzleNumber: number, bankSize = PUZZLE_BANK.length): number {
  const n = Math.max(1, Math.floor(puzzleNumber)) - 1;
  const cycle = Math.floor(n / bankSize);
  const pos = n % bankSize;
  const perm = cyclePermutation(cycle, bankSize);
  if (cycle > 0 && bankSize > 1) {
    const prevLast = cyclePermutation(cycle - 1, bankSize)[bankSize - 1];
    if (perm[0] === prevLast) [perm[0], perm[1]] = [perm[1]!, perm[0]!];
  }
  return perm[pos]!;
}

export const utcDateISO = (d: Date): string => d.toISOString().slice(0, 10);

export function puzzleNumberForDate(d: Date): number {
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.max(1, Math.floor((dayStart - EPOCH_MS) / DAY_MS) + 1);
}

export const dateISOForPuzzle = (n: number): string => utcDateISO(new Date(EPOCH_MS + (n - 1) * DAY_MS));

const cache = new Map<number, DailyPuzzle>();

export function getPuzzleByNumber(n: number): DailyPuzzle {
  const num = Math.max(1, Math.floor(n));
  let p = cache.get(num);
  if (!p) {
    p = buildPuzzle(PUZZLE_BANK[bankIndexFor(num)]!, num, dateISOForPuzzle(num));
    cache.set(num, p);
  }
  return p;
}

export const getDailyPuzzle = (now: Date = new Date()): DailyPuzzle => getPuzzleByNumber(puzzleNumberForDate(now));

/** Theory key context for a built puzzle. */
export const puzzleKey = (p: DailyPuzzle): KeyContext => makeKey(p.tonic ?? 'C', p.mode ?? 'major');
