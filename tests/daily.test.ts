import { describe, expect, it } from 'vitest';
import {
  DAILY_KEY, buildDoneRecord, buildProgressRecord, labMoveFor, localDateKey, shouldReplace,
} from '../src/share/daily';
import { type HistoryEntry, type KV, ReharmStore, memoryKV } from '../src/share/storage';

const entry = (n: number, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  puzzleNumber: n,
  dateISO: '2026-11-25',
  symbols: ['CMaj7', 'AbMaj7', 'Db7#11', 'CMaj9'],
  total: 91,
  rarity: 45,
  melodyColor: 24,
  bassFlow: 22,
  tier: 'deep-reharm',
  percentileLabel: 'Top 4% Spice',
  badges: ['tritone-sub', 'smooth-bass'],
  barTiers: ['radio-safe', 'deep-reharm', 'deep-reharm', 'radio-safe'],
  ...over,
});

// 23:30 local on Nov 25 (Date(y, m, d, h, min) is local time).
const lateNight = new Date(2026, 10, 25, 23, 30);
const stats = { currentStreak: 5, bestScore: 96, played: 14 };
const readDaily = (kv: KV) => JSON.parse(kv.getItem(DAILY_KEY) ?? 'null');

describe('localDateKey', () => {
  it('uses the local calendar date, zero-padded', () => {
    expect(localDateKey(lateNight)).toBe('2026-11-25');
    expect(localDateKey(new Date(2027, 0, 3, 0, 5))).toBe('2027-01-03');
  });

  it('follows local midnight, not UTC', () => {
    const d = new Date(2026, 10, 26, 0, 1);
    expect(localDateKey(d)).toBe('2026-11-26');
    expect(localDateKey(new Date(2026, 10, 25, 23, 59))).toBe('2026-11-25');
  });
});

describe('buildDoneRecord', () => {
  it('matches the data-contract example', () => {
    const r = buildDoneRecord(entry(42), stats, lateNight);
    expect(r).toEqual({
      v: 1,
      gameId: 'reharm',
      dateKey: '2026-11-25',
      puzzleNo: 42,
      status: 'done',
      score: 91,
      scoreLabel: '91/100 · Top 4% Spice',
      tierIcon: '▲',
      streak: 5,
      bestScore: 96,
      playedCount: 14,
      shareText: '🎛️ REHARM: 91/100 · ▲ Top 4% Spice',
      labMove: { slug: 'tritone-sub', label: 'Tritone Sub' },
      updatedAt: lateNight.getTime(),
    });
    expect(JSON.stringify(r).length).toBeLessThan(2048);
  });

  it('uses the right glyph per tier', () => {
    const icon = (tier: HistoryEntry['tier']) => buildDoneRecord(entry(1, { tier }), stats, lateNight).tierIcon;
    expect([icon('radio-safe'), icon('jazz-standard'), icon('modal-interchange'), icon('deep-reharm')]).toEqual(['●', '◆', '◐', '▲']);
  });
});

describe('labMoveFor (badge → Reharm Lab slug)', () => {
  it('maps each theory badge to its canonical slug', () => {
    expect(labMoveFor(['tritone-sub'])).toEqual({ slug: 'tritone-sub', label: 'Tritone Sub' });
    expect(labMoveFor(['backdoor-dominant'])).toEqual({ slug: 'backdoor-dominant', label: 'Backdoor Dominant' });
    expect(labMoveFor(['modal-borrow'])).toEqual({ slug: 'modal-interchange', label: 'Modal Interchange' });
    expect(labMoveFor(['chromatic-mediant'])).toEqual({ slug: 'chromatic-mediant', label: 'Chromatic Mediant' });
  });

  it('picks by priority and ignores non-theory badges', () => {
    expect(labMoveFor(['chromatic-mediant', 'modal-borrow', 'backdoor-dominant'])?.slug).toBe('backdoor-dominant');
    expect(labMoveFor(['smooth-bass', 'radio-safe', 'sharp11-melody', 'jazz-trench'])).toBeNull();
    expect(labMoveFor([])).toBeNull();
  });
});

describe('buildProgressRecord', () => {
  it('reports in_progress with a bar count', () => {
    const r = buildProgressRecord(7, 2, stats, lateNight);
    expect(r).toMatchObject({ status: 'in_progress', score: null, scoreLabel: '2/3 bars', progressLabel: '2/3 bars', puzzleNo: 7, dateKey: '2026-11-25', streak: 5 });
  });

  it('clamps and treats 0 bars as new', () => {
    expect(buildProgressRecord(7, 9, stats, lateNight).progressLabel).toBe('3/3 bars');
    expect(buildProgressRecord(7, 0, stats, lateNight).status).toBe('new');
  });

  it('has a null best score before any solve', () => {
    expect(buildProgressRecord(1, 1, { currentStreak: 0, bestScore: 0, played: 0 }, lateNight).bestScore).toBeNull();
  });
});

describe('shouldReplace', () => {
  const done = buildDoneRecord(entry(3), stats, lateNight);
  const prog = buildProgressRecord(4, 1, stats, lateNight);
  it('never regresses a finished local day', () => {
    expect(shouldReplace(done, prog)).toBe(false);
    expect(shouldReplace(done, buildProgressRecord(3, 0, stats, lateNight))).toBe(false);
  });
  it('writes progress over an older day but not an empty "new"', () => {
    const yesterday = { ...done, dateKey: '2026-11-24' };
    expect(shouldReplace(yesterday, prog)).toBe(true);
    expect(shouldReplace(yesterday, buildProgressRecord(4, 0, stats, lateNight))).toBe(false);
    expect(shouldReplace(null, buildProgressRecord(4, 0, stats, lateNight))).toBe(false);
  });
});

describe('ReharmStore emits daily:v1:reharm', () => {
  it('writes in_progress on draft save, done on result, and keeps reharm:v1 keys', () => {
    const kv = memoryKV();
    const s = new ReharmStore(kv, () => lateNight);
    s.saveDraft({ puzzleNumber: 1, symbols: ['Dm7', null, 'G7', null] });
    expect(readDaily(kv)).toMatchObject({ status: 'in_progress', progressLabel: '2/3 bars', puzzleNo: 1 });
    expect(s.loadDraft(1)?.symbols).toEqual(['Dm7', null, 'G7', null]);

    s.recordResult(entry(1));
    expect(readDaily(kv)).toMatchObject({ status: 'done', score: 91, streak: 1, playedCount: 1, bestScore: 91, dateKey: '2026-11-25' });
    expect(s.getResult(1)?.total).toBe(91);
    expect(kv.getItem('reharm:v1:draft')).toBeNull();

    // A new UTC puzzle started later the same local day must not undo "done".
    s.saveDraft({ puzzleNumber: 2, symbols: ['Dm7', null, null, null] });
    expect(readDaily(kv).status).toBe('done');
  });

  it('survives a throwing storage backend', () => {
    const bad: KV = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    const s = new ReharmStore(bad, () => lateNight);
    expect(() => s.saveDraft({ puzzleNumber: 1, symbols: ['Dm7', null, null, null] })).not.toThrow();
    expect(() => s.recordResult(entry(1))).not.toThrow();
  });
});
