/** Pure loop-position math shared by the Tone.js transport and the visual-only clock. */
import type { BarIndex, MelodyNote } from '../types';

export const BEATS_PER_BAR = 4;
export const LOOP_BEATS = 16;

export function barBeatAt(beatPos: number): { bar: BarIndex; beat: 0 | 1 | 2 | 3 } {
  const b = ((Math.floor(beatPos) % LOOP_BEATS) + LOOP_BEATS) % LOOP_BEATS;
  return { bar: Math.floor(b / BEATS_PER_BAR) as BarIndex, beat: (b % BEATS_PER_BAR) as 0 | 1 | 2 | 3 };
}

/** IDs of melody notes sounding at a loop position (in beats, 0..16). */
export function activeNoteIds(melody: readonly MelodyNote[], beatPos: number): string[] {
  const out: string[] = [];
  for (const n of melody) {
    const start = n.barIndex * BEATS_PER_BAR + n.startBeat;
    if (beatPos >= start && beatPos < start + n.durationBeats) out.push(n.id);
  }
  return out;
}

export const secondsPerBeat = (bpm: number): number => 60 / bpm;
export const loopSeconds = (bpm: number): number => LOOP_BEATS * secondsPerBeat(bpm);

/** 1-second-class silent 8-bit mono WAV as a data URI, used to lift iOS into the media channel. */
export function makeSilentWavDataUri(sampleRate = 8000, seconds = 0.5): string {
  const samples = Math.max(1, Math.floor(sampleRate * seconds));
  const buf = new Uint8Array(44 + samples);
  const view = new DataView(buf.buffer);
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i); };
  str(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate (8-bit mono)
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  str(36, 'data');
  view.setUint32(40, samples, true);
  buf.fill(128, 44); // 8-bit silence midpoint
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
  return `data:audio/wav;base64,${btoa(bin)}`;
}
