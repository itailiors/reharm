/**
 * Recorded instrument samples: FluidR3_GM per-note MP3s (CC BY 3.0, via gleitz/midi-js-soundfonts),
 * spaced a minor third apart; Tone's Sampler repitches the notes in between.
 * Vite fingerprints and emits each file; nothing is fetched until an instrument is picked.
 */
export type SampleSet = 'grand' | 'rhodes' | 'vibes' | 'flute';

/** How a preset plays a sample set (it falls back to its FM synth until the samples decode). */
export interface SampledVoice {
  set: SampleSet;
  /** Sampler volume in dB. */
  volume: number;
  /** Release tail in seconds when a note ends. */
  release: number;
  /** Optional lowpass cutoff (Hz) to soften the set, e.g. a felt piano from the grand. */
  lowpass?: number;
}

const FILES = import.meta.glob('../../assets/samples/*/*.mp3', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const PC: Record<string, number> = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };

/** "Eb4" -> 63. */
export function noteToMidi(name: string): number | null {
  const m = /^([A-G]b?)(-?\d)$/.exec(name);
  if (!m || PC[m[1]!] === undefined) return null;
  return (Number(m[2]) + 1) * 12 + PC[m[1]!]!;
}

/** MIDI note -> file URL for one sample set. */
export function sampleUrls(set: SampleSet): Map<number, string> {
  const out = new Map<number, string>();
  for (const [path, url] of Object.entries(FILES)) {
    const m = /samples\/([^/]+)\/([^/]+)\.mp3$/.exec(path);
    if (!m || m[1] !== set) continue;
    const midi = noteToMidi(m[2]!);
    if (midi !== null) out.set(midi, url);
  }
  return out;
}
