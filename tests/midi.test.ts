import { describe, expect, it } from 'vitest';
import { CHORD_STYLES, chordPattern, outsideInOrder, seededRng } from '../src/audio/patterns';
import { PPQ, buildMidi, spansToEvents, vlq } from '../src/audio/midi';
import { noteToMidi, sampleUrls } from '../src/audio/samples';
import { PIANOS } from '../src/audio/pianos';
import { LEADS } from '../src/audio/leads';
import type { MelodyNote } from '../src/types';

const V4 = { bass: 36, upper: [52, 55, 59, 62] }; // C/E G B D
const V3 = { bass: 41, upper: [57, 60, 65] };

describe('chord patterns', () => {
  it('block plays every note on the downbeat', () => {
    const p = chordPattern(V4, 'block');
    expect(p.map((n) => n.midi)).toEqual(V4.upper);
    expect(p.every((n) => n.start === 0)).toBe(true);
  });

  it('arpeggio goes up then back down in 8ths', () => {
    const p = chordPattern(V4, 'arpeggio');
    expect(p.map((n) => n.midi)).toEqual([52, 55, 59, 62, 59, 55, 52, 55]);
    expect(p.map((n) => n.start)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  });

  it('outside-in alternates the extremes', () => {
    expect(outsideInOrder([1, 2, 3, 4, 5])).toEqual([1, 5, 2, 4, 3]);
    expect(chordPattern(V4, 'outside-in').slice(0, 4).map((n) => n.midi)).toEqual([52, 62, 55, 59]);
  });

  it('random uses only chord tones and never repeats a note back to back', () => {
    const p = chordPattern(V4, 'random', seededRng(7));
    expect(p).toHaveLength(8);
    p.forEach((n, i) => {
      expect(V4.upper).toContain(n.midi);
      if (i) expect(n.midi).not.toBe(p[i - 1]!.midi);
    });
  });

  it('bach breaks the chord in 16ths per half bar, holding the low notes', () => {
    const p = chordPattern(V4, 'bach');
    expect(p).toHaveLength(16);
    expect(p.slice(0, 8).map((n) => n.midi)).toEqual([52, 55, 59, 62, 59, 62, 59, 62]);
    expect(p[0]!.dur).toBeGreaterThan(1.5);
    // Triads keep one held note and break the other two.
    expect(chordPattern(V3, 'bach').slice(0, 8).map((n) => n.midi)).toEqual([57, 60, 65, 60, 65, 60, 65, 60]);
  });

  it('no style rings past the barline', () => {
    for (const { id } of CHORD_STYLES) {
      for (const n of chordPattern(V4, id, seededRng(1))) expect(n.start + n.dur).toBeLessThanOrEqual(4);
    }
  });
});

describe('instrument samples', () => {
  it('parses flat-spelled note names', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('Eb3')).toBe(51);
    expect(noteToMidi('A5')).toBe(81);
    expect(noteToMidi('H2')).toBeNull();
  });

  it('every sampled preset has notes covering the range it plays', () => {
    const sets = [...Object.values(PIANOS), ...Object.values(LEADS)].flatMap((p) => (p.sampled ? [p.sampled.set] : []));
    expect(sets.length).toBeGreaterThan(0);
    for (const set of sets) {
      const notes = [...sampleUrls(set).keys()];
      expect(notes.length).toBeGreaterThanOrEqual(9);
      // Sampler repitches from the nearest file: never more than 2 semitones apart inside the set.
      notes.sort((a, b) => a - b).slice(1).forEach((n, i) => expect(n - notes[i]!).toBeLessThanOrEqual(3));
    }
    const keys = [...sampleUrls('grand').keys()];
    expect(Math.min(...keys)).toBeLessThanOrEqual(52); // lowest voicing note (E3)
    expect(Math.max(...keys)).toBeGreaterThanOrEqual(77); // top of the on-screen piano (F5)
  });
});

describe('MIDI export', () => {
  const melody: MelodyNote[] = [
    { id: 'n1', midi: 72, pitchLabel: 'C5', barIndex: 0, startBeat: 0, durationBeats: 2, yNorm: 0.5, isAccent: true },
    { id: 'n2', midi: 74, pitchLabel: 'D5', barIndex: 1, startBeat: 1.5, durationBeats: 1, yNorm: 0.6, isAccent: false },
  ];

  it('encodes variable-length quantities', () => {
    expect(vlq(0)).toEqual([0]);
    expect(vlq(0x7f)).toEqual([0x7f]);
    expect(vlq(0x80)).toEqual([0x81, 0x00]);
    expect(vlq(0x3fff)).toEqual([0xff, 0x7f]);
  });

  it('writes a format-1 file with tempo, 4 tracks and balanced notes', () => {
    const bytes = buildMidi({ bpm: 96, melody, voicings: [V4, null, V3, V4], style: 'arpeggio' });
    const ascii = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
    expect(ascii(0)).toBe('MThd');
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(8)).toBe(1);
    expect(view.getUint16(10)).toBe(4);
    expect(view.getUint16(12)).toBe(PPQ);

    // Walk the tracks and count note-ons/offs per channel.
    let o = 14;
    const ons = [0, 0, 0];
    const offs = [0, 0, 0];
    let tempo = 0;
    for (let t = 0; t < 4; t++) {
      expect(ascii(o)).toBe('MTrk');
      const len = view.getUint32(o + 4);
      let i = o + 8;
      const end = i + len;
      while (i < end) {
        while (bytes[i]! & 0x80) i++; // delta
        i++;
        const st = bytes[i]!;
        if (st === 0xff) {
          const type = bytes[i + 1]!;
          const l = bytes[i + 2]!;
          if (type === 0x51) tempo = (bytes[i + 3]! << 16) | (bytes[i + 4]! << 8) | bytes[i + 5]!;
          i += 3 + l;
        } else if ((st & 0xf0) === 0xc0) i += 2;
        else {
          const ch = st & 0x0f;
          if ((st & 0xf0) === 0x90) ons[ch]!++;
          else offs[ch]!++;
          i += 3;
        }
      }
      expect(i).toBe(end);
      o = end;
    }
    expect(o).toBe(bytes.length);
    expect(tempo).toBe(625000);
    expect(ons).toEqual(offs);
    expect(ons).toEqual([2, 24, 3]); // 2 melody notes, 3 chord bars × 8 arpeggio hits, 3 bass notes
  });

  it('never overlaps two notes of the same pitch (a note-off would end the newer one)', () => {
    const evs = spansToEvents([
      { ch: 1, midi: 59, on: 480, off: 1411, vel: 80 },
      { ch: 1, midi: 59, on: 960, off: 1900, vel: 80 },
      { ch: 2, midi: 59, on: 500, off: 900, vel: 80 }, // other channel: untouched
    ]);
    const offs = evs.filter((e) => !e.on).map((e) => [e.ch, e.tick]);
    expect(offs).toEqual([[1, 960], [1, 1900], [2, 900]]);

    for (const style of ['arpeggio', 'outside-in', 'random', 'bach'] as const) {
      const all = spansToEvents(
        [V4, V3, V4, V3].flatMap((v, bar) => chordPattern(v, style, seededRng(3)).map((p) => ({
          ch: 1, midi: p.midi, on: Math.round((bar * 4 + p.start) * PPQ), off: Math.round((bar * 4 + p.start + p.dur) * PPQ), vel: 80,
        }))),
      );
      const byPitch = new Map<number, { tick: number; on: boolean }[]>();
      for (const e of all) byPitch.set(e.midi, [...(byPitch.get(e.midi) ?? []), e]);
      for (const list of byPitch.values()) {
        list.sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on));
        list.forEach((e, i) => expect(e.on).toBe(i % 2 === 0)); // on, off, on, off…
      }
    }
  });

  it('random style exports deterministically per seed', () => {
    const a = buildMidi({ bpm: 90, melody, voicings: [V4, V4, V4, V4], style: 'random', seed: 5 });
    const b = buildMidi({ bpm: 90, melody, voicings: [V4, V4, V4, V4], style: 'random', seed: 5 });
    expect([...a]).toEqual([...b]);
  });
});
