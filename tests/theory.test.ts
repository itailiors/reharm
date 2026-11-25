import { describe, expect, it } from 'vitest';
import type { BarIndex, MelodyNote } from '../src/types';
import {
  CHORD_TYPES, analyzeProgression, clashFor, consonantHint, findClashes, makeKey, paletteChord, parseChord,
  parseMidi, recognizeChord, safeQualitiesForRoot, voiceChord,
} from '../src/theory';
import { PALETTE_QUALITIES } from '../src/theory/chords';

const C = (s: string) => {
  const c = parseChord(s);
  if (!c) throw new Error(`unparsable ${s}`);
  return c;
};
const note = (pitch: string, bar: BarIndex, start: number, dur: number, accent = true): MelodyNote => ({
  id: `${pitch}-${bar}-${start}`, midi: parseMidi(pitch)!, pitchLabel: pitch, barIndex: bar,
  startBeat: start, durationBeats: dur, yNorm: 0.5, isAccent: accent,
});

describe('chord parsing & symbols', () => {
  it('has a dictionary of ~45 chord qualities', () => {
    expect(CHORD_TYPES.length).toBeGreaterThanOrEqual(45);
  });

  it.each([
    ['Db7#11', 'Db7#11', 1],
    ['CMaj7', 'CMaj7', 0],
    ['Cmaj7', 'CMaj7', 0],
    ['CM7', 'CMaj7', 0],
    ['F#m7b5', 'Gbø7', 6],
    ['Bbalt', 'Bb7alt', 10],
    ['G7sus', 'G7sus4', 7],
    ['A-7', 'Am7', 9],
    ['Eb+', 'Ebaug', 3],
    ['C6/9', 'C69', 0],
  ])('parses %s -> %s', (input, symbol, root) => {
    const c = C(input);
    expect(c.symbol).toBe(symbol);
    expect(c.root).toBe(root);
  });

  it('parses slash chords and drops redundant slash basses', () => {
    expect(C('CMaj7/E').bass).toBe(4);
    expect(C('CMaj7/E').symbol).toBe('CMaj7/E');
    expect(C('F/G').symbol).toBe('F/G');
    expect(C('C/C').symbol).toBe('C');
  });

  it('rejects junk', () => {
    for (const s of ['', 'H7', 'Cxyz', 'C/H', '7', 'Cmaj7/']) expect(parseChord(s)).toBeNull();
  });

  it('palette chords map to the 10 quality keys', () => {
    expect(PALETTE_QUALITIES).toHaveLength(10);
    expect(paletteChord('Db', '7').symbol).toBe('Db7');
    expect(paletteChord('C', 'maj7', 'E').symbol).toBe('CMaj7/E');
    expect(paletteChord('B', 'ø7').symbol).toBe('Bø7');
    expect(paletteChord('G', 'alt').symbol).toBe('G7alt');
    expect(paletteChord('B', 'dim').symbol).toBe('Bdim7');
  });
});

describe('Piano Mode chord recognizer', () => {
  it.each([
    [[60, 64, 67], 'C'],
    [[60, 64, 67, 71], 'CMaj7'],
    [[57, 60, 64, 67], 'Am7'],
    [[64, 67, 72], 'C/E'],
    [[62, 65, 69, 72], 'Dm7'],
    [[60, 63, 66, 69], 'Cdim7'],
    [[67, 71, 74, 77], 'G7'],
    [[55, 59, 62, 65, 68], 'G7b9'],
    [[65, 69, 72, 76, 79], 'FMaj9'],
    [[61, 65, 67, 71], 'Db7#11'],
    [[60, 64, 67, 69], 'C6'],
    [[60, 65, 67], 'Csus4'],
    [[59, 62, 65, 69], 'Bø7'],
    [[60, 64, 68], 'Caug'],
    [[62, 65, 69, 72, 76], 'Dm9'],
    [[55, 59, 65, 68, 70, 75], 'G7alt'],
  ])('%j -> %s', (midis, symbol) => {
    expect(recognizeChord(midis)?.chord.symbol).toBe(symbol);
  });

  it('returns null for too few notes or unrecognised clusters', () => {
    expect(recognizeChord([60])).toBeNull();
    expect(recognizeChord([60, 72])).toBeNull();
    expect(recognizeChord([60, 61, 62, 63])).toBeNull();
  });
});

describe('melody-vs-chord legality', () => {
  it('flags a minor 9th rub (C melody over BMaj7)', () => {
    const clash = clashFor(C('BMaj7'), 72);
    expect(clash?.kind).toBe('minor-9th');
    expect(clash?.against).toBe(11);
  });

  it('allows chord tones and consonant colour tones 9 / #11 / 13', () => {
    expect(clashFor(C('CMaj7'), 62)).toBeNull(); // 9
    expect(clashFor(C('CMaj7'), 66)).toBeNull(); // #11
    expect(clashFor(C('C'), 69)).toBeNull(); // 13 / 6
    expect(clashFor(C('Db7'), 67)).toBeNull(); // G = #11 of Db7
    expect(clashFor(C('Ab'), 72)).toBeNull(); // chord tone
  });

  it('allows altered tensions on dominants only', () => {
    expect(clashFor(C('G7'), 68)).toBeNull(); // Ab = b9 on dominant
    expect(clashFor(C('G7'), 63)).toBeNull(); // Eb = b13 on dominant
    expect(clashFor(C('GMaj7'), 68)).not.toBeNull(); // b9 on a major 7th chord
  });

  it('flags avoid notes and cross-relations', () => {
    expect(clashFor(C('C'), 65)?.kind).toBe('minor-9th'); // natural 11 over major 3rd
    expect(clashFor(C('Cm'), 64)?.kind).toBe('minor-9th'); // E over C minor
    expect(clashFor(C('C'), 63)?.kind).toBe('cross-relation'); // #9 over non-dominant major
    expect(clashFor(C('CMaj7'), 70)?.kind).toBe('cross-relation'); // b7 vs maj7
    expect(clashFor(C('Cm7'), 65)).toBeNull(); // 11 is fine on minor
  });

  it('ignores short unaccented passing tones', () => {
    const passing = note('C5', 1, 1.5, 0.5, false);
    expect(findClashes(C('BMaj7'), [passing])).toHaveLength(0);
    expect(findClashes(C('BMaj7'), [note('C5', 1, 0, 2)])).toHaveLength(1);
  });

  it('includes the slash bass in clash checks', () => {
    expect(clashFor(C('Fm/Db'), 62)).not.toBeNull(); // D a semitone over the Db bass
  });
});

describe('Consonant Helper', () => {
  const key = makeKey('C', 'major');
  const melody = [note('C5', 1, 0, 3), note('E5', 2, 0, 2), note('G4', 2, 2, 2)];

  it('lists only clash-free diatonic roots & qualities per bar', () => {
    const hint = consonantHint(key, melody, 1);
    expect(hint.safeRoots).toContain('C');
    expect(hint.safeRoots).toContain('F');
    expect(hint.safeRoots).toContain('A');
    expect(hint.safeRoots).not.toContain('Db');
    expect(hint.safeQualities.length).toBeGreaterThan(0);
  });

  it('safe piano keys stay in C4..F5 and avoid b9 rubs under held notes', () => {
    const hint = consonantHint(key, melody, 1);
    expect(hint.safeMidiNotes.every((m) => m >= 60 && m <= 77)).toBe(true);
    expect(hint.safeMidiNotes).not.toContain(71); // B4 rubs against held C
    expect(hint.safeMidiNotes).toContain(64);
  });

  it('per-root quality LEDs match the legality engine', () => {
    const q = safeQualitiesForRoot(melody, 1, 'B');
    expect(q).not.toContain('maj7');
    expect(q).not.toContain('ø7'); // C is the b9 of B: only dominants may carry it
    expect(q).toEqual(expect.arrayContaining(['7', 'alt']));
  });
});

describe('functional device detection (C major)', () => {
  const key = makeKey('C', 'major');
  const kinds = (...syms: string[]) => {
    const a = analyzeProgression(key, syms.map(C));
    return a.devices.map((d) => d.kind);
  };

  it.each([
    [['Db7', 'CMaj7'], 'tritone-sub'],
    [['Bb7', 'C'], 'backdoor-dominant'],
    [['AbMaj7', 'G7'], 'modal-borrow'],
    [['Fm7', 'C'], 'modal-borrow'],
    [['C', 'Ab'], 'chromatic-mediant'],
    [['Dm7', 'G7'], 'ii-v'],
    [['A7', 'Dm7'], 'secondary-dominant'],
    [['G7', 'C'], 'authentic-cadence'],
    [['Bdim7', 'C'], 'passing-diminished'],
    [['F', 'C'], 'plagal-cadence'],
    [['F', 'G'], 'predominant'],
    [['G7', 'Am'], 'deceptive-cadence'],
  ])('%j forms %s', (syms, kind) => {
    expect(kinds(...syms)).toContain(kind);
  });

  it('a tritone sub only counts when it actually resolves down a half step', () => {
    expect(kinds('Db7', 'Eb')).not.toContain('tritone-sub');
    expect(kinds('Db7', 'C')).toContain('tritone-sub');
  });

  it('flags unresolved chromatic colour and unresolved dominants', () => {
    const a = analyzeProgression(key, ['CMaj7', 'Gb7alt', 'E7', 'Dm7'].map(C));
    expect(a.bars[1]!.unexplainedChromatic).toBe(true);
    const b = analyzeProgression(key, ['CMaj7', 'G7', 'F', 'Am'].map(C));
    expect(b.bars[1]!.unresolvedDominant).toBe(true);
  });

  it('does not judge a chord whose neighbour is still empty', () => {
    const a = analyzeProgression(key, [C('CMaj7'), C('Gb7alt'), null, null]);
    expect(a.bars[1]!.unexplainedChromatic).toBe(false);
  });

  it('uses the loop wrap-around (bar 4 resolves into bar 1)', () => {
    const a = analyzeProgression(key, ['CMaj7', 'Am7', 'Dm7', 'Db7'].map(C));
    expect(a.devices.some((d) => d.kind === 'tritone-sub' && d.from === 3 && d.to === 0)).toBe(true);
  });
});

describe('voicing', () => {
  it('voices in a Rhodes register with the bass in octave 2', () => {
    const v = voiceChord(C('Db7#11'));
    expect(v.bass).toBe(37);
    expect(Math.min(...v.upper)).toBeGreaterThanOrEqual(52);
    expect(Math.max(...v.upper)).toBeLessThanOrEqual(74);
  });

  it('voice-leads toward the previous chord', () => {
    const a = voiceChord(C('CMaj7'));
    const b = voiceChord(C('Am7'), a.upper);
    const move = b.upper.reduce((s, n) => s + Math.min(...a.upper.map((p) => Math.abs(p - n))), 0);
    expect(move).toBeLessThanOrEqual(6);
  });
});
