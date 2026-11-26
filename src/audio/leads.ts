/** Melody sounds: recorded samples where available (FM synth until they decode) plus the GM program for exports. */
import type { UserSettings } from '../types';
import type { SampledVoice } from './samples';

export type LeadId = UserSettings['melodyTone'];

export interface LeadPreset {
  id: LeadId;
  label: string;
  gmProgram: number;
  volume: number;
  sampled?: SampledVoice;
  synth: {
    harmonicity: number;
    modulationIndex: number;
    oscillator: { type: 'sine' | 'triangle' | 'square' | 'sawtooth' };
    modulation: { type: 'sine' | 'triangle' | 'square' };
    envelope: { attack: number; decay: number; sustain: number; release: number };
    modulationEnvelope: { attack: number; decay: number; sustain: number; release: number };
  };
}

export const LEADS: Record<LeadId, LeadPreset> = {
  bell: {
    id: 'bell', label: 'Bell', gmProgram: 73, volume: -9,
    synth: {
      harmonicity: 4, modulationIndex: 1.3,
      oscillator: { type: 'sine' }, modulation: { type: 'triangle' },
      envelope: { attack: 0.012, decay: 0.25, sustain: 0.62, release: 0.35 },
      modulationEnvelope: { attack: 0.004, decay: 0.18, sustain: 0.05, release: 0.25 },
    },
  },
  vibes: {
    id: 'vibes', label: 'Vibes', gmProgram: 11, volume: -8,
    sampled: { set: 'vibes', volume: 8, release: 1.2 },
    synth: {
      harmonicity: 7, modulationIndex: 2.4,
      oscillator: { type: 'sine' }, modulation: { type: 'sine' },
      envelope: { attack: 0.002, decay: 1.4, sustain: 0.1, release: 1.2 },
      modulationEnvelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.2 },
    },
  },
  flute: {
    id: 'flute', label: 'Flute', gmProgram: 73, volume: -8,
    sampled: { set: 'flute', volume: -1, release: 0.25 },
    synth: {
      harmonicity: 1, modulationIndex: 0.35,
      oscillator: { type: 'sine' }, modulation: { type: 'triangle' },
      envelope: { attack: 0.06, decay: 0.2, sustain: 0.85, release: 0.25 },
      modulationEnvelope: { attack: 0.08, decay: 0.3, sustain: 0.4, release: 0.2 },
    },
  },
  synth: {
    id: 'synth', label: 'Synth', gmProgram: 80, volume: -13,
    synth: {
      harmonicity: 1, modulationIndex: 0.8,
      oscillator: { type: 'square' }, modulation: { type: 'sine' },
      envelope: { attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.2 },
      modulationEnvelope: { attack: 0.005, decay: 0.2, sustain: 0.3, release: 0.2 },
    },
  },
};

export const LEAD_IDS = Object.keys(LEADS) as LeadId[];
