/** View 7 — Shared-Mix Receiver: spoiler-safe unplayed mode + side-by-side A/B compare. */
import type { BarIndex, DailyPuzzle, ReceiverCompareData } from '../types';
import { BAR_INDICES } from '../types';
import { type Chord, type FullScore, type Voicing, TIER_LABEL, parseChord, scoreProgression, toChordInput } from '../theory';
import { puzzleKey } from '../puzzles';
import type { DecodedMix } from '../share/codec';
import { $, $$, esc } from './dom';
import { ICONS } from './assets';
import { badgeItems, bindBadgeFallbacks } from './modals';
import { type ReharmApp, type Surface, renderOled } from './app';

const LOCK_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;

interface ReceiverState {
  decoded: DecodedMix;
  puzzle: DailyPuzzle;
  friend: { chords: Chord[]; score: FullScore; voicings: Voicing[] };
  mine: { chords: Chord[]; score: FullScore; voicings: Voicing[] } | null;
  mode: 'unplayed' | 'compare';
  peek: boolean;
  source: 'friend' | 'yours';
  surface: Surface | null;
}

export class Receiver {
  private st: ReceiverState | null = null;

  constructor(private readonly app: ReharmApp) {}

  /** Contract shape for the compare data (exposed for debugging / future features). */
  compareData(): ReceiverCompareData | null {
    const s = this.st;
    if (!s) return null;
    const bars = (chords: Chord[], score: FullScore) => chords.map((c, i) => ({
      barIndex: i as BarIndex,
      state: i === s.puzzle.lockedBarIndex ? 'locked' as const : 'legal' as const,
      chord: toChordInput(c),
      tier: score.barTiers[i],
    }));
    return {
      senderName: this.name,
      puzzleNumber: s.puzzle.puzzleNumber,
      hasPlayerSolvedToday: Boolean(s.mine),
      friendBars: bars(s.friend.chords, s.friend.score),
      friendScore: s.friend.score,
      playerBars: s.mine ? bars(s.mine.chords, s.mine.score) : undefined,
      playerScore: s.mine?.score,
    };
  }

  private get name(): string {
    return this.st?.decoded.senderName ?? 'Friend';
  }

  private get possessive(): string {
    const n = this.name;
    return n === 'Friend' ? 'Your Friend’s' : `${n}’s`;
  }

  open(decoded: DecodedMix, puzzle: DailyPuzzle): void {
    const app = this.app;
    app.engine.stop();
    const ctx = { key: puzzleKey(puzzle), melody: puzzle.melody, lockedBarIndex: puzzle.lockedBarIndex };
    const friendChords = [...decoded.chords];
    const friendScore = scoreProgression(ctx, friendChords);
    const result = app.store.getResult(puzzle.puzzleNumber);
    let mine: ReceiverState['mine'] = null;
    if (result) {
      const chords = result.symbols.map((s) => parseChord(s)).filter((c): c is Chord => Boolean(c));
      if (chords.length === 4) {
        mine = { chords, score: scoreProgression(ctx, chords), voicings: app.voicingsFor(chords, puzzle.lockedBarIndex) };
      }
    }
    this.st = {
      decoded,
      puzzle,
      friend: { chords: friendChords, score: friendScore, voicings: app.voicingsFor(friendChords, puzzle.lockedBarIndex) },
      mine,
      mode: mine ? 'compare' : 'unplayed',
      peek: false,
      source: 'friend',
      surface: null,
    };
    app.view = 'receiver';
    $('#workspace-studio').hidden = true;
    const root = $('#workspace-receiver');
    root.hidden = false;
    this.render();
    app.engine.load(puzzle);
    app.engine.setProgression(this.st.friend.voicings);
  }

  close(): void {
    if (!this.st) return;
    const app = this.app;
    app.engine.stop();
    this.st = null;
    app.view = 'studio';
    $('#workspace-receiver').hidden = true;
    $('#workspace-studio').hidden = false;
    app.useSurface(null);
    app.restoreStudioAudio();
  }

  syncPlayState(on: boolean): void {
    if (!this.st) return;
    const label = document.getElementById('rec-play-label');
    const icon = document.getElementById('rec-play-icon');
    if (label) label.textContent = on ? 'Pause' : this.st.mode === 'compare' ? `Play ${this.st.source === 'friend' ? this.possessive : 'Your'} Mix` : `Hear ${this.possessive} Mix`;
    if (icon) icon.innerHTML = on ? ICONS.pause : ICONS.play;
  }

  togglePlay(): void {
    const app = this.app;
    if (app.engine.status === 'locked' && !app.settings.isMuted) {
      void app.ensureAudio().then(() => {
        if (this.st) app.engine.load(this.st.puzzle);
        this.applySource();
        if (!app.engine.isPlaying) app.engine.play();
        app.setPlayingUI(app.engine.isPlaying);
      });
      return;
    }
    app.setPlayingUI(app.engine.toggle());
  }

  /** The mix currently loaded in the engine (for MIDI export while the receiver is open). */
  currentMix(): { puzzle: DailyPuzzle; voicings: Voicing[] } | null {
    const s = this.st;
    if (!s) return null;
    return { puzzle: s.puzzle, voicings: s.source === 'yours' && s.mine ? s.mine.voicings : s.friend.voicings };
  }

  private applySource(): void {
    const mix = this.currentMix();
    if (mix) this.app.engine.setProgression(mix.voicings);
  }

  private render(): void {
    const s = this.st!;
    const { puzzle, friend, mine } = s;
    const root = $('#workspace-receiver');
    const hasCompare = Boolean(mine);
    const isToday = puzzle.puzzleNumber === this.app.todayNumber;
    root.innerHTML = `
      <div class="receiver-header">
        <div class="receiver-meta">
          <div class="mono" style="font-size:11px; color:var(--accent-primary);">SHARED PLAYABLE LINK · PUZZLE #${puzzle.puzzleNumber}${isToday ? ' · TODAY' : ''}</div>
          <h1 class="receiver-title" style="margin:2px 0 0;">${esc(this.possessive)} Mix · Puzzle #${puzzle.puzzleNumber}</h1>
        </div>
        <span class="rank-pill" data-tier="${friend.score.overallTier}">${friend.score.total}/100 · ${esc(friend.score.percentileLabel)}</span>
      </div>
      <div class="oled-screen" id="receiver-oled"></div>
      <div class="receiver-toolbar">
        ${hasCompare ? `<div class="segmented-switch" role="tablist" aria-label="Receiver mode">
            <button class="seg-btn" type="button" data-mode="unplayed" aria-selected="${s.mode === 'unplayed'}">Spoiler-Safe</button>
            <button class="seg-btn" type="button" data-mode="compare" aria-selected="${s.mode === 'compare'}">A/B Compare</button>
          </div>` : `<span class="mono" style="font-size:11px; color:var(--text-muted);">${esc(puzzle.keyLabel.toUpperCase())} · ${puzzle.bpm} BPM</span>`}
        ${s.mode === 'unplayed' ? `<button class="mini-btn" type="button" id="rec-peek-btn" aria-pressed="${s.peek}">${s.peek ? 'Hide chords' : 'Tap to peek chords'}</button>` : ''}
      </div>
      ${s.mode === 'compare' && mine ? this.abSwitch(friend.score.total, mine.score.total) : ''}
      <button class="receiver-hero-play" type="button" id="rec-play-btn">
        <span class="icon-slot" id="rec-play-icon">${this.app.engine.isPlaying ? ICONS.pause : ICONS.play}</span>
        <span id="rec-play-label"></span>
      </button>
      ${s.mode === 'unplayed' ? `<div class="chord-slots-grid" id="rec-unplayed-grid">${this.veiledSlots()}</div>` : this.compareTable()}
      <div>
        <div class="palette-section-label"><span>${esc(this.possessive)} Flavor Pins (${friend.score.unlockedBadges.length})</span></div>
        ${badgeItems(friend.score.unlockedBadges)}
      </div>
      <button class="cta-primary" type="button" id="rec-play-today-btn" style="height:52px; width:100%;">🎹 ${isToday && mine ? 'Back to Today’s Studio' : 'Play Today’s Reharm'}</button>`;

    s.surface = renderOled($('#receiver-oled', root), puzzle);
    s.surface.slots = () => $$('.bar-slot', root);
    this.app.useSurface(s.surface);
    bindBadgeFallbacks(root);
    this.syncPlayState(this.app.engine.isPlaying);

    $('#rec-play-btn', root).addEventListener('click', () => this.togglePlay());
    $('#rec-play-today-btn', root).addEventListener('click', () => {
      history.replaceState(null, '', location.pathname + location.search);
      this.close();
      this.app.showGate();
    });
    root.querySelector('#rec-peek-btn')?.addEventListener('click', () => {
      s.peek = !s.peek;
      this.render();
    });
    $$('[data-mode]', root).forEach((b) => b.addEventListener('click', () => {
      s.mode = b.dataset.mode as ReceiverState['mode'];
      this.render();
    }));
    $$('[data-source]', root).forEach((b) => b.addEventListener('click', () => {
      s.source = b.dataset.source as ReceiverState['source'];
      this.applySource(); // live switch lands on the next barline
      $$('[data-source]', root).forEach((x) => x.setAttribute('aria-selected', String(x.dataset.source === s.source)));
      if (!this.app.engine.isPlaying) this.togglePlay();
      else this.syncPlayState(true);
    }));
  }

  private abSwitch(friendTotal: number, myTotal: number): string {
    const s = this.st!;
    const delta = friendTotal - myTotal;
    const shared = s.friend.score.unlockedBadges.filter((b) => s.mine!.score.unlockedBadges.some((m) => m.id === b.id)).map((b) => b.title);
    const unique = s.friend.score.unlockedBadges.filter((b) => !shared.includes(b.title)).map((b) => b.title);
    return `
      <div class="compare-delta">
        <div class="segmented-switch" role="tablist" aria-label="A/B audio source">
          <button class="seg-btn" type="button" data-source="friend" aria-selected="${s.source === 'friend'}">Play ${esc(this.name)} (${friendTotal})</button>
          <button class="seg-btn" type="button" data-source="yours" aria-selected="${s.source === 'yours'}">Play Yours (${myTotal})</button>
        </div>
        <span class="tier-badge" data-tier="${delta > 0 ? 'deep-reharm' : delta < 0 ? 'radio-safe' : 'jazz-standard'}" style="font-size:11px; padding:4px 8px;">${delta > 0 ? `+${delta}` : delta} Spice${delta > 0 ? ` to ${esc(this.name)}` : delta < 0 ? ' to you' : ' · tie'}</span>
      </div>
      <div class="meter-sub">${shared.length ? `Shared pins: ${esc(shared.join(', '))}` : 'No shared pins'}${unique.length ? ` · Only ${esc(this.name)}: ${esc(unique.join(', '))}` : ''}</div>`;
  }

  private veiledSlots(): string {
    const s = this.st!;
    return BAR_INDICES.map((i) => {
      const c = s.friend.chords[i]!;
      const locked = i === s.puzzle.lockedBarIndex;
      const tier = s.friend.score.barTiers[i]!;
      const show = locked || s.peek;
      return `<div class="bar-slot"${locked ? ' data-slot-state="locked"' : ''} data-bar="${i}">
        <div class="slot-top"><span class="slot-bar-num">${locked ? 'ANCHOR' : `BAR ${i + 1}`}</span>${locked ? `<span class="slot-lock-badge">${LOCK_SVG}</span>` : '<span class="beat-leds" aria-hidden="true" title="Beat lights: the bar\'s 4 beats, lit as it plays">' + '<span class="beat-led"></span>'.repeat(4) + '</span>'}</div>
        <div class="slot-center">${show ? `<span class="slot-chord">${esc(c.symbol)}</span>` : `<span class="spoiler-shutter">🔒 Hidden</span>`}</div>
        <div class="slot-bottom"><span class="tier-badge" data-tier="${tier}">${locked ? '🔒 Anchor' : TIER_LABEL[tier]}</span></div>
      </div>`;
    }).join('');
  }

  private compareTable(): string {
    const s = this.st!;
    const mine = s.mine!;
    return `<div class="compare-table" id="rec-compare-panel">
      <div class="compare-head"><span>Bar</span><span>${esc(this.name)}</span><span>You</span></div>
      ${BAR_INDICES.map((i) => `
        <div class="compare-row bar-slot-row" data-bar="${i}">
          <span class="mono" style="font-size:11px; color:var(--text-muted);">BAR ${i + 1}</span>
          <div class="chord-cell"><span class="mono">${esc(s.friend.chords[i]!.symbol)}</span><span class="tier-badge" data-tier="${s.friend.score.barTiers[i]}">${TIER_LABEL[s.friend.score.barTiers[i]!].split(' ')[0]}</span></div>
          <div class="chord-cell"><span class="mono">${esc(mine.chords[i]!.symbol)}</span><span class="tier-badge" data-tier="${mine.score.barTiers[i]}">${TIER_LABEL[mine.score.barTiers[i]!].split(' ')[0]}</span></div>
        </div>`).join('')}
    </div>`;
  }
}
