/**
 * Standard MIDI File (format 1) export of the 4-bar loop: melody, chords (in the chosen
 * play style) and bass on separate tracks/channels. Pure: returns bytes, no DOM.
 */
import type { MelodyNote } from '../types';
import type { Voicing } from '../theory';
import { type ChordStyle, chordPattern, seededRng } from './patterns';

export const PPQ = 480;

export interface Ev { tick: number; on: boolean; ch: number; midi: number; vel: number }

export interface MidiExportInput {
  bpm: number;
  melody: readonly MelodyNote[];
  voicings: readonly (Voicing | null)[];
  style: ChordStyle;
  /** Seed for the 'random' style so the same mix exports the same file. */
  seed?: number;
  /** General MIDI program for the Keys track (default 4: Electric Piano 1). */
  keysProgram?: number;
  /** General MIDI program for the Melody track (default 73: Flute). */
  melodyProgram?: number;
}

const str = (s: string) => [...s].map((c) => c.charCodeAt(0) & 0x7f);
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];

/** Variable-length quantity. */
export function vlq(n: number): number[] {
  let v = Math.max(0, Math.round(n));
  const out = [v & 0x7f];
  while ((v >>>= 7)) out.unshift((v & 0x7f) | 0x80);
  return out;
}

const beats = (b: number) => Math.round(b * PPQ);

interface Span { ch: number; midi: number; on: number; off: number; vel: number }

function note(spans: Span[], ch: number, midi: number, startBeat: number, durBeats: number, vel: number): void {
  const on = beats(startBeat);
  spans.push({ ch, midi, on, off: Math.max(on + 1, beats(startBeat + durBeats)), vel });
}

/**
 * Note on/off events, with each note ended no later than the next start of the same pitch on the
 * same channel: overlapping same-pitch notes make a note-off end the newer note in most players.
 */
export function spansToEvents(spans: readonly Span[]): Ev[] {
  const sorted = [...spans].sort((a, b) => a.ch - b.ch || a.midi - b.midi || a.on - b.on);
  const evs: Ev[] = [];
  sorted.forEach((s, i) => {
    const next = sorted[i + 1];
    const off = next && next.ch === s.ch && next.midi === s.midi ? Math.min(s.off, next.on) : s.off;
    evs.push({ tick: s.on, on: true, ch: s.ch, midi: s.midi, vel: s.vel }, { tick: Math.max(s.on + 1, off), on: false, ch: s.ch, midi: s.midi, vel: 0 });
  });
  return evs;
}

function track(name: string, program: number | null, ch: number, spans: Span[], tempoUsPerBeat?: number): number[] {
  const evs = spansToEvents(spans);
  const data: number[] = [];
  const nameBytes = str(name);
  data.push(0, 0xff, 0x03, ...vlq(nameBytes.length), ...nameBytes);
  if (tempoUsPerBeat) {
    data.push(0, 0xff, 0x51, 0x03, (tempoUsPerBeat >>> 16) & 0xff, (tempoUsPerBeat >>> 8) & 0xff, tempoUsPerBeat & 0xff);
    data.push(0, 0xff, 0x58, 0x04, 4, 2, 24, 8); // 4/4
  }
  if (program !== null) data.push(0, 0xc0 | ch, program);
  // Note-offs before note-ons on the same tick so retriggered pitches don't cut themselves off.
  const sorted = [...evs].sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on));
  let last = 0;
  for (const e of sorted) {
    data.push(...vlq(e.tick - last), (e.on ? 0x90 : 0x80) | e.ch, e.midi & 0x7f, e.vel & 0x7f);
    last = e.tick;
  }
  data.push(0, 0xff, 0x2f, 0x00);
  return [...str('MTrk'), ...u32(data.length), ...data];
}

export function buildMidi({ bpm, melody, voicings, style, seed = 1, keysProgram = 4, melodyProgram = 73 }: MidiExportInput): Uint8Array<ArrayBuffer> {
  const rng = seededRng(seed);
  const lead: Span[] = [];
  const keys: Span[] = [];
  const bass: Span[] = [];
  for (const n of melody) {
    note(lead, 0, n.midi, n.barIndex * 4 + n.startBeat, n.durationBeats * 0.94, n.isAccent ? 108 : 88);
  }
  voicings.forEach((v, bar) => {
    if (!v) return;
    for (const p of chordPattern(v, style, rng)) note(keys, 1, p.midi, bar * 4 + p.start, p.dur, 80);
    note(bass, 2, v.bass, bar * 4, 4 * 0.85, 100);
  });
  const tempo = Math.round(60_000_000 / bpm);
  const header = [...str('MThd'), ...u32(6), ...u16(1), ...u16(4), ...u16(PPQ)];
  const bytes = [
    ...header,
    ...track('Reharm', null, 0, [], tempo),
    ...track('Melody', melodyProgram, 0, lead),
    ...track('Keys', keysProgram, 1, keys),
    ...track('Bass', 32, 2, bass), // GM 33: Acoustic Bass
  ];
  return new Uint8Array(bytes);
}
