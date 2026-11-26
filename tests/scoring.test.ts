import { describe, expect, it } from 'vitest';
import type { BadgeId, BarIndex } from '../src/types';
import { BADGE_IDS } from '../src/types';
import {
  type Chord, DEVICE_PLAIN, analyzeProgression, colorize, evaluateBar, makeChord, parseChord, percentileFor, rarityScore,
  scoreProgression, suggestFixes, tierForTotal, typeBySuffix, barNotes, findClashes,
} from '../src/theory';
import { type BankEntry, PUZZLE_BANK, buildPuzzle, getPuzzleByNumber, mulberry32 } from '../src/puzzles';
import { ctxFor } from './solver';

const C = (s: string): Chord => {
  const c = parseChord(s);
  if (!c) throw new Error(`unparsable ${s}`);
  return c;
};
const fixture = (entry: Partial<BankEntry> & Pick<BankEntry, 'bars'>) =>
  buildPuzzle({ id: 'fx', tonic: 'C', mode: 'major', bpm: 96, anchorBar: 0, anchor: 'CMaj7', ...entry }, 1, '2026-11-25');
const bank = (id: string) => {
  const i = PUZZLE_BANK.findIndex((e) => e.id === id);
  return buildPuzzle(PUZZLE_BANK[i]!, i + 1, '2026-11-25');
};
const score = (p: ReturnType<typeof fixture>, syms: string[]) => scoreProgression(ctxFor(p), syms.map(C));
const badgeIds = (s: { unlockedBadges: { id: BadgeId }[] }) => s.unlockedBadges.map((b) => b.id);

/** Crafted showcase: borrowed mediant, chromatic bass and #11 / 9 / 13 melody colour. */
const TRENCH = fixture({
  anchor: 'CMaj9',
  bars: ['E5/2 G5/2', 'A5/2 F5/2', 'E5/2 B4/2', 'G5/2 Bb4/2'],
});
const TRENCH_MIX = ['CMaj9', 'EbMaj9', 'Dm9', 'Db9'];

describe('Krillion 3-axis scorer', () => {
  it('sums three bounded axes into 0..100', () => {
    for (const syms of [TRENCH_MIX, ['CMaj9', 'Ab', 'Dm7', 'G7'], ['CMaj9', 'F', 'C', 'G']]) {
      const s = score(TRENCH, syms);
      expect(s.total).toBe(s.rarity + s.melodyColor + s.bassFlow);
      expect(s.rarity).toBeGreaterThanOrEqual(0);
      expect(s.rarity).toBeLessThanOrEqual(50);
      expect(s.melodyColor).toBeLessThanOrEqual(25);
      expect(s.bassFlow).toBeLessThanOrEqual(25);
      expect(s.percentileLabel).toMatch(/^Top \d+% Spice$/);
    }
  });

  it('a crafted functional deep reharm reaches the Jazz Trench (95+)', () => {
    const s = score(TRENCH, TRENCH_MIX);
    expect(s.rarity).toBe(50);
    expect(s.melodyColor).toBe(25);
    expect(s.total).toBeGreaterThanOrEqual(95);
    expect(s.overallTier).toBe('deep-reharm');
    expect(s.axisSummaries.rarity).toMatch(/Tritone Sub|Chromatic Mediant/);
    expect(s.axisSummaries.bassFlow).toContain('C → Eb → D → Db');
  });

  it('melody colour rewards extensions over doubled roots', () => {
    const p = fixture({ bars: ['C5/4', 'F5/4', 'G5/4', 'D5/4'] });
    const roots = score(p, ['CMaj7', 'F', 'G', 'Dm']);
    const color = score(p, ['CMaj7', 'Db7', 'Eb', 'C']);
    expect(color.melodyColor).toBeGreaterThan(roots.melodyColor);
    expect(roots.melodyColor).toBe(0);
  });

  it('bass flow rewards stepwise/chromatic motion over tritone leaps', () => {
    const p = fixture({ bars: ['G4/4', 'G4/4', 'G4/4', 'G4/4'] });
    const smooth = score(p, ['C', 'Bø7', 'Bb', 'A7sus4']);
    const leapy = score(p, ['C', 'Gb7#11', 'C', 'Gb7#11']);
    expect(smooth.bassFlow).toBeGreaterThan(leapy.bassFlow);
    expect(smooth.avgBassSemitones).toBe(1);
  });

  it('percentile is monotonic and maps to the four spice tiers', () => {
    let prev = 100;
    for (let t = 0; t <= 100; t++) {
      const p = percentileFor(t);
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
    expect(percentileFor(91)).toBe(4);
    expect(tierForTotal(49)).toBe('radio-safe');
    expect(tierForTotal(50)).toBe('jazz-standard');
    expect(tierForTotal(75)).toBe('modal-interchange');
    expect(tierForTotal(90)).toBe('deep-reharm');
  });
});

describe('anti-cheese: rarity is coupled to functional resolutions', () => {
  it('jazz-salad stacking of altered/dim/aug chords scores no rarity', () => {
    const p = bank('glass-elevator');
    const s = score(p, ['CMaj7', 'Dbdim7', 'Gb7alt', 'Eaug']);
    expect(s.rarity).toBe(0);
    expect(s.total).toBeLessThan(60);
    expect(s.axisSummaries.rarity).toMatch(/−\d+: .*\(Bar \d\)/);
  });

  it('names the bars behind a rarity penalty (playtest: "−12 unresolved" gave no fix)', () => {
    const p = getPuzzleByNumber(3);
    const s = scoreProgression(ctxFor(p), ['EbMaj7', 'Cø7', 'Db7#11', 'E7alt'].map(C));
    expect(s.axisSummaries.rarity).toContain('−12: Cø7 (Bar 2) and Db7#11 (Bar 3) are outside the key with no move in or out (−6 each)');
  });

  it('the same altered dominant earns Deep points only when it resolves', () => {
    const key = ctxFor(bank('glass-elevator')).key;
    const resolving = rarityScore(analyzeProgression(key, ['CMaj7', 'Am7', 'Dm7', 'Db7alt'].map(C)));
    const dangling = rarityScore(analyzeProgression(key, ['CMaj7', 'Db7alt', 'Am7', 'Dm7'].map(C)));
    expect(resolving.topTier).toBe('deep-reharm');
    expect(dangling.topTier).not.toBe('deep-reharm');
    expect(resolving.rarity).toBeGreaterThan(dangling.rarity + 20);
  });

  it('any progression without a functional device is capped well below 95', () => {
    const exotic = ['dim7', 'aug', '7alt', 'Maj7#5', '7#5', 'mMaj7', 'sus2', '7b9b13'];
    const rand = mulberry32(42);
    for (const [i, entry] of PUZZLE_BANK.entries()) {
      const p = buildPuzzle(entry, i + 1, 'x');
      const ctx = ctxFor(p);
      const anchor = C(p.anchorChord.symbol);
      const pools = ([0, 1, 2, 3] as BarIndex[]).map((b) => {
        if (b === p.lockedBarIndex) return [anchor];
        const pool: Chord[] = [];
        for (let r = 0; r < 12; r++) for (const s of exotic) {
          const c = makeChord(r, typeBySuffix(s));
          if (!findClashes(c, barNotes(p.melody, b)).length) pool.push(c);
        }
        return pool;
      });
      for (let n = 0; n < 60; n++) {
        const prog = pools.map((pool) => pool[Math.floor(rand() * pool.length)]!);
        const s = scoreProgression(ctx, prog);
        if (s.analysis.devices.length === 0) {
          expect(s.rarity).toBeLessThanOrEqual(6);
          expect(s.total).toBeLessThan(60);
        }
      }
    }
  });

  it('a musical deep reharm outscores a plain pop loop, which outscores salad', () => {
    const p = bank('glass-elevator');
    const deep = score(p, ['CMaj7', 'AbMaj7', 'EbMaj7', 'Db7']);
    const pop = score(p, ['CMaj7', 'Am', 'F', 'G']);
    const salad = score(p, ['CMaj7', 'Dbdim7', 'Gb7alt', 'Eaug']);
    expect(deep.total).toBeGreaterThan(pop.total);
    expect(pop.rarity).toBeGreaterThan(salad.rarity);
    expect(pop.overallTier).toBe('radio-safe');
  });
});

describe('all 8 badge triggers', () => {
  const trench = badgeIds(score(TRENCH, TRENCH_MIX));

  it.each<[BadgeId]>([
    ['tritone-sub'], ['modal-borrow'], ['chromatic-mediant'], ['sharp11-melody'], ['smooth-bass'], ['jazz-trench'],
  ])('%s unlocks on the crafted deep mix', (id) => {
    expect(trench).toContain(id);
  });

  it('backdoor-dominant unlocks for bVII7 → I', () => {
    const p = bank('velvet-hour');
    expect(badgeIds(score(p, ['FMaj7', 'Gm7', 'Dm7', 'Eb7']))).toContain('backdoor-dominant');
  });

  it('radio-safe unlocks for a clean diatonic cadence and nothing exotic', () => {
    const ids = badgeIds(score(bank('glass-elevator'), ['CMaj7', 'Am', 'F', 'G']));
    expect(ids).toContain('radio-safe');
    expect(ids).not.toContain('tritone-sub');
    expect(ids).not.toContain('jazz-trench');
  });

  it('radio-safe is withheld when a chromatic chord appears', () => {
    expect(badgeIds(score(bank('glass-elevator'), ['CMaj7', 'Ab', 'F', 'G']))).not.toContain('radio-safe');
  });

  it('every badge id maps to a bundled asset name', () => {
    expect(BADGE_IDS).toHaveLength(8);
  });
});

describe('live bar evaluation, colorize & suggestions', () => {
  const p = bank('glass-elevator');
  const ctx = ctxFor(p);
  const anchor = C(p.anchorChord.symbol);

  it('names the melody-implied extension (Db7 under G becomes Db7#11)', () => {
    expect(colorize(C('Db7'), barNotes(p.melody, 2)).symbol).toBe('Db7#11');
    expect(colorize(C('CMaj7'), [{ id: 'x', midi: 62, pitchLabel: 'D4', barIndex: 0, startBeat: 0, durationBeats: 2, yNorm: 0, isAccent: true }]).symbol).toBe('CMaj9');
  });

  it('a clash returns a non-punishing reason plus up to 3 legal suggestions', () => {
    const ev = evaluateBar(ctx, [anchor, null, null, null], 1, C('BMaj7'));
    expect(ev.state).toBe('clash');
    expect(ev.clashReason).toMatch(/Clash on Bar 2: C melody rubs against B in BMaj7/);
    expect(ev.suggestions.length).toBeGreaterThan(0);
    expect(ev.suggestions.length).toBeLessThanOrEqual(3);
    for (const s of ev.suggestions) {
      expect(findClashes(C(s), barNotes(p.melody, 1))).toHaveLength(0);
    }
    expect(new Set(ev.suggestions).size).toBe(ev.suggestions.length);
  });

  it('suggestions favour constructive functional moves', () => {
    const sugg = suggestFixes(ctx, [anchor, C('AbMaj7'), C('EbMaj7'), null], 3, C('BMaj7'));
    expect(sugg.length).toBe(3);
    expect(sugg.some((s) => s.startsWith('Db7') || s.startsWith('G'))).toBe(true);
  });

  it('a legal chord reports its tier and colour', () => {
    const ev = evaluateBar(ctx, [anchor, C('AbMaj7'), null, null], 2, C('Db7#11'));
    expect(ev.state).toBe('legal');
    expect(ev.message).toContain('Db7#11');
    expect(ev.message).toMatch(/#11/);
  });

  it('explains functional devices in plain English for non-jazz players', () => {
    const a = analyzeProgression(ctxFor(TRENCH).key, ['CMaj7', 'Dm7', 'G7', 'Db7'].map(C));
    expect(a.bars[2]!.deviceLabel).toMatch(/Cadence|→/);
    expect(a.bars[2]!.devicePlain).toBeTruthy();
    const s = score(TRENCH, TRENCH_MIX);
    expect(s.axisSummaries.rarity).toMatch(/ — (a sneaky half-step slide home|a cinematic colour shift)/);
  });

  it('every device kind has a plain-English gloss', () => {
    const kinds = ['tritone-sub', 'backdoor-dominant', 'chromatic-mediant', 'modal-borrow', 'ii-v', 'secondary-dominant',
      'passing-diminished', 'deceptive-cadence', 'authentic-cadence', 'plagal-cadence', 'predominant'] as const;
    for (const k of kinds) expect(DEVICE_PLAIN[k].length).toBeGreaterThan(5);
  });
});
