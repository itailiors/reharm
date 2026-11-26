/**
 * Keyboard sounds: recorded samples where a good one exists, each with an FM synth preset that
 * plays until the samples decode (or if they fail), plus the General MIDI program for exports.
 */
import type { UserSettings } from '../types';
import type { SampledVoice } from './samples';

export type PianoId = UserSettings['piano'];

export interface PianoPreset {
  id: PianoId;
  label: string;
  /** General MIDI program (0-based) used for the Keys track in MIDI exports. */
  gmProgram: number;
  volume: number;
  sampled?: SampledVoice;
  synth: {
    harmonicity: number;
    modulationIndex: number;
    oscillator: { type: 'sine' | 'triangle' };
    modulation: { type: 'sine' | 'triangle' | 'square' };
    envelope: { attack: number; decay: number; sustain: number; release: number };
    modulationEnvelope: { attack: number; decay: number; sustain: number; release: number };
  };
}

export const PIANOS: Record<PianoId, PianoPreset> = {
  rhodes: {
    id: 'rhodes', label: 'Rhodes', gmProgram: 4, volume: -7,
    sampled: { set: 'rhodes', volume: 7, release: 0.8 },
    synth: {
      harmonicity: 3, modulationIndex: 2.2,
      oscillator: { type: 'sine' }, modulation: { type: 'sine' },
      envelope: { attack: 0.004, decay: 1.6, sustain: 0.32, release: 0.9 },
      modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0.08, release: 0.5 },
    },
  },
  grand: {
    id: 'grand', label: 'Grand', gmProgram: 0, volume: -4,
    sampled: { set: 'grand', volume: 11, release: 1 },
    synth: {
      harmonicity: 1, modulationIndex: 3.2,
      oscillator: { type: 'triangle' }, modulation: { type: 'sine' },
      envelope: { attack: 0.002, decay: 2.4, sustain: 0.12, release: 1.1 },
      modulationEnvelope: { attack: 0.001, decay: 0.9, sustain: 0.04, release: 0.8 },
    },
  },
  felt: {
    id: 'felt', label: 'Felt', gmProgram: 0, volume: -8,
    sampled: { set: 'grand', volume: 13, release: 1.3, lowpass: 1600 },
    synth: {
      harmonicity: 2, modulationIndex: 0.6,
      oscillator: { type: 'sine' }, modulation: { type: 'sine' },
      envelope: { attack: 0.018, decay: 2.2, sustain: 0.2, release: 1.4 },
      modulationEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.02, release: 0.6 },
    },
  },
  wurli: {
    id: 'wurli', label: 'Wurli', gmProgram: 4, volume: -6,
    synth: {
      harmonicity: 1, modulationIndex: 1.6,
      oscillator: { type: 'sine' }, modulation: { type: 'square' },
      envelope: { attack: 0.003, decay: 1.1, sustain: 0.4, release: 0.6 },
      modulationEnvelope: { attack: 0.002, decay: 0.22, sustain: 0.18, release: 0.4 },
    },
  },
};

export const PIANO_IDS = Object.keys(PIANOS) as PianoId[];
