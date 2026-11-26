import { describe, expect, it } from 'vitest';
import { decodeMix, decodeSymbol, encodeMix, encodeSymbol } from '../src/share/codec';
import { buildSharePayload, displayUrl } from '../src/share/card';
import { type HistoryEntry, ReharmStore, computeStats, memoryKV } from '../src/share/storage';
import { CHORD_TYPES, makeChord, parseChord } from '../src/theory';
import { mulberry32 } from '../src/puzzles';

describe('URL hash codec', () => {
  it('encodes the documented example exactly', () => {
    expect(encodeMix(42, ['CMaj7', 'AbMaj7', 'Db7#11', 'CMaj9'])).toBe('42:CMaj7.AbMaj7.Db7s11.CMaj9');
  });

  it('decodes the documented example', () => {
    const d = decodeMix('#42:CMaj7.AbMaj7.Db7s11.CMaj9')!;
    expect(d.puzzleNumber).toBe(42);
    expect(d.symbols).toEqual(['CMaj7', 'AbMaj7', 'Db7#11', 'CMaj9']);
    expect(d.senderName).toBeNull();
  });

  it('keeps sus chords intact while mapping # to s', () => {
    expect(encodeSymbol('G7sus4')).toBe('G7sus4');
    expect(decodeSymbol('G7sus4')).toBe('G7sus4');
    expect(decodeSymbol('Db7s9b13')).toBe('Db7#9b13');
    expect(decodeSymbol(encodeSymbol('Bø7/F'))).toBe('Bø7/F');
  });

  it('round-trips every chord quality, root and slash bass', () => {
    const rand = mulberry32(7);
    for (const type of CHORD_TYPES) {
      for (let k = 0; k < 6; k++) {
        const syms = Array.from({ length: 4 }, () => {
          const root = Math.floor(rand() * 12);
          const bass = rand() < 0.3 ? Math.floor(rand() * 12) : null;
          return makeChord(root, type, bass).symbol;
        });
        const hash = `#${encodeMix(123, syms)}`;
        const d = decodeMix(hash);
        expect(d, hash).not.toBeNull();
        expect(d!.symbols).toEqual(syms);
        expect(d!.chords.map((c) => c.symbol)).toEqual(syms);
      }
    }
  });

  it('carries an optional sanitized sender name', () => {
    const frag = encodeMix(7, ['C', 'F', 'G', 'C'], 'Alex <script>');
    const d = decodeMix(frag)!;
    expect(d.senderName).toBe('Alex script');
    expect(decodeMix(encodeMix(7, ['C', 'F', 'G', 'C'], 'Zoë'))!.senderName).toBe('Zoë');
  });

  it.each([
    '', '#', '#42', '#42:', '#42:C.F.G', '#42:C.F.G.C.D', '#0:C.F.G.C', '#x:C.F.G.C', '#42:C.F.Hm.C', '#42:C.F.G.C@%E0%A4%A',
  ])('rejects or degrades malformed hash %j', (h) => {
    const d = decodeMix(h);
    if (h.startsWith('#42:C.F.G.C@')) expect(d?.senderName ?? null).toBeNull();
    else expect(d).toBeNull();
  });

  it('decoded chords are real theory objects', () => {
    const d = decodeMix('#3:Fm9.Gb7s11.Bbm7_Ab.C7alt')!;
    expect(d.chords[2].bass).toBe(parseChord('Ab')!.root);
    expect(d.symbols[3]).toBe('C7alt');
  });
});

describe('share card', () => {
  it('builds the spoiler-free emoji card and playable URL', () => {
    const p = buildSharePayload({
      puzzleNumber: 42,
      symbols: ['CMaj7', 'AbMaj7', 'Db7#11', 'CMaj9'],
      barTiers: ['jazz-standard', 'modal-interchange', 'deep-reharm', 'jazz-standard'],
      lockedBarIndex: 0,
      score: { total: 91, percentileLabel: 'Top 4% Spice', avgBassSemitones: 3, badges: ['modal-borrow', 'tritone-sub', 'sharp11-melody'] },
      baseUrl: 'https://reharm.app/#old',
    });
    expect(p.url).toBe('https://reharm.app/#42:CMaj7.AbMaj7.Db7s11.CMaj9');
    const lines = p.emojiCardText.split('\n');
    expect(lines[0]).toBe('🎛️ REHARM #42 — 91/100 (Top 4% Spice)');
    expect(lines[1]).toBe('Bar 1 🔒 | Bar 2 🟣 | Bar 3 🔥 | Bar 4 ✨');
    expect(lines[2]).toBe('Badges: 🌙 Modal Borrow · ⚡ Tritone Sub · 💎 #11 Melody');
    expect(lines[3]).toBe('Bassline Flow: 🌊 Flowing (3 st avg)');
    expect(lines[4]).toBe('▶ Hear my mix: https://reharm.app/#42:CMaj7.AbMaj7.Db7s11.CMaj9');
    expect(lines.slice(0, 4).join('\n')).not.toContain('Db7');
    expect(p.barTiers[0]).toBe('locked');
    expect(displayUrl('http://x.y/#1:C.C.C.C')).toBe('x.y/#1:C.C.C.C');
  });
});

describe('localStorage persistence & stats', () => {
  const entry = (n: number, total: number, badges: HistoryEntry['badges'] = []): HistoryEntry => ({
    puzzleNumber: n, dateISO: 'x', symbols: ['C', 'F', 'G', 'C'], total, rarity: 0, melodyColor: 0, bassFlow: 0,
    tier: 'radio-safe', percentileLabel: 'Top 50% Spice', badges, barTiers: ['radio-safe', 'radio-safe', 'radio-safe', 'radio-safe'],
  });

  it('persists settings with defaults', () => {
    const s = new ReharmStore(memoryKV());
    expect(s.loadSettings().theme).toBe('dark');
    s.saveSettings({ ...s.loadSettings(), theme: 'light', consonantHelper: false });
    expect(s.loadSettings()).toMatchObject({ theme: 'light', consonantHelper: false, inputMode: 'palette' });
  });

  it('survives corrupt JSON', () => {
    const kv = memoryKV();
    kv.setItem('reharm:v1:settings', '{nope');
    expect(new ReharmStore(kv).loadSettings().theme).toBe('dark');
  });

  it('the first locked result of a day is final and clears the draft', () => {
    const s = new ReharmStore(memoryKV());
    s.saveDraft({ puzzleNumber: 5, symbols: ['C', null, null, null] });
    expect(s.loadDraft(5)?.symbols[0]).toBe('C');
    expect(s.loadDraft(6)).toBeNull();
    s.recordResult(entry(5, 70));
    s.recordResult(entry(5, 99));
    expect(s.getResult(5)!.total).toBe(70);
    expect(s.loadDraft(5)).toBeNull();
  });

  it('computes streaks, averages, distribution and badge trophy counts', () => {
    const h: Record<number, HistoryEntry> = {
      1: entry(1, 40, ['radio-safe']),
      2: entry(2, 60, ['tritone-sub']),
      4: entry(4, 80, ['tritone-sub', 'smooth-bass']),
      5: entry(5, 92),
      6: entry(6, 96, ['jazz-trench']),
    };
    const st = computeStats(h, 6);
    expect(st.played).toBe(5);
    expect(st.currentStreak).toBe(3);
    expect(st.maxStreak).toBe(3);
    expect(st.averageScore).toBe(74);
    expect(st.bestScore).toBe(96);
    expect(st.spiceDistribution).toEqual({ radioSafe: 1, jazzStandard: 1, modalInterchange: 1, deepReharm: 2 });
    expect(st.badgeCounts['tritone-sub']).toBe(2);
    expect(st.badgeCounts['jazz-trench']).toBe(1);
    expect(st.badgeCounts['backdoor-dominant']).toBe(0);
    // Today not yet played: streak still counts through yesterday
    expect(computeStats(h, 7).currentStreak).toBe(3);
    // Missed a day: streak resets
    expect(computeStats(h, 8).currentStreak).toBe(0);
  });
});
