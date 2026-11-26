import type {
  BarIndex, ChordQuality, DailyPuzzle, MelodyNote, NoteName, ReharmVisualHooks, SlotLifecycleState, SpiceTier, UserSettings,
} from '../types';
import { BAR_INDICES } from '../types';
import {
  type Chord, type FullScore, type PuzzleContext, type Voicing, NOTE_NAMES, PALETTE_QUALITIES, TIER_LABEL,
  analyzeProgression, barNotes, chordPcs, colorize, evaluateBar, midiLabel, paletteChord, parseChord, pcName, relToRoot,
  recognizeChord, safeQualitiesForRoot, scoreProgression, voiceChord,
} from '../theory';
import { getPuzzleByNumber, puzzleKey, puzzleNumberForDate } from '../puzzles';
import { ReharmAudioEngine } from '../audio/engine';
import { buildMidi } from '../audio/midi';
import { PIANOS } from '../audio/pianos';
import { LEADS } from '../audio/leads';
import { CHORD_STYLES, type ChordStyle } from '../audio/patterns';
import { decodeMix } from '../share/codec';
import { type HistoryEntry, type MetaState, ReharmStore, browserKV } from '../share/storage';
import { $, $$, esc, replayClass } from './dom';
import { BRAND, ICONS, hydrateIcons } from './assets';
import { Modals } from './modals';
import { Receiver } from './receiver';

type FeedbackTone = 'legal' | 'queued' | 'clash' | 'info';

export interface StudioBar {
  chord: Chord | null;
  custom: number[] | null;
  state: SlotLifecycleState;
  queued: Chord | null;
  tier?: SpiceTier;
  deviceLabel?: string;
  devicePlain?: string;
  clashReason?: string;
  suggestions?: string[];
}

interface Snapshot { bars: StudioBar[]; voicings: (Voicing | null)[]; selected: BarIndex }

/** One OLED + chord-slot surface the visual hooks drive (studio or receiver). */
export interface Surface {
  oled: HTMLElement;
  beam: HTMLElement;
  cols: HTMLElement[];
  pills: Map<string, HTMLElement>;
  slots: () => HTMLElement[];
}

const WHITE_KEYS = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77];
const BLACK_KEYS = [
  { midi: 61, slotAfter: 0 }, { midi: 63, slotAfter: 1 }, { midi: 66, slotAfter: 3 }, { midi: 68, slotAfter: 4 },
  { midi: 70, slotAfter: 5 }, { midi: 73, slotAfter: 7 }, { midi: 75, slotAfter: 8 },
];
const LOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;

export const shortKey = (p: DailyPuzzle): string =>
  `${p.tonic ?? p.keyLabel.split(' ')[0]} ${p.mode === 'minor' ? 'MIN' : 'MAJ'}`;

const TENSION_NAME: Record<number, string> = { 1: 'b9', 2: '9', 3: '#9', 5: '11', 6: '#11', 8: 'b13', 9: '13' };

/**
 * When colorize() renames a palette pick (Db + 7 under a held G -> Db7#11), say why, so the
 * chord doesn't look silently swapped. Returns "" when nothing changed.
 */
export function extensionNote(plain: Chord, shown: Chord, notes: readonly MelodyNote[]): string {
  if (plain.symbol === shown.symbol) return '';
  const base = chordPcs(plain);
  const added = chordPcs(shown);
  const tensions = [...new Set(notes.map((n) => n.midi % 12))]
    .filter((pc) => !base.has(pc) && added.has(pc))
    .map((pc) => `${pcName(pc)} (${TENSION_NAME[relToRoot(plain, pc)] ?? 'colour'})`);
  if (!tensions.length) return '';
  return `${plain.symbol} + melody ${tensions.join(', ')} = ${shown.symbol}. `;
}

/** Chord tones in voicing order for the desktop slot readout ("C E G B"). */
export function chordToneNames(chord: Chord): string {
  const names: string[] = chord.type.intervals.map((i) => pcName(chord.root + i));
  if (chord.bass !== null) names.unshift(`/${pcName(chord.bass)}`);
  return [...new Set(names)].join(' ');
}

export function renderOled(container: HTMLElement, puzzle: DailyPuzzle): Surface {
  container.innerHTML = `
    <div class="oled-grid">${BAR_INDICES.map((b) => `<div class="oled-bar-col" data-oled-bar="${b}"><div class="oled-beat-ticks"><span></span><span></span><span></span><span></span></div></div>`).join('')}</div>
    <div class="oled-notes-layer"></div>
    <div class="playhead-beam"></div>`;
  const layer = $('.oled-notes-layer', container);
  const pills = new Map<string, HTMLElement>();
  for (const n of puzzle.melody) {
    const el = document.createElement('div');
    el.className = 'melody-pill';
    el.dataset.noteId = n.id;
    el.style.left = `${((n.barIndex * 4 + n.startBeat) / 16) * 100}%`;
    el.style.width = `${(n.durationBeats / 16) * 100}%`;
    el.style.top = `${(1 - n.yNorm) * 76 + 6}%`;
    el.innerHTML = `<span class="melody-pill-label">${esc(n.pitchLabel.replace(/-?\d+$/, ''))}</span>`;
    el.title = n.pitchLabel;
    layer.appendChild(el);
    pills.set(n.id, el);
  }
  return {
    oled: container,
    beam: $('.playhead-beam', container),
    cols: $$('.oled-bar-col', container),
    pills,
    slots: () => [],
  };
}

export class ReharmApp implements ReharmVisualHooks {
  readonly store = new ReharmStore(browserKV());
  readonly engine: ReharmAudioEngine;
  settings: UserSettings;
  meta: MetaState;
  readonly todayNumber: number;
  puzzle!: DailyPuzzle;
  ctx!: PuzzleContext;
  bars: StudioBar[] = [];
  voicings: (Voicing | null)[] = [null, null, null, null];
  selectedBar: BarIndex = 1;
  palette: { root: NoteName | null; quality: ChordQuality | null; bass: NoteName | null } = { root: null, quality: null, bass: null };
  slashOpen = false;
  piano = new Set<number>();
  solved: HistoryEntry | null = null;
  playing = false;
  private undoStack: Snapshot[] = [];
  private feedbackBar: BarIndex | null = null;
  private surface!: Surface;
  private studioSurface!: Surface;
  private sounding = new Set<string>();
  private beamWidth = 0;
  private current: { bar: BarIndex; beat: number } | null = null;
  readonly modals: Modals;
  readonly receiver: Receiver;
  view: 'studio' | 'receiver' = 'studio';
  /** Feedback line to show once the audio gate closes (e.g. a bad shared link). */
  private gateNotice: string | null = null;

  constructor() {
    this.settings = this.store.loadSettings();
    this.meta = this.store.loadMeta();
    this.applySettings();
    this.engine = new ReharmAudioEngine(this);
    this.engine.setMuted(this.settings.isMuted);
    this.engine.setPiano(this.settings.piano);
    this.engine.setChordStyle(this.settings.chordStyle);
    this.engine.setMelodyTone(this.settings.melodyTone);
    this.engine.onStop(() => this.onStopped());
    this.todayNumber = puzzleNumberForDate(new Date());
    this.modals = new Modals(this);
    this.receiver = new Receiver(this);

    ($('#brand-mark') as HTMLImageElement).src = BRAND.favicon;
    ($('#gate-logo') as HTMLImageElement).src = BRAND.logo;
    hydrateIcons();
    this.bindStatic();
    this.loadPuzzle(getPuzzleByNumber(this.todayNumber));

    window.addEventListener('resize', () => this.measure());
    window.addEventListener('hashchange', () => this.routeFromHash());
    this.routeFromHash(true);
  }

  // ---------------------------------------------------------------------------
  // Routing & lifecycle
  // ---------------------------------------------------------------------------

  private routeFromHash(initial = false): void {
    const decoded = location.hash.length > 1 ? decodeMix(location.hash) : null;
    // +1: puzzles roll over at local midnight, so a sender a few time zones ahead can be a day on.
    if (decoded && decoded.puzzleNumber <= this.todayNumber + 1) {
      const puzzle = getPuzzleByNumber(decoded.puzzleNumber);
      if (decoded.symbols[puzzle.lockedBarIndex] === puzzle.anchorChord.symbol) {
        this.modals.closeAll(true);
        this.receiver.open(decoded, puzzle);
        return;
      }
    }
    if (location.hash.length > 1 && !initial) history.replaceState(null, '', location.pathname + location.search);
    if (this.view === 'receiver') this.receiver.close();
    if (initial) {
      if (location.hash.length > 1) {
        history.replaceState(null, '', location.pathname + location.search);
        // The gate buttons overwrite the feedback line, so show this once the gate closes.
        this.gateNotice = 'That shared link was invalid or for an unreleased puzzle — here is today’s.';
      }
      this.showGate();
    }
  }

  /** Switch the visual hooks to a different OLED / slot surface. */
  useSurface(s: Surface | null): void {
    this.clearPlayVisuals();
    this.surface = s ?? this.studioSurface;
    this.measure();
  }

  measure(): void {
    this.beamWidth = this.surface?.oled.clientWidth ?? 0;
  }

  showGate(): void {
    $('#gate-edition').innerHTML = `<strong>PUZZLE #${this.puzzle.puzzleNumber}</strong> · ${esc(this.puzzle.keyLabel.toUpperCase())} · ${this.puzzle.bpm} BPM`;
    if (this.engine.status === 'ready') {
      this.afterGate();
      return;
    }
    $('#modal-gate').hidden = false;
    $('#btn-power-studio').focus();
  }

  private afterGate(): void {
    if (this.gateNotice) {
      this.setFeedback('info', this.gateNotice);
      this.gateNotice = null;
    }
    if (!this.meta.seenHowTo) {
      this.meta.seenHowTo = true;
      this.store.saveMeta(this.meta);
      this.modals.openHowTo();
    }
  }

  /**
   * Unlock audio from inside a user gesture. The engine performs the iOS checklist synchronously;
   * if the visual-only clock was running, restart on the real transport.
   */
  ensureAudio(): Promise<boolean> {
    if (this.engine.status === 'ready') return Promise.resolve(true);
    const wasPlaying = this.engine.isPlaying;
    return this.engine.unlock().then((ok) => {
      if (ok) {
        this.engine.setMuted(this.settings.isMuted);
        if (wasPlaying) {
          this.engine.stop();
          this.engine.play();
          this.setPlayingUI(true);
        }
      }
      this.modals.refreshSettings();
      return ok;
    });
  }

  loadPuzzle(p: DailyPuzzle): void {
    this.puzzle = p;
    this.ctx = { key: puzzleKey(p), melody: p.melody, lockedBarIndex: p.lockedBarIndex };
    const anchor = parseChord(p.anchorChord.symbol)!;
    this.bars = BAR_INDICES.map((b) =>
      b === p.lockedBarIndex
        ? { chord: anchor, custom: null, state: 'locked' as const, queued: null }
        : { chord: null, custom: null, state: 'empty' as const, queued: null },
    );
    this.solved = this.store.getResult(p.puzzleNumber);
    if (this.solved) {
      this.solved.symbols.forEach((s, i) => {
        if (i === p.lockedBarIndex) return;
        const c = parseChord(s);
        if (c) this.bars[i] = { chord: c, custom: null, state: 'legal', queued: null };
      });
    } else {
      const draft = this.store.loadDraft(p.puzzleNumber);
      draft?.symbols.forEach((s, i) => {
        if (i === p.lockedBarIndex || !s) return;
        const c = parseChord(s);
        if (!c) return;
        const custom = draft.voicings?.[i] ?? null;
        const ev = evaluateBar(this.ctx, this.committedChords(), i as BarIndex, c);
        this.bars[i] = { chord: c, custom, state: ev.state, queued: null, clashReason: ev.clashReason, suggestions: ev.suggestions };
      });
    }
    this.recomputeVoicings();
    this.recomputeTiers();
    this.selectedBar = this.firstOpenBar();
    this.syncPaletteFromBar();
    this.studioSurface = renderOled($('#oled-screen'), p);
    this.studioSurface.slots = () => $$('.bar-slot', $('#chord-slots-grid'));
    this.surface = this.studioSurface;
    this.engine.load(p);
    this.engine.setProgression(this.voicings);
    this.renderAll();
    requestAnimationFrame(() => this.measure());
    if (this.solved) this.setFeedback('legal', `✓ Mix locked · ${this.solved.total}/100 · ${this.solved.percentileLabel}. New melody at midnight.`);
    else this.setFeedback('info', `Bar ${p.lockedBarIndex + 1} is anchored on ${p.anchorChord.symbol}. Pick a bar, then Root + Quality.`);
  }

  /** Reload the studio's own puzzle into the engine (after leaving the receiver). */
  restoreStudioAudio(): void {
    this.engine.load(this.puzzle);
    this.engine.setProgression(this.voicings);
  }

  private firstOpenBar(): BarIndex {
    const open = BAR_INDICES.filter((b) => b !== this.puzzle.lockedBarIndex);
    return open.find((b) => this.bars[b]!.state === 'empty') ?? open[0]!;
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  applySettings(): void {
    const root = document.documentElement;
    root.dataset.theme = this.settings.theme;
    root.dataset.reducedMotion = String(this.settings.reducedMotion);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', this.settings.theme === 'light' ? '#F4F1EA' : '#111215');
    const drawer = document.getElementById('input-drawer');
    if (drawer) drawer.dataset.helper = String(this.settings.consonantHelper);
  }

  updateSettings(patch: Partial<UserSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.store.saveSettings(this.settings);
    this.applySettings();
    if ('isMuted' in patch) this.engine.setMuted(this.settings.isMuted);
    if ('piano' in patch) this.engine.setPiano(this.settings.piano);
    if ('chordStyle' in patch) this.engine.setChordStyle(this.settings.chordStyle);
    if ('melodyTone' in patch) this.engine.setMelodyTone(this.settings.melodyTone);
    this.renderDrawer();
    this.renderStyleStrip();
    this.modals.refreshSettings();
  }

  /** Play the selected bar's chord (or a Cmaj7) once so a new keys sound can be heard while paused. */
  auditionChord(): void {
    if (this.engine.isPlaying) return;
    const v = this.voicings[this.selectedBar] ?? this.voicings.find(Boolean);
    this.engine.previewNotes(v ? v.upper : [60, 64, 67, 71]);
  }

  /** Play the first notes of today's melody so a new melody sound can be heard while paused. */
  auditionMelody(): void {
    this.engine.previewLead(this.puzzle.melody.slice(0, 3).map((n) => n.midi));
  }

  /** Studio chord-style chips (same setting as the Settings row). */
  renderStyleStrip(): void {
    const box = document.getElementById('style-strip-chips');
    if (!box) return;
    if (!box.childElementCount) {
      box.innerHTML = CHORD_STYLES.map((s) =>
        `<button class="style-chip" type="button" role="radio" data-style="${s.id}" title="${esc(s.hint)}">${esc(s.label)}</button>`).join('');
    }
    $$<HTMLButtonElement>('.style-chip', box).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.style === this.settings.chordStyle)));
  }

  /**
   * Play a sound-choice audition from a tap. Never in Muted Mode: waking audio there would start
   * the iOS media session (pausing the player's other audio) and restart the visual loop.
   */
  audition(play: () => void): void {
    if (this.settings.isMuted || this.engine.isPlaying) return;
    void this.ensureAudio().then((ok) => {
      if (ok) play();
    });
  }

  /** Pick a chord style from the studio strip; while paused, audition it (playing: it lands on the next bar). */
  pickChordStyle(style: ChordStyle): void {
    this.updateSettings({ chordStyle: style });
    const meta = CHORD_STYLES.find((s) => s.id === style);
    if (meta && !this.solved) this.setFeedback('info', `${meta.label} style: ${meta.hint}. Sound only, it doesn't change your score.`);
    this.audition(() => {
      const v = this.voicings[this.selectedBar] ?? this.voicings.find(Boolean);
      if (v) this.engine.previewPattern(v, style);
    });
  }

  /** The mix a MIDI export should contain: the friend's/your shared mix in the receiver, else the studio bars. */
  private midiMix(): { puzzle: DailyPuzzle; voicings: readonly (Voicing | null)[] } {
    return (this.view === 'receiver' ? this.receiver.currentMix() : null) ?? { puzzle: this.puzzle, voicings: this.voicings };
  }

  /** True when at least one bar has a chord to export. */
  hasMidiContent(): boolean {
    return this.midiMix().voicings.some(Boolean);
  }

  /** Save the 4-bar loop (melody, chords in the current style, bass) as a .mid file. */
  downloadMidi(): void {
    const { puzzle: p, voicings } = this.midiMix();
    const bytes = buildMidi({
      bpm: p.bpm,
      melody: p.melody,
      voicings,
      style: this.settings.chordStyle,
      seed: p.puzzleNumber,
      keysProgram: PIANOS[this.settings.piano]?.gmProgram,
      melodyProgram: LEADS[this.settings.melodyTone]?.gmProgram,
    });
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `reharm-${p.puzzleNumber}-${this.settings.chordStyle}.mid`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Safari (iOS) starts the download asynchronously, after its own prompt: keep the URL alive.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------

  committedChords(): (Chord | null)[] {
    return this.bars.map((b) => (b.state === 'legal' || b.state === 'locked' || b.state === 'queued' ? b.chord : null));
  }

  private recomputeTiers(): void {
    const analysis = analyzeProgression(this.ctx.key, this.committedChords());
    this.bars.forEach((b, i) => {
      const a = analysis.bars[i];
      b.tier = a?.tier;
      b.deviceLabel = a?.deviceLabel;
      b.devicePlain = a?.devicePlain;
    });
  }

  private recomputeVoicings(): void {
    let prev: number[] | null = null;
    const order = [...BAR_INDICES.slice(this.puzzle.lockedBarIndex), ...BAR_INDICES.slice(0, this.puzzle.lockedBarIndex)];
    for (const i of order) {
      const b = this.bars[i]!;
      const v: Voicing | null = b.chord && b.state !== 'empty' ? voiceChord(b.chord, prev, b.custom ?? undefined) : null;
      this.voicings[i] = v;
      if (v) prev = v.upper;
    }
  }

  private pushUndo(): void {
    this.undoStack.push({ bars: this.bars.map((b) => ({ ...b })), voicings: [...this.voicings], selected: this.selectedBar });
    if (this.undoStack.length > 40) this.undoStack.shift();
  }

  get canEdit(): boolean {
    return !this.solved;
  }

  get canLock(): boolean {
    return !this.solved && this.bars.every((b) => b.state === 'locked' || b.state === 'legal');
  }

  selectBar(bar: BarIndex): void {
    if (bar === this.puzzle.lockedBarIndex) {
      replayClass(this.surface.slots()[bar], 'anim-brass-blink');
      this.setFeedback('info', `Bar ${bar + 1} is today’s harmonic anchor (${this.puzzle.anchorChord.symbol}).`);
      return;
    }
    this.selectedBar = bar;
    this.syncPaletteFromBar();
    this.renderSlots();
    this.renderDrawer();
  }

  private syncPaletteFromBar(): void {
    const b = this.bars[this.selectedBar];
    const c = b?.queued ?? b?.chord;
    this.palette = c
      ? { root: pcName(c.root), quality: c.type.family, bass: c.bass !== null ? pcName(c.bass) : null }
      : { root: null, quality: null, bass: null };
  }

  /** Apply a chord to a bar: clash shake, or queue to the next barline while looping, else snap legal. */
  applyChord(bar: BarIndex, chord: Chord, custom: number[] | null = null, autoAdvance = false, note = ''): void {
    if (!this.canEdit || bar === this.puzzle.lockedBarIndex) return;
    this.pushUndo();
    const b = this.bars[bar]!;
    const wasEmpty = b.state === 'empty';
    const prevIdx = ((bar + 3) % 4) as BarIndex;
    const voicing = voiceChord(chord, this.voicings[prevIdx]?.upper ?? null, custom ?? undefined);
    const ev = evaluateBar(this.ctx, this.committedChords(), bar, chord);

    if (ev.state === 'clash') {
      Object.assign(b, { chord, custom, state: 'clash', queued: null, clashReason: ev.clashReason, suggestions: ev.suggestions });
      this.voicings[bar] = voicing;
      this.engine.queueChord(bar, voicing, () => undefined);
      this.recomputeTiers();
      this.renderSlots();
      this.renderTransport();
      this.saveDraft();
      this.onClash(bar, ev.clashReason!, ev.suggestions);
      return;
    }

    const commit = () => {
      Object.assign(b, { chord, custom, state: 'legal', queued: null, clashReason: undefined, suggestions: undefined });
      this.voicings[bar] = voicing;
      this.recomputeTiers();
      this.renderSlots();
      this.renderTransport();
      this.onChordSwap(bar, 'legal', b.tier);
      const fresh = evaluateBar(this.ctx, this.committedChords(), bar, chord);
      this.setFeedback('legal', `${note}${fresh.message}`);
      this.saveDraft();
    };
    b.queued = chord;
    const mode = this.engine.queueChord(bar, voicing, commit);
    if (mode === 'queued') {
      b.state = 'queued';
      this.renderSlots();
      this.renderTransport();
      this.onChordSwap(bar, 'queued');
      this.setFeedback('queued', `${note}Next bar: ${chord.symbol} → Bar ${bar + 1} on the downbeat…`);
    }
    if (autoAdvance && wasEmpty) {
      const next = BAR_INDICES.find((i) => i !== this.puzzle.lockedBarIndex && this.bars[i]!.state === 'empty');
      if (next !== undefined) {
        this.selectedBar = next;
        this.syncPaletteFromBar();
        this.renderSlots();
      }
    }
    this.renderDrawer();
  }

  undo(): void {
    if (!this.canEdit) return;
    const snap = this.undoStack.pop();
    if (!snap) {
      this.setFeedback('info', 'Nothing to undo · hold the button to reset Bars.');
      return;
    }
    this.bars = snap.bars;
    this.voicings = snap.voicings;
    this.selectedBar = snap.selected;
    this.engine.setProgression(this.voicings);
    this.recomputeTiers();
    this.syncPaletteFromBar();
    this.saveDraft();
    this.renderAll();
    this.setFeedback('info', 'Undid last change.');
  }

  resetBars(): void {
    if (!this.canEdit) return;
    this.pushUndo();
    BAR_INDICES.forEach((i) => {
      if (i !== this.puzzle.lockedBarIndex) this.bars[i] = { chord: null, custom: null, state: 'empty', queued: null };
    });
    this.recomputeVoicings();
    this.engine.setProgression(this.voicings);
    this.recomputeTiers();
    this.selectedBar = this.firstOpenBar();
    this.syncPaletteFromBar();
    this.saveDraft();
    this.renderAll();
    this.setFeedback('info', 'Open bars cleared · tap undo to bring them back.');
  }

  private saveDraft(): void {
    if (this.solved) return;
    this.store.saveDraft({
      puzzleNumber: this.puzzle.puzzleNumber,
      symbols: this.bars.map((b, i) => (i === this.puzzle.lockedBarIndex ? null : (b.state === 'queued' ? b.queued : b.chord)?.symbol ?? null)),
      voicings: this.bars.map((b) => b.custom),
    });
  }

  lockMix(): void {
    if (this.solved) {
      this.modals.openReveal(this.scoreFor(this.solved.symbols), false);
      return;
    }
    if (!this.canLock) return;
    const chords = this.bars.map((b) => b.chord!);
    const score = scoreProgression(this.ctx, chords);
    this.solved = this.store.recordResult({
      puzzleNumber: this.puzzle.puzzleNumber,
      dateISO: this.puzzle.dateISO,
      symbols: chords.map((c) => c.symbol),
      total: score.total,
      rarity: score.rarity,
      melodyColor: score.melodyColor,
      bassFlow: score.bassFlow,
      tier: score.overallTier,
      percentileLabel: score.percentileLabel,
      badges: score.unlockedBadges.map((b) => b.id),
      barTiers: score.barTiers,
    });
    this.renderAll();
    this.setFeedback('legal', `✓ Mix locked · ${score.total}/100 · ${score.percentileLabel}`);
    this.onScoreReveal({
      total: score.total,
      rarity: score.rarity,
      melodyColor: score.melodyColor,
      bassFlow: score.bassFlow,
      percentileLabel: score.percentileLabel,
      unlockedBadges: score.unlockedBadges.map((b) => b.id),
    });
  }

  scoreFor(symbols: readonly string[]): FullScore {
    return scoreProgression(this.ctx, symbols.map((s) => parseChord(s)!));
  }

  togglePlay(): void {
    if (this.engine.status === 'locked' && !this.settings.isMuted) {
      // Any play tap is a gesture: use it to unlock audio, then start.
      void this.ensureAudio().then(() => {
        if (!this.engine.isPlaying) this.engine.play();
        this.setPlayingUI(this.engine.isPlaying);
      });
      return;
    }
    const on = this.engine.toggle();
    this.setPlayingUI(on);
  }

  setPlayingUI(on: boolean): void {
    this.playing = on;
    const btn = $('#btn-play-toggle');
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Pause loop' : 'Play loop');
    btn.classList.toggle('is-on', on);
    $('#txt-play-state').textContent = on ? 'Pause' : 'Play';
    $('#icon-play-state').innerHTML = on ? ICONS.pause : ICONS.play;
    this.surface.beam.classList.toggle('is-visible', on);
    this.receiver.syncPlayState(on);
  }

  private onStopped(): void {
    this.setPlayingUI(false);
    this.clearPlayVisuals();
  }

  private clearPlayVisuals(): void {
    if (!this.surface) return;
    this.sounding.forEach((id) => this.surface.pills.get(id)?.setAttribute('data-sounding', 'false'));
    this.sounding.clear();
    this.surface.cols.forEach((c) => c.classList.remove('is-playing'));
    this.surface.beam.classList.remove('is-visible');
    this.surface.slots().forEach((s) => {
      s.classList.remove('is-playing-bar');
      $$('.beat-led', s).forEach((l) => l.classList.remove('is-lit', 'is-remaining'));
    });
    this.current = null;
  }

  // ---------------------------------------------------------------------------
  // ReharmVisualHooks (motion-spec §3)
  // ---------------------------------------------------------------------------

  onTransportFrame(progress: number, activeNoteIds: string[]): void {
    const s = this.surface;
    if (!this.beamWidth) this.measure();
    s.beam.classList.add('is-visible');
    s.beam.style.transform = `translateX(${(progress * this.beamWidth).toFixed(1)}px)`;
    const next = new Set(activeNoteIds);
    for (const id of this.sounding) if (!next.has(id)) s.pills.get(id)?.setAttribute('data-sounding', 'false');
    for (const id of next) if (!this.sounding.has(id)) s.pills.get(id)?.setAttribute('data-sounding', 'true');
    this.sounding = next;
  }

  onBeat(barIndex: BarIndex, beatIndex: 0 | 1 | 2 | 3): void {
    this.current = { bar: barIndex, beat: beatIndex };
    this.surface.cols.forEach((c, i) => c.classList.toggle('is-playing', i === barIndex));
    this.surface.slots().forEach((slot, i) => {
      slot.classList.toggle('is-playing-bar', i === barIndex);
      const queued = slot.dataset.slotState === 'queued';
      $$('.beat-led', slot).forEach((led, j) => {
        led.classList.toggle('is-lit', i === barIndex && j === beatIndex);
        // Queued bars count down the beats left before the swap lands.
        led.classList.toggle('is-remaining', queued && j > beatIndex);
      });
    });
  }

  onBarStart(barIndex: BarIndex): void {
    this.current = { bar: barIndex, beat: 0 };
  }

  onChordSwap(barIndex: BarIndex, state: 'queued' | 'legal' | 'clash' | 'empty', _tier?: SpiceTier): void {
    // Slot markup already carries the earned tier; the hook drives the downbeat bloom.
    const slot = this.surface.slots()[barIndex];
    if (state === 'legal') replayClass(slot, 'anim-legal-snap');
  }

  onClash(barIndex: BarIndex, clashReason: string, suggestions: string[] = []): void {
    this.feedbackBar = barIndex;
    replayClass(this.surface.slots()[barIndex], 'anim-clash-shake');
    const tip = suggestions.length ? ` Try ${suggestions.slice(0, -1).join(', ')}${suggestions.length > 1 ? ', or ' : ''}${suggestions[suggestions.length - 1]}.` : '';
    this.setFeedback('clash', `⚠ ${clashReason}${tip}`, suggestions);
  }

  onScoreReveal(_breakdown: Parameters<ReharmVisualHooks['onScoreReveal']>[0]): void {
    if (!this.solved) return;
    this.modals.openReveal(this.scoreFor(this.solved.symbols), true);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  renderAll(): void {
    this.renderHeader();
    this.renderSlots();
    this.renderTransport();
    this.renderDrawer();
  }

  renderHeader(): void {
    const p = this.puzzle;
    const pill = $<HTMLButtonElement>('#puzzle-pill');
    pill.innerHTML = this.solved
      ? `<strong>#${p.puzzleNumber}</strong> · <span class="solved-score">✓ ${this.solved.total}</span> <span class="hide-xs">· ${esc(shortKey(p))} · ${p.bpm} BPM</span>`
      : `<strong>#${p.puzzleNumber}</strong> · ${esc(shortKey(p))} <span class="hide-xs">· ${p.bpm} BPM</span>`;
    pill.disabled = !this.solved;
    pill.classList.toggle('is-solved', Boolean(this.solved));
    pill.title = this.solved ? 'Share today’s mix' : `Puzzle #${p.puzzleNumber}`;
    $('#bpm-readout').textContent = `${p.bpm} BPM`;
    // Reharm Daily strip: REHARM only knows its own result ("1/1 today" read as the whole sheet being done).
    $('#daily-mini-count').textContent = this.solved ? 'REHARM done' : 'Daily sheet';
    $('#daily-mini-dot').classList.toggle('is-done', Boolean(this.solved));
    $('#daily-ritual-mini').setAttribute('aria-label', `${this.solved ? 'REHARM done today. ' : ''}Open today's Reharm Daily sheet`);
  }

  renderSlots(): void {
    const grid = $('#chord-slots-grid');
    grid.innerHTML = this.bars.map((b, i) => this.slotHtml(b, i as BarIndex)).join('');
    $$('.bar-slot', grid).forEach((el) => {
      el.addEventListener('click', () => this.selectBar(Number(el.dataset.bar) as BarIndex));
    });
    if (this.current && this.playing) this.onBeat(this.current.bar, this.current.beat as 0 | 1 | 2 | 3);
  }

  private slotHtml(b: StudioBar, i: BarIndex): string {
    const locked = b.state === 'locked';
    const selected = i === this.selectedBar && !locked;
    const shown = b.state === 'queued' ? b.queued : b.chord;
    const top = locked
      ? `<span class="slot-lock-badge" aria-label="Anchored">${LOCK_SVG}</span>`
      : `<span class="beat-leds" aria-hidden="true" title="Beat lights: the bar's 4 beats, lit as it plays">${'<span class="beat-led"></span>'.repeat(4)}</span>`;
    const center = shown
      ? `<span class="slot-chord">${esc(shown.symbol)}</span><span class="slot-voicing-notes">${esc(chordToneNames(shown))}</span>`
      : `<span class="slot-empty-label">+ Chord</span>`;
    let bottom = '';
    if (b.state === 'queued') bottom = `<span class="tier-badge" data-tier="queued">NEXT BAR</span>`;
    else if (b.state === 'clash') bottom = `<span class="tier-badge" data-tier="clash">⚠ CLASH</span>`;
    else if (locked && b.tier) bottom = `<span class="tier-badge" data-tier="${b.tier}">${TIER_LABEL[b.tier].split(' ')[0]} Anchor</span>`;
    else if (b.tier && b.state === 'legal') bottom = `<span class="tier-badge" data-tier="${b.tier}" title="${esc(b.deviceLabel ? `${b.deviceLabel}${b.devicePlain ? ` (${b.devicePlain})` : ''}` : '')}">${TIER_LABEL[b.tier]}</span>`;
    const label = locked ? 'ANCHOR' : `BAR ${i + 1}`;
    const aria = `Bar ${i + 1}: ${shown ? shown.symbol : 'empty'}${b.state === 'clash' ? ', clashing' : ''}${locked ? ', anchored' : ''}`;
    return `<button type="button" class="bar-slot${selected ? ' is-selected' : ''}" role="tab" aria-selected="${selected}" aria-label="${esc(aria)}"
      data-bar="${i}" data-slot-state="${b.state}"${locked || this.solved ? ' aria-disabled="true"' : ''}>
      <div class="slot-top"><span class="slot-bar-num">${label}</span>${top}</div>
      <div class="slot-center">${center}</div>
      <div class="slot-bottom">${bottom}</div>
    </button>`;
  }

  renderTransport(): void {
    const btn = $<HTMLButtonElement>('#btn-lock-mix');
    if (this.solved) {
      btn.disabled = false;
      $('#txt-lock-mix').textContent = 'View Score';
      btn.title = 'Today’s mix is locked — view your breakdown';
    } else {
      btn.disabled = !this.canLock;
      $('#txt-lock-mix').textContent = 'Lock Mix';
      btn.title = this.canLock ? 'Lock your progression and reveal the score' : 'Fill all 4 bars cleanly to lock';
    }
    $<HTMLButtonElement>('#btn-reset-bars').disabled = Boolean(this.solved);
  }

  setFeedback(tone: FeedbackTone, text: string, fixes: string[] = []): void {
    const strip = $('#feedback-strip');
    if (tone === 'info') delete strip.dataset.tone;
    else strip.dataset.tone = tone;
    $('#feedback-msg').textContent = text;
    const fixesEl = $('#feedback-fixes');
    fixesEl.innerHTML = '';
    for (const sym of fixes) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'fix-chip';
      chip.textContent = sym;
      chip.addEventListener('click', () => {
        const c = parseChord(sym);
        const bar = this.feedbackBar ?? this.selectedBar;
        if (c) {
          this.selectedBar = bar;
          this.applyChord(bar, c);
          this.syncPaletteFromBar();
          this.renderDrawer();
        }
      });
      fixesEl.appendChild(chip);
    }
  }

  // ---------------------------------------------------------------------------
  // Drawer: palette + piano
  // ---------------------------------------------------------------------------

  renderDrawer(): void {
    const mode = this.settings.inputMode;
    $('#tab-palette').setAttribute('aria-selected', String(mode === 'palette'));
    $('#tab-piano').setAttribute('aria-selected', String(mode === 'piano'));
    $('#panel-palette').hidden = mode !== 'palette';
    $('#panel-piano').hidden = mode !== 'piano';
    $('#btn-helper-toggle').setAttribute('aria-pressed', String(this.settings.consonantHelper));
    $('#helper-legend-note').style.opacity = this.settings.consonantHelper ? '1' : '0';
    $('#input-drawer').dataset.helper = String(this.settings.consonantHelper);
    $('#editing-badge').innerHTML = this.solved
      ? 'Mix <strong style="color:var(--accent-primary)">LOCKED</strong>'
      : `Editing <strong style="color:var(--accent-primary)">BAR ${this.selectedBar + 1}</strong>`;
    if (mode === 'palette') this.renderPalette();
    else this.renderPiano();
  }

  private renderPalette(): void {
    const hint = this.puzzle.consonantHintsByBar[this.selectedBar];
    const safeRoots = new Set(hint.safeRoots);
    const notes = barNotes(this.puzzle.melody, this.selectedBar);
    const safeQuals = new Set(this.palette.root ? safeQualitiesForRoot(this.puzzle.melody, this.selectedBar, this.palette.root) : hint.safeQualities);
    const disabled = this.canEdit ? '' : ' disabled';

    $('#roots-grid').innerHTML = NOTE_NAMES.map((r) => `<button type="button" class="keycap-btn" data-root="${r}" aria-pressed="${r === this.palette.root}" data-consonant="${safeRoots.has(r)}"${disabled}>${r}<span class="consonant-led"></span></button>`).join('');
    $('#qualities-grid').innerHTML = PALETTE_QUALITIES.map((q) => `<button type="button" class="keycap-btn" data-quality="${esc(q)}" aria-pressed="${q === this.palette.quality}" data-consonant="${safeQuals.has(q)}"${disabled}>${esc(q)}<span class="consonant-led"></span></button>`).join('');

    const { root, quality, bass } = this.palette;
    $('#palette-preview-chord').textContent = root && quality ? colorize(paletteChord(root, quality, bass), notes).symbol : root ? `${root} …` : '';

    // A locked day hides the / Bass row: it stayed tappable after locking and pushed the page past 844px.
    const slashRow = $('#btn-toggle-slash').closest<HTMLElement>('.slash-row');
    if (slashRow) slashRow.hidden = !this.canEdit;
    $<HTMLButtonElement>('#btn-toggle-slash').disabled = !this.canEdit;
    if (!this.canEdit) this.slashOpen = false;
    const chips = $('#slash-chips');
    chips.hidden = !this.slashOpen;
    $('#btn-toggle-slash').setAttribute('aria-expanded', String(this.slashOpen));
    $('#btn-toggle-slash').classList.toggle('has-bass', Boolean(bass));
    $('#slash-current-label').textContent = bass ? `/${bass}` : 'Root';
    chips.innerHTML = [null, ...NOTE_NAMES].map((n) => `<button type="button" class="slash-chip" data-bass="${n ?? ''}" aria-pressed="${n === bass}"${disabled}>${n ? `/${n}` : 'None'}</button>`).join('');

    this.renderLockedNote('#panel-palette');
  }

  /** Disabled inputs on a locked day explain themselves (palette and piano alike). */
  private renderLockedNote(panel: string): void {
    const drawer = $(panel);
    drawer.querySelector('.drawer-locked-note')?.remove();
    if (!this.canEdit) {
      drawer.insertAdjacentHTML('afterbegin', `<div class="drawer-locked-note">Mix locked for today — Puzzle #${this.puzzle.puzzleNumber + 1} drops at midnight. Tap <strong>View Score</strong> to share.</div>`);
    }
  }

  onRoot(r: NoteName): void {
    this.palette.root = r;
    this.tryApplyPalette();
    this.renderPalette();
  }

  onQuality(q: ChordQuality): void {
    this.palette.quality = q;
    this.tryApplyPalette();
    this.renderPalette();
  }

  onBass(b: NoteName | null): void {
    this.palette.bass = b;
    this.tryApplyPalette();
    this.renderPalette();
  }

  private tryApplyPalette(): void {
    const { root, quality, bass } = this.palette;
    if (!root || !quality) return;
    const bar = this.selectedBar;
    const notes = barNotes(this.puzzle.melody, bar);
    const plain = paletteChord(root, quality, bass);
    const chord = colorize(plain, notes);
    this.applyChord(bar, chord, null, true, extensionNote(plain, chord, notes));
  }

  private renderPiano(): void {
    const hint = this.puzzle.consonantHintsByBar[this.selectedBar];
    const safe = new Set(hint.safeMidiNotes);
    const disabled = this.canEdit ? '' : ' disabled';
    const bed = $('#piano-bed');
    bed.innerHTML =
      WHITE_KEYS.map((m) => `<button type="button" class="white-key" data-midi="${m}" data-consonant="${safe.has(m)}" aria-pressed="${this.piano.has(m)}" aria-label="${midiLabel(m)}"${disabled}><span class="piano-helper-dot"></span><span>${midiLabel(m)}</span></button>`).join('') +
      BLACK_KEYS.map((k) => {
        const ratio = (k.slotAfter + 1) / WHITE_KEYS.length;
        return `<button type="button" class="black-key" data-midi="${k.midi}" data-consonant="${safe.has(k.midi)}" aria-pressed="${this.piano.has(k.midi)}" aria-label="${midiLabel(k.midi)}" style="left:calc(6px + (100% - 12px) * ${ratio.toFixed(6)} - 15px)"${disabled}><span class="piano-helper-dot"></span><span>${pcName(k.midi)}</span></button>`;
      }).join('');
    this.updatePianoReadout();
    this.renderLockedNote('#panel-piano');
  }

  private updatePianoReadout(): void {
    const held = [...this.piano].sort((a, b) => a - b);
    $('#piano-notes-list').textContent = held.length ? held.map(midiLabel).join(' · ') : 'Tap keys to toggle a voicing';
    const rec = recognizeChord(held);
    const guess = $('#piano-chord-guess');
    const apply = $<HTMLButtonElement>('#btn-piano-apply');
    apply.textContent = `Apply to Bar ${this.selectedBar + 1}`;
    if (!held.length) {
      guess.textContent = 'Empty';
    } else if (!rec) {
      guess.textContent = held.length < 3 ? 'Interval' : 'Unrecognized cluster';
    } else {
      const ev = evaluateBar(this.ctx, this.committedChords(), this.selectedBar, rec.chord);
      const badge = ev.state === 'clash'
        ? `<span class="tier-badge piano-tier" data-tier="clash">⚠ Clash</span>`
        : `<span class="tier-badge piano-tier" data-tier="${ev.tier}">${TIER_LABEL[ev.tier]}</span>`;
      guess.innerHTML = `${esc(rec.chord.symbol)} ${badge}`;
    }
    apply.disabled = !rec || !this.canEdit;
    $<HTMLButtonElement>('#btn-piano-clear').disabled = !held.length;
  }

  onPianoKey(midi: number): void {
    if (!this.canEdit) return;
    if (this.piano.has(midi)) this.piano.delete(midi);
    else this.piano.add(midi);
    $$(`[data-midi="${midi}"]`, $('#piano-bed')).forEach((k) => k.setAttribute('aria-pressed', String(this.piano.has(midi))));
    this.engine.previewNotes([...this.piano].sort((a, b) => a - b));
    this.updatePianoReadout();
  }

  // ---------------------------------------------------------------------------
  // Static bindings
  // ---------------------------------------------------------------------------

  private bindStatic(): void {
    $('#btn-power-studio').addEventListener('click', () => {
      // iOS unlock MUST start synchronously inside this tap.
      const unlocking = this.engine.unlock();
      this.updateSettings({ isMuted: false });
      $('#modal-gate').hidden = true;
      void unlocking.then((ok) => {
        if (ok) {
          this.engine.setMuted(false);
          if (!this.engine.isPlaying && this.view === 'studio') {
            this.engine.play();
            this.setPlayingUI(true);
          }
          this.setFeedback('info', this.solved ? `Studio powered on · replaying your locked mix.` : `Studio powered on · ${this.puzzle.bpm} BPM loop running. Pick Bar ${this.selectedBar + 1}.`);
        } else {
          this.setFeedback('info', 'Audio could not start on this device — continuing in visual mode.');
        }
        this.modals.refreshSettings();
        this.afterGate();
      });
    });

    $('#btn-continue-muted').addEventListener('click', () => {
      this.updateSettings({ isMuted: true });
      $('#modal-gate').hidden = true;
      this.setFeedback('info', 'Muted visual studio active · tap Play anytime.');
      this.afterGate();
    });

    $('#btn-play-toggle').addEventListener('click', () => this.togglePlay());
    $('#btn-loop-toggle').addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLElement;
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('is-on', on);
      this.engine.setLoop(on);
    });

    // Undo on tap, reset on long-press.
    const reset = $('#btn-reset-bars');
    let holdTimer = 0;
    let held = false;
    reset.addEventListener('pointerdown', () => {
      held = false;
      holdTimer = window.setTimeout(() => {
        held = true;
        this.resetBars();
      }, 650);
    });
    const cancelHold = () => window.clearTimeout(holdTimer);
    reset.addEventListener('pointerup', cancelHold);
    reset.addEventListener('pointerleave', cancelHold);
    reset.addEventListener('click', () => {
      if (!held) this.undo();
      held = false;
    });

    $('#btn-lock-mix').addEventListener('click', () => this.lockMix());
    this.renderStyleStrip();
    $('#style-strip-chips').addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-style]');
      if (chip) this.pickChordStyle(chip.dataset.style as ChordStyle);
    });
    $('#puzzle-pill').addEventListener('click', () => {
      if (this.solved) this.modals.openShare(this.scoreFor(this.solved.symbols));
    });

    $('#tab-palette').addEventListener('click', () => this.updateSettings({ inputMode: 'palette' }));
    $('#tab-piano').addEventListener('click', () => this.updateSettings({ inputMode: 'piano' }));
    $('#btn-helper-toggle').addEventListener('click', () => this.updateSettings({ consonantHelper: !this.settings.consonantHelper }));
    $('#btn-toggle-slash').addEventListener('click', () => {
      this.slashOpen = !this.slashOpen;
      this.renderPalette();
    });

    $('#roots-grid').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-root]');
      if (b && !b.disabled) this.onRoot(b.dataset.root as NoteName);
    });
    $('#qualities-grid').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-quality]');
      if (b && !b.disabled) this.onQuality(b.dataset.quality as ChordQuality);
    });
    $('#slash-chips').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-bass]');
      if (b && !b.disabled) this.onBass((b.dataset.bass || null) as NoteName | null);
    });
    $('#piano-bed').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-midi]');
      if (b && !b.disabled) this.onPianoKey(Number(b.dataset.midi));
    });
    $('#btn-piano-clear').addEventListener('click', () => {
      this.piano.clear();
      this.renderPiano();
    });
    $('#btn-piano-apply').addEventListener('click', () => {
      const held = [...this.piano].sort((a, b) => a - b);
      const rec = recognizeChord(held);
      if (!rec) {
        this.setFeedback('info', 'Hold at least 3 notes that form a chord, then Apply.');
        return;
      }
      this.applyChord(this.selectedBar, rec.chord, held);
      this.syncPaletteFromBar();
      this.updatePianoReadout();
    });

    $('#btn-open-howto').addEventListener('click', () => this.modals.openHowTo());
    $('#btn-open-stats').addEventListener('click', () => this.modals.openStats());
    $('#btn-open-settings').addEventListener('click', () => this.modals.openSettings());

    document.addEventListener('keydown', (e) => this.onKey(e));
  }

  private onKey(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape') {
      this.modals.closeAll();
      return;
    }
    if (this.modals.anyOpen()) return;
    if (e.key === ' ' || e.code === 'Space') {
      if (tag === 'BUTTON') return; // let the focused button handle Space
      e.preventDefault();
      if (this.view === 'receiver') this.receiver.togglePlay();
      else this.togglePlay();
      return;
    }
    if (this.view === 'studio' && /^[1-4]$/.test(e.key)) {
      this.selectBar((Number(e.key) - 1) as BarIndex);
    }
  }

  /** Voicings for an arbitrary progression (receiver / A-B compare). */
  voicingsFor(chords: readonly Chord[], lockedBarIndex: BarIndex): Voicing[] {
    const out: Voicing[] = [];
    let prev: number[] | null = null;
    const order = [...BAR_INDICES.slice(lockedBarIndex), ...BAR_INDICES.slice(0, lockedBarIndex)];
    for (const i of order) {
      out[i] = voiceChord(chords[i]!, prev);
      prev = out[i]!.upper;
    }
    return out;
  }
}
