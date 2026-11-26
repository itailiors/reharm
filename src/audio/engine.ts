/**
 * REHARM audio engine — 100% client-side Tone.js.
 *  - Keys: two pools (one per crossfade bus) for a 15 ms bar-boundary crossfade; recorded samples
 *    (Sampler) for sampled presets once decoded, the FM preset until then or if they fail
 *  - Melody lead (FM or sampled), soft sine bass, lo-fi kick / rim / hat pulse
 *  - Chord swaps are quantized to the next barline ('@1m')
 *  - Visual hooks fire through Tone.Draw (beat/bar) and one requestAnimationFrame loop (playhead)
 *  - Falls back to a visual-only clock when the player chose muted mode (no AudioContext needed)
 */
import {
  FMSynth, Filter, Gain, MembraneSynth, NoiseSynth, Part, PolySynth, Reverb, Sampler, Synth, ToneAudioBuffer,
  type ToneAudioNode, Tremolo, Volume,
  getContext, getDestination, getDraw, getTransport, immediate, start as toneStart,
} from 'tone';
import { type SampleSet, type SampledVoice, sampleUrls } from './samples';
import type { BarIndex, DailyPuzzle, MelodyNote, ReharmVisualHooks } from '../types';
import type { Voicing } from '../theory';
import { LOOP_BEATS, activeNoteIds, barBeatAt, makeSilentWavDataUri, secondsPerBeat } from './timeline';
import { type ChordStyle, chordPattern } from './patterns';
import { PIANOS, type PianoId } from './pianos';
import { LEADS, type LeadId } from './leads';

type FrameHooks = Pick<ReharmVisualHooks, 'onTransportFrame' | 'onBeat' | 'onBarStart'>;

const CROSSFADE = 0.015;
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface Voices {
  rhodes: [PolySynth<FMSynth>, PolySynth<FMSynth>];
  buses: [Gain, Gain];
  preview: PolySynth<FMSynth>;
  lead: FMSynth;
  bass: Synth;
  kick: MembraneSynth;
  rim: NoiseSynth;
  hat: NoiseSynth;
  master: Volume;
  /** Where the keys preview pool and the lead connect (sampled rigs reuse them). */
  tremolo: Tremolo;
  reverb: Reverb;
}

/** The calls the scheduler makes on a keys/lead voice, synth or sampler alike. */
interface Playable {
  triggerAttackRelease(note: number | number[], duration: number, time?: number, velocity?: number): unknown;
}
/** The mono FM lead takes one note at a time. */
interface LeadPlayable {
  triggerAttackRelease(note: number, duration: number, time?: number, velocity?: number): unknown;
}

/** Samplers for the current sampled preset; `id` is the preset they were built for. */
interface Rig<Id, P> { id: Id; players: P; nodes: ToneAudioNode[] }

/** Broken-chord styles hold several pattern notes at once; leave room so nothing gets stolen. */
const KEYS_POLYPHONY = 24;
const WARM_VOICES = 7;

export type AudioStatus = 'locked' | 'ready' | 'muted-visual';

export class ReharmAudioEngine {
  private voices: Voices | null = null;
  private initPromise: Promise<void> | null = null;
  private silentEl: HTMLAudioElement | null = null;
  private puzzle: DailyPuzzle | null = null;
  private melody: readonly MelodyNote[] = [];
  private part: Part | null = null;
  private current: (Voicing | null)[] = [null, null, null, null];
  private pending = new Map<number, { voicing: Voicing | null; onCommit: () => void }>();
  private activeBus = 0;
  private rafId = 0;
  private playing = false;
  private loop = true;
  private muted = false;
  private lastBeatKey = -1;
  private visualStart = 0;
  private stopListeners = new Set<() => void>();
  private piano: PianoId = 'rhodes';
  private style: ChordStyle = 'block';
  private leadTone: LeadId = 'bell';
  /** Audio-clock time of the last scheduled melody note (keeps mono-lead starts strictly increasing). */
  private lastLeadStart = 0;
  private keysRig: Rig<PianoId, [Sampler, Sampler, Sampler]> | null = null;
  private leadRig: Rig<LeadId, Sampler> | null = null;
  private sampleCache = new Map<SampleSet, Promise<Map<number, AudioBuffer>>>();
  /** Samplers of a replaced rig still finishing their bar (silenced on stop). */
  private retiring = new Set<Sampler>();

  constructor(private readonly hooks: FrameHooks) {
    if (typeof document !== 'undefined') {
      // Pre-bundled silent loop: playing it inside the tap promotes iOS Safari to the media channel.
      const el = document.createElement('audio');
      el.src = makeSilentWavDataUri();
      el.loop = true;
      el.preload = 'auto';
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', '');
      el.setAttribute('aria-hidden', 'true');
      this.silentEl = el;
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  get status(): AudioStatus {
    return this.voices ? 'ready' : 'locked';
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get isLooping(): boolean {
    return this.loop;
  }

  /**
   * MUST be called synchronously inside a click/tap handler (iOS unlock checklist §4):
   * 1) navigator.audioSession.type = 'playback'  2) silent <audio> loop  3) Tone.start()  4) pre-allocate voices.
   */
  unlock(): Promise<boolean> {
    try {
      const nav = navigator as unknown as { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch {
      /* older Safari */
    }
    try {
      void this.silentEl?.play().catch(() => undefined);
    } catch {
      /* autoplay blocked: Tone.start still unlocks Web Audio */
    }
    let started: Promise<void>;
    try {
      started = toneStart();
    } catch {
      return Promise.resolve(false);
    }
    return started
      .then(() => this.init())
      .then(() => true)
      .catch(() => false);
  }

  /** Allocate every audio node exactly once (zero mid-loop allocation). */
  private init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const master = new Volume(-4).toDestination();
      const lofi = new Filter({ frequency: 7800, type: 'lowpass', rolloff: -12 }).connect(master);
      const reverb = new Reverb({ decay: 2.4, wet: 0.2, preDelay: 0.01 }).connect(lofi);
      await reverb.ready;
      const tremolo = new Tremolo({ frequency: 3.6, depth: 0.22, spread: 60 }).connect(reverb).start();

      const preset = PIANOS[this.piano];
      const mkRhodes = () => {
        const p = new PolySynth(FMSynth, preset.synth);
        p.maxPolyphony = KEYS_POLYPHONY;
        p.volume.value = preset.volume;
        return p;
      };
      const busA = new Gain(1).connect(tremolo);
      const busB = new Gain(0).connect(tremolo);
      const rhodesA = mkRhodes().connect(busA);
      const rhodesB = mkRhodes().connect(busB);
      const preview = mkRhodes().connect(tremolo);

      const leadPreset = LEADS[this.leadTone];
      const lead = new FMSynth(leadPreset.synth).connect(reverb);
      lead.volume.value = leadPreset.volume;

      const bass = new Synth({
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.01, decay: 0.4, sustain: 0.55, release: 0.4 },
      }).connect(lofi);
      bass.volume.value = -13;

      const kick = new MembraneSynth({ pitchDecay: 0.03, octaves: 5, envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.1 } }).connect(lofi);
      kick.volume.value = -15;
      const rimFilter = new Filter({ frequency: 1900, type: 'bandpass', Q: 1.2 }).connect(reverb);
      const rim = new NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.05 } }).connect(rimFilter);
      rim.volume.value = -22;
      const hatFilter = new Filter({ frequency: 7000, type: 'highpass' }).connect(lofi);
      const hat = new NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.02 } }).connect(hatFilter);
      hat.volume.value = -34;

      // Warm a few voices per pool so the first bars don't allocate. Kept small, and with a
      // near-zero release (read when the release is scheduled, then restored): dozens of silent
      // voices ringing out their 1 s tails at once made the first downbeat stutter. Tone
      // garbage-collects idle voices every second anyway, so warming more buys nothing.
      const t = immediate() + 0.05;
      const quick = { envelope: { release: 0.01 }, modulationEnvelope: { release: 0.01 } };
      for (const p of [rhodesA, rhodesB, preview]) {
        p.set(quick);
        p.triggerAttackRelease(Array.from({ length: WARM_VOICES }, (_, i) => midiHz(40 + i * 3)), 0.01, t, 0);
        p.set(preset.synth);
      }

      this.voices = { rhodes: [rhodesA, rhodesB], buses: [busA, busB], preview, lead, bass, kick, rim, hat, master, tremolo, reverb };
      master.mute = this.muted;
      this.installTransport();
      if (this.puzzle) this.load(this.puzzle);
      // Samples load in the background; the FM synths play until they are decoded.
      void this.syncKeysRig();
      void this.syncLeadRig();
    })();
    return this.initPromise;
  }

  private installTransport(): void {
    const tr = getTransport();
    tr.cancel(0);
    tr.loop = this.loop;
    tr.setLoopPoints(0, '4m');
    const draw = getDraw();
    const ppq = tr.PPQ;

    // Chords + bass on every barline (pending queued swaps commit here first).
    tr.scheduleRepeat((time) => {
      const v = this.voices;
      if (!v) return;
      const bar = (Math.round(tr.getTicksAtTime(time) / (ppq * 4)) % 4) as BarIndex;
      // Quantized swap point: every queued candidate lands exactly on this downbeat ('@1m').
      for (const [b, p] of this.pending) {
        this.current[b] = p.voicing;
        // Draw drops events older than 250 ms when rAF is throttled (background tab), so a
        // timer backstop guarantees the one-shot visual commit; whichever fires first wins.
        let done = false;
        const run = () => {
          if (done) return;
          done = true;
          p.onCommit();
        };
        draw.schedule(run, time);
        window.setTimeout(run, Math.max(0, (time - getContext().currentTime) * 1000) + 300);
      }
      this.pending.clear();
      const voicing = this.current[bar];
      const barDur = secondsPerBeat(tr.bpm.value) * 4;
      const next = 1 - this.activeBus;
      const [inBus, outBus] = [v.buses[next], v.buses[this.activeBus]];
      outBus.gain.cancelScheduledValues(time);
      outBus.gain.setValueAtTime(outBus.gain.getValueAtTime(time), time);
      outBus.gain.linearRampToValueAtTime(0, time + CROSSFADE);
      v.rhodes[this.activeBus].releaseAll(time + CROSSFADE + 0.005);
      this.keysRig?.players[this.activeBus].releaseAll(time + CROSSFADE + 0.005);
      inBus.gain.cancelScheduledValues(time);
      inBus.gain.setValueAtTime(0, time);
      inBus.gain.linearRampToValueAtTime(1, time + CROSSFADE);
      this.activeBus = next;
      if (voicing) {
        const spb = barDur / 4;
        const keys = this.keysOut(next as 0 | 1);
        if (this.style === 'block') {
          keys.triggerAttackRelease(voicing.upper.map(midiHz), barDur * 0.97, time, 0.62);
        } else {
          for (const n of chordPattern(voicing, this.style)) {
            keys.triggerAttackRelease(midiHz(n.midi), n.dur * spb, time + n.start * spb, n.start === 0 ? 0.62 : 0.52);
          }
        }
        v.bass.triggerAttackRelease(midiHz(voicing.bass), barDur * 0.85, time, 0.8);
      }
    }, '1m', 0);

    // Beat pulse + visual hooks.
    tr.scheduleRepeat((time) => {
      const v = this.voices;
      const beatPos = Math.round(tr.getTicksAtTime(time) / ppq) % LOOP_BEATS;
      const { bar, beat } = barBeatAt(beatPos);
      if (v) {
        if (beat === 0 || beat === 2) v.kick.triggerAttackRelease('C1', '8n', time, beat === 0 ? 0.9 : 0.6);
        else v.rim.triggerAttackRelease('16n', time, 0.5);
      }
      draw.schedule(() => {
        if (beat === 0) this.hooks.onBarStart(bar);
        this.hooks.onBeat(bar, beat);
      }, time);
    }, '4n', 0);

    tr.scheduleRepeat((time) => {
      const eighth = Math.round(tr.getTicksAtTime(time) / (ppq / 2)) % 2;
      this.voices?.hat.triggerAttackRelease('32n', time, eighth ? 0.35 : 0.7);
    }, '8n', 0);

    // One-shot mode: stop at the end of bar 4.
    tr.schedule((time) => {
      if (!this.loop) draw.schedule(() => this.stop(), time);
    }, '4m');
  }

  /** Load a puzzle (melody part + tempo). Allocates the Part here, never mid-loop. */
  load(puzzle: DailyPuzzle): void {
    this.puzzle = puzzle;
    this.melody = puzzle.melody;
    if (!this.voices) return;
    const tr = getTransport();
    tr.bpm.value = puzzle.bpm;
    this.part?.dispose();
    const spb = secondsPerBeat(puzzle.bpm);
    const events = puzzle.melody.map((n) => ({
      time: `${n.barIndex}:${Math.floor(n.startBeat)}:${(n.startBeat % 1) * 4}`,
      midi: n.midi,
      dur: n.durationBeats * spb * 0.94,
      vel: n.isAccent ? 0.85 : 0.65,
    }));
    this.part = new Part((time, ev: (typeof events)[number]) => {
      // The mono FM lead throws if a start isn't strictly after its previous one (e.g. a quick
      // stop/play while a look-ahead note is still pending): nudge it just past that start.
      const t = Math.max(time, this.lastLeadStart + 0.002);
      this.lastLeadStart = t;
      this.leadOut()?.triggerAttackRelease(midiHz(ev.midi), ev.dur, t, ev.vel);
    }, events).start(0);
  }

  /** Replace all four bars at once (A/B compare); takes effect from the next barline while playing. */
  setProgression(voicings: (Voicing | null)[]): void {
    if (this.playing) {
      voicings.forEach((v, i) => this.pending.set(i, { voicing: v, onCommit: () => undefined }));
    } else {
      this.current = [...voicings];
    }
  }

  /**
   * Queue a chord for a bar. While playing it commits on the next downbeat ('@1m');
   * a newer tap for the same bar replaces the queued candidate. Paused: commits immediately.
   */
  queueChord(bar: BarIndex, voicing: Voicing | null, onCommit: () => void): 'queued' | 'committed' {
    if (!this.playing) {
      this.current[bar] = voicing;
      this.pending.delete(bar);
      onCommit();
      return 'committed';
    }
    // Replacing the entry means only the latest tap commits; the barline callback (audio) or the
    // visual clock swaps it in on the next downbeat and fires onCommit via Draw.
    this.pending.set(bar, { voicing, onCommit });
    return 'queued';
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.lastBeatKey = -1;
    if (this.voices) {
      // Cut any sound audition (style / keys preview) so it doesn't ring over bar 1.
      this.voices.preview.releaseAll();
      this.keysRig?.players[2].releaseAll();
      this.voices.bass.triggerRelease();
      const tr = getTransport();
      tr.loop = this.loop;
      tr.position = 0;
      tr.start('+0.12'); // headroom past the init/warm-up burst so the first downbeat lands clean
    } else {
      this.visualStart = performance.now();
    }
    this.startFrames();
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.voices) {
      getTransport().stop();
      this.voices.rhodes.forEach((r) => r.releaseAll());
      this.keysRig?.players.forEach((s) => s.releaseAll());
      this.retiring.forEach((s) => s.releaseAll());
      this.voices.lead.triggerRelease();
      this.leadRig?.players.releaseAll();
      this.voices.bass.triggerRelease();
    }
    // Commit anything still queued so the UI never stays in 'queued' while paused.
    for (const [b, p] of this.pending) {
      this.current[b] = p.voicing;
      p.onCommit();
    }
    this.pending.clear();
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.stopListeners.forEach((fn) => fn());
  }

  onStop(fn: () => void): () => void {
    this.stopListeners.add(fn);
    return () => this.stopListeners.delete(fn);
  }

  toggle(): boolean {
    if (this.playing) this.stop();
    else this.play();
    return this.playing;
  }

  setLoop(on: boolean): void {
    this.loop = on;
    if (this.voices) getTransport().loop = on;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.voices) this.voices.master.mute = m;
    try {
      getDestination().mute = m;
    } catch {
      /* context not created yet */
    }
  }

  /**
   * Switch the keyboard sound. The FM pools are retuned at once (no new voices); a sampled preset
   * takes over when its samples are decoded.
   */
  setPiano(id: PianoId): void {
    const preset = PIANOS[id] ?? PIANOS.rhodes;
    this.piano = preset.id;
    if (!this.voices) return;
    for (const p of [...this.voices.rhodes, this.voices.preview]) {
      p.set(preset.synth);
      p.volume.value = preset.volume;
    }
    void this.syncKeysRig();
  }

  /** Switch the melody sound (FM lead retuned at once; samples take over once decoded). */
  setMelodyTone(id: LeadId): void {
    const preset = LEADS[id] ?? LEADS.bell;
    this.leadTone = preset.id;
    if (!this.voices) return;
    this.voices.lead.set(preset.synth);
    this.voices.lead.volume.value = preset.volume;
    void this.syncLeadRig();
  }

  /** True once the current keys and melody presets play their recorded samples (or have none). */
  get samplesReady(): boolean {
    const keysOk = !PIANOS[this.piano].sampled || this.keysRig?.id === this.piano;
    const leadOk = !LEADS[this.leadTone].sampled || this.leadRig?.id === this.leadTone;
    return keysOk && leadOk;
  }

  // ---------------------------------------------------------------------------
  // Sampled instruments
  // ---------------------------------------------------------------------------

  /** Keys voice for a crossfade bus (0/1) or the preview (2): samples when ready, else the FM pool. */
  private keysOut(i: 0 | 1 | 2): Playable {
    const v = this.voices!;
    if (this.keysRig?.id === this.piano) return this.keysRig.players[i];
    return i === 2 ? v.preview : v.rhodes[i];
  }

  private leadOut(): LeadPlayable | null {
    if (this.leadRig?.id === this.leadTone) return this.leadRig.players;
    return this.voices?.lead ?? null;
  }

  /** Decode a sample set once; every sampler gets the raw AudioBuffers (disposing one can't free them). */
  private loadSet(set: SampleSet): Promise<Map<number, AudioBuffer>> {
    let p = this.sampleCache.get(set);
    if (!p) {
      p = Promise.all(
        [...sampleUrls(set)].map(async ([midi, url]) => [midi, (await ToneAudioBuffer.fromUrl(url)).get()!] as const),
      ).then((entries) => new Map(entries));
      p.catch(() => this.sampleCache.delete(set)); // let a later pick retry (e.g. came back online)
      this.sampleCache.set(set, p);
    }
    return p;
  }

  private makeSampler(buffers: Map<number, AudioBuffer>, sv: SampledVoice, dest: ToneAudioNode, nodes: ToneAudioNode[]): Sampler {
    const s = new Sampler({ urls: Object.fromEntries(buffers), release: sv.release });
    s.volume.value = sv.volume;
    if (sv.lowpass) {
      const f = new Filter({ frequency: sv.lowpass, type: 'lowpass', rolloff: -12 }).connect(dest);
      s.connect(f);
      nodes.push(f);
    } else {
      s.connect(dest);
    }
    nodes.push(s);
    return s;
  }

  /**
   * Free an old rig. While playing it finishes the bar it already scheduled (released at the next
   * barline, where the new sound takes over), so a mid-bar switch never leaves a silent gap.
   */
  private retire(rig: Rig<unknown, Sampler | Sampler[]> | null): void {
    if (!rig) return;
    const players = Array.isArray(rig.players) ? rig.players : [rig.players];
    const tr = getTransport();
    const at = this.playing && tr.state === 'started' ? tr.nextSubdivision('1m') : immediate();
    players.forEach((s) => {
      s.releaseAll(at);
      this.retiring.add(s);
    });
    const waitMs = Math.max(0, at - immediate()) * 1000 + 2500;
    window.setTimeout(() => {
      players.forEach((s) => this.retiring.delete(s));
      rig.nodes.forEach((n) => n.dispose());
    }, waitMs);
  }

  private async syncKeysRig(): Promise<void> {
    const v = this.voices;
    const id = this.piano;
    const sv = PIANOS[id].sampled;
    if (!v || this.keysRig?.id === id) return;
    if (!sv) {
      this.retire(this.keysRig);
      this.keysRig = null;
      return;
    }
    try {
      const buffers = await this.loadSet(sv.set);
      if (this.piano !== id || this.keysRig?.id === id) return; // picked something else meanwhile
      const nodes: ToneAudioNode[] = [];
      const players = [v.buses[0], v.buses[1], v.tremolo].map((d) => this.makeSampler(buffers, sv, d, nodes)) as [Sampler, Sampler, Sampler];
      this.retire(this.keysRig);
      this.keysRig = { id, players, nodes };
    } catch {
      /* samples unavailable (offline / decode error): the FM preset keeps playing */
    }
  }

  private async syncLeadRig(): Promise<void> {
    const v = this.voices;
    const id = this.leadTone;
    const sv = LEADS[id].sampled;
    if (!v || this.leadRig?.id === id) return;
    if (!sv) {
      this.retire(this.leadRig);
      this.leadRig = null;
      return;
    }
    try {
      const buffers = await this.loadSet(sv.set);
      if (this.leadTone !== id || this.leadRig?.id === id) return;
      const nodes: ToneAudioNode[] = [];
      const player = this.makeSampler(buffers, sv, v.reverb, nodes);
      this.retire(this.leadRig);
      this.leadRig = { id, players: player, nodes };
    } catch {
      /* keep the FM lead */
    }
  }

  /** How each bar's chord is played; takes effect from the next barline. */
  setChordStyle(style: ChordStyle): void {
    this.style = style;
  }

  /** Audition held piano keys (pre-allocated preview pool). */
  previewNotes(midis: readonly number[]): void {
    if (!this.voices || this.muted || !midis.length) return;
    this.voices.preview.releaseAll();
    this.keysRig?.players[2].releaseAll();
    this.keysOut(2).triggerAttackRelease(midis.map(midiHz), 0.9, undefined, 0.55);
  }

  /** Play one bar of a voicing in a chord style on the preview voice (style audition while paused). */
  previewPattern(voicing: Voicing, style: ChordStyle): void {
    if (!this.voices || this.muted || this.playing) return;
    const spb = secondsPerBeat(this.puzzle?.bpm ?? 96);
    const t = immediate() + 0.03;
    this.voices.preview.releaseAll();
    this.keysRig?.players[2].releaseAll();
    const keys = this.keysOut(2);
    for (const n of chordPattern(voicing, style)) {
      keys.triggerAttackRelease(midiHz(n.midi), n.dur * spb, t + n.start * spb, n.start === 0 ? 0.62 : 0.52);
    }
    this.voices.bass.triggerAttackRelease(midiHz(voicing.bass), 4 * spb * 0.85, t, 0.8);
  }

  /** Play a short phrase on the lead voice (melody-sound audition while paused). */
  previewLead(midis: readonly number[]): void {
    if (!this.voices || this.muted || this.playing || !midis.length) return;
    const t = immediate() + 0.03;
    const lead = this.leadOut();
    const start = Math.max(t, this.lastLeadStart + 0.002);
    midis.forEach((m, i) => lead?.triggerAttackRelease(midiHz(m), 0.22, start + i * 0.26, 0.7));
    this.lastLeadStart = start + (midis.length - 1) * 0.26;
  }

  // ---------------------------------------------------------------------------
  // Single requestAnimationFrame loop driving onTransportFrame (+ beats in visual mode)
  // ---------------------------------------------------------------------------

  private startFrames(): void {
    cancelAnimationFrame(this.rafId);
    const frame = () => {
      if (!this.playing) return;
      const beatPos = this.currentBeatPos();
      if (beatPos >= 0) {
        this.hooks.onTransportFrame(beatPos / LOOP_BEATS, activeNoteIds(this.melody, beatPos));
        if (!this.voices) this.visualBeats(beatPos);
      }
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  private currentBeatPos(): number {
    if (this.voices) {
      const tr = getTransport();
      if (tr.state !== 'started') return -1;
      const ticks = tr.getTicksAtTime(immediate());
      return ((ticks / tr.PPQ) % LOOP_BEATS + LOOP_BEATS) % LOOP_BEATS;
    }
    const bpm = this.puzzle?.bpm ?? 96;
    const beats = (performance.now() - this.visualStart) / 1000 / secondsPerBeat(bpm);
    if (!this.loop && beats >= LOOP_BEATS) {
      queueMicrotask(() => this.stop());
      return -1;
    }
    return beats % LOOP_BEATS;
  }

  /** Visual-only clock: emulate Draw-scheduled beat/bar hooks and barline commits. */
  private visualBeats(beatPos: number): void {
    const key = Math.floor(beatPos);
    if (key === this.lastBeatKey) return;
    this.lastBeatKey = key;
    const { bar, beat } = barBeatAt(beatPos);
    if (beat === 0) {
      for (const [b, p] of this.pending) {
        this.current[b] = p.voicing;
        p.onCommit();
      }
      this.pending.clear();
      this.hooks.onBarStart(bar);
    }
    this.hooks.onBeat(bar, beat);
  }

  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      return;
    }
    if (this.voices) {
      const ctx = getContext();
      if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    }
    if (this.playing) this.startFrames();
  };
}
