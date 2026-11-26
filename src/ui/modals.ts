import type { BadgeId, SpiceTier, UnlockedBadge, UserSettings } from '../types';
import { CHORD_STYLES } from '../audio/patterns';
import { PIANOS, PIANO_IDS } from '../audio/pianos';
import { LEADS, LEAD_IDS } from '../audio/leads';
import { BADGE_IDS } from '../types';
import { BADGE_META, type FullScore, tierForTotal } from '../theory';
import { buildSharePayload } from '../share/card';
import { DAILY_SHARE_URL, LAB_CHANGES_URL } from '../share/daily';
import { labChipHtml } from './labChip';
import { $, $$, copyText, esc, prefersReducedMotion } from './dom';
import { BADGE_PNG, BADGE_SVG, ICONS } from './assets';
import type { ReharmApp } from './app';

const MODAL_IDS = ['modal-reveal', 'modal-share', 'modal-howto', 'modal-stats', 'modal-settings'] as const;
type ModalId = (typeof MODAL_IDS)[number];

const TIER_ROWS: { tier: SpiceTier; key: 'deepReharm' | 'modalInterchange' | 'jazzStandard' | 'radioSafe'; label: string; color: string }[] = [
  { tier: 'deep-reharm', key: 'deepReharm', label: '▲ Deep Reharm (90–100)', color: 'var(--tier-deep-fg)' },
  { tier: 'modal-interchange', key: 'modalInterchange', label: '◐ Modal Borrow (75–89)', color: 'var(--tier-modal-fg)' },
  { tier: 'jazz-standard', key: 'jazzStandard', label: '◆ Jazz Standard (50–74)', color: 'var(--tier-jazz-fg)' },
  { tier: 'radio-safe', key: 'radioSafe', label: '● Radio Safe (0–49)', color: 'var(--tier-safe-fg)' },
];

const closeBtn = (id: ModalId) => `<button class="close-btn" type="button" data-close-modal="${id}" aria-label="Close">×</button>`;

/** Badge PNG with an inline-vector fallback if the PNG fails to load. */
export function badgeImg(id: BadgeId, cls = 'badge-pin-img'): string {
  return `<img class="${cls}" src="${BADGE_PNG[id]}" data-fallback="${BADGE_SVG[id]}" alt="${esc(BADGE_META[id].title)}" width="44" height="44" loading="lazy" decoding="async" />`;
}

export function bindBadgeFallbacks(root: ParentNode): void {
  $$<HTMLImageElement>('img[data-fallback]', root).forEach((img) => {
    img.addEventListener('error', () => {
      const fb = img.dataset.fallback;
      if (fb && img.src !== fb) img.src = fb;
    }, { once: true });
  });
}

export function badgeItems(badges: UnlockedBadge[], stamp = false): string {
  if (!badges.length) return `<div class="empty-pins">No flavor pins this time — rarer functional moves unlock them.</div>`;
  return `<div class="badges-showcase">${badges.map((b, i) => `
    <div class="badge-item${stamp ? ' anim-stamp' : ''}"${stamp ? ` style="animation-delay:${780 + i * 90}ms"` : ''}>
      ${badgeImg(b.id)}
      <div><div class="badge-info-title">${esc(b.title)}</div><div class="badge-info-sub">${esc(b.reason)}</div></div>
    </div>`).join('')}</div>`;
}

export class Modals {
  private lastFocus: HTMLElement | null = null;
  private timers: number[] = [];

  constructor(private readonly app: ReharmApp) {
    for (const id of MODAL_IDS) {
      const el = $(`#${id}`);
      el.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (t === el || t.closest('[data-close-modal]')) this.close(id);
      });
    }
  }

  anyOpen(): boolean {
    return MODAL_IDS.some((id) => !$(`#${id}`).hidden) || !$('#modal-gate').hidden;
  }

  closeAll(includeGate = false): void {
    MODAL_IDS.forEach((id) => this.close(id, false));
    if (includeGate) $('#modal-gate').hidden = true;
  }

  close(id: ModalId, restoreFocus = true): void {
    const el = $(`#${id}`);
    if (el.hidden) return;
    el.hidden = true;
    if (id === 'modal-reveal') this.clearTimers();
    if (restoreFocus) this.lastFocus?.focus?.();
  }

  private open(id: ModalId, html: string): HTMLElement {
    MODAL_IDS.forEach((m) => m !== id && this.close(m, false));
    if (!this.anyOpen()) this.lastFocus = document.activeElement as HTMLElement | null;
    const el = $(`#${id}`);
    el.innerHTML = `<div class="modal-card">${html}</div>`;
    el.hidden = false;
    bindBadgeFallbacks(el);
    const focusTarget = el.querySelector<HTMLElement>('.cta-primary, .close-btn');
    focusTarget?.focus({ preventScroll: true });
    return el;
  }

  private clearTimers(): void {
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers = [];
  }

  // ---------------------------------------------------------------------------
  // View 5 — Lock Mix Score Reveal Ceremony
  // ---------------------------------------------------------------------------

  openReveal(score: FullScore, ceremony: boolean): void {
    const app = this.app;
    const p = app.puzzle;
    const symbols = app.solved?.symbols ?? app.bars.map((b) => b.chord?.symbol ?? '—');
    const el = this.open('modal-reveal', `
      <div class="modal-head">
        <div>
          <div class="mono" style="font-size:11px; color:var(--accent-primary);">PUZZLE #${p.puzzleNumber} · LOCKED IN</div>
          <h2 id="reveal-title" class="modal-title" style="margin:2px 0 0;">Harmonic Breakdown</h2>
        </div>
        ${closeBtn('modal-reveal')}
      </div>
      <div class="reveal-strip">
        <button class="mini-play" type="button" id="reveal-mini-play" aria-label="Audition your mix">${ICONS.play}</button>
        <span class="mono" style="font-size:12px; color:var(--text-secondary);">${symbols.map(esc).join(' · ')}</span>
      </div>
      <div class="score-hero">
        <div class="score-big">
          <span class="score-num display" id="reveal-score-num">00</span>
          <span class="score-denom">/100</span>
        </div>
        <div style="text-align:right; display:flex; flex-direction:column; gap:5px; align-items:flex-end;">
          <span class="rank-pill" id="reveal-rank-pill" data-tier="${score.overallTier}">${esc(score.percentileLabel)} 🌶</span>
          <span class="mono" style="font-size:10.5px; color:var(--text-muted); white-space:nowrap;">${esc(score.overallTier.replace('-', ' ').toUpperCase())}</span>
        </div>
      </div>
      <div class="meters-stack">
        ${this.meter('Harmonic Rarity', score.rarity, 50, 'var(--tier-deep-fg)', score.axisSummaries.rarity, 'meter-rarity')}
        ${this.meter('Melody Color', score.melodyColor, 25, 'var(--tier-modal-fg)', score.axisSummaries.melodyColor, 'meter-melody')}
        ${this.meter('Bassline Flow', score.bassFlow, 25, 'var(--tier-safe-fg)', score.axisSummaries.bassFlow, 'meter-bass')}
      </div>
      <div>
        <div class="palette-section-label"><span>Unlocked Flavor Pins (${score.unlockedBadges.length})</span></div>
        ${badgeItems(score.unlockedBadges, ceremony && !prefersReducedMotion())}
      </div>
      <div class="reveal-actions">
        <button class="cta-primary" type="button" id="btn-reveal-share">${ICONS.share} Share Mix</button>
        <button class="hw-btn" type="button" id="btn-reveal-replay" aria-label="Replay Mix" title="Replay Mix">${ICONS.play}<span class="reveal-btn-label"> Replay Mix</span></button>
        <button class="hw-btn" type="button" id="btn-reveal-stats" aria-label="View Stats" title="View Stats">${ICONS.stats}<span class="reveal-btn-label"> View Stats</span></button>
        <button class="hw-btn" type="button" id="btn-reveal-midi" aria-label="Download MIDI" title="Download MIDI">${ICONS.download}<span class="reveal-btn-label"> MIDI</span></button>
      </div>
      <aside class="daily-next-card" aria-label="Next daily puzzle">
        <div class="daily-next-info">
          <span class="daily-next-eyebrow">Today’s Sheet</span>
          <strong class="daily-next-title">All daily puzzles complete</strong>
          <a class="daily-next-practice" href="${LAB_CHANGES_URL}">Practice: Make the&nbsp;Changes&nbsp;↗</a>
        </div>
        <a class="daily-next-cta" href="${DAILY_SHARE_URL}">Share Combined Card →</a>
      </aside>
      ${labChipHtml(score.unlockedBadges.map((b) => b.id))}`);

    $('#btn-reveal-share', el).addEventListener('click', () => this.openShare(score));
    $('#btn-reveal-stats', el).addEventListener('click', () => this.openStats());
    $('#btn-reveal-midi', el).addEventListener('click', () => app.downloadMidi());
    const replay = () => {
      if (!app.engine.isPlaying) app.togglePlay();
    };
    $('#btn-reveal-replay', el).addEventListener('click', () => {
      replay();
      this.close('modal-reveal');
    });
    $('#reveal-mini-play', el).addEventListener('click', () => app.togglePlay());
    this.runCeremony(el, score, ceremony);
  }

  private meter(label: string, value: number, max: number, color: string, sub: string, id: string): string {
    return `<div class="meter-row">
      <div class="meter-head"><span>${label}</span><span class="mono" style="color:${color};">${value} / ${max}</span></div>
      <div class="meter-track"><div class="meter-fill" id="${id}" data-ratio="${(value / max).toFixed(3)}" style="background:${color};"></div></div>
      <div class="meter-sub">${esc(sub)}</div>
    </div>`;
  }

  /** motion-spec §2.4: count-up 120–920ms, rank pill 350ms, meters 400/520/640ms, badges 780ms+. */
  private runCeremony(el: HTMLElement, score: FullScore, ceremony: boolean): void {
    this.clearTimers();
    const num = $('#reveal-score-num', el);
    const pill = $('#reveal-rank-pill', el);
    const meters = $$('.meter-fill', el);
    const setMeter = (m: HTMLElement) => { m.style.transform = `scaleX(${m.dataset.ratio})`; };
    if (!ceremony || prefersReducedMotion()) {
      num.textContent = String(score.total).padStart(2, '0');
      meters.forEach(setMeter);
      return;
    }
    pill.style.opacity = '0';
    const at = (ms: number, fn: () => void) => this.timers.push(window.setTimeout(fn, ms));
    at(120, () => {
      const start = performance.now();
      const step = (ts: number) => {
        const t = Math.min(1, (ts - start) / 800);
        const eased = 1 - Math.pow(1 - t, 3);
        num.textContent = String(Math.round(eased * score.total)).padStart(2, '0');
        if (t < 1 && !el.hidden) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    at(350, () => {
      pill.style.opacity = '1';
      pill.classList.add('anim-pop');
    });
    meters.forEach((m, i) => at(400 + i * 120, () => setMeter(m)));
  }

  // ---------------------------------------------------------------------------
  // View 6 — Viral Share Modal
  // ---------------------------------------------------------------------------

  openShare(score: FullScore): void {
    const app = this.app;
    const solved = app.solved;
    if (!solved) return;
    const payload = buildSharePayload({
      puzzleNumber: solved.puzzleNumber,
      symbols: solved.symbols,
      barTiers: score.barTiers,
      lockedBarIndex: app.puzzle.lockedBarIndex,
      score: { total: score.total, percentileLabel: score.percentileLabel, avgBassSemitones: score.avgBassSemitones, badges: score.unlockedBadges.map((b) => b.id) },
      baseUrl: `${location.origin}${location.pathname}`,
    });
    const el = this.open('modal-share', `
      <div class="modal-head">
        <h2 id="share-title" class="modal-title" style="margin:0;">Share Your Mix</h2>
        ${closeBtn('modal-share')}
      </div>
      <div class="share-preview-box" id="share-card-text">${esc(payload.emojiCardText)}</div>
      <p class="share-footnote">The card shows no chord names. Your chords are inside the link itself, so anyone who reads the URL can see them; friends who just tap it get a spoiler-safe view until they play.</p>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <button class="cta-primary" type="button" id="btn-copy-card" style="height:48px;">Copy Playable Link &amp; Card</button>
        <button class="hw-btn" type="button" id="btn-copy-link-only">Copy Link Only</button>
      </div>`);
    const morph = (btn: HTMLElement, ok: boolean, label: string) => {
      const original = btn.innerHTML;
      btn.textContent = ok ? '✓ Copied to Clipboard!' : 'Copy failed — select the text above';
      btn.classList.toggle('is-copied', ok);
      window.setTimeout(() => {
        btn.innerHTML = original || label;
        btn.classList.remove('is-copied');
      }, 2000);
    };
    $('#btn-copy-card', el).addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLElement;
      morph(btn, await copyText(payload.emojiCardText), 'Copy Playable Link & Card');
    });
    $('#btn-copy-link-only', el).addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLElement;
      morph(btn, await copyText(payload.url), 'Copy Link Only');
    });
  }

  // ---------------------------------------------------------------------------
  // View 8A — 15-second How to Play
  // ---------------------------------------------------------------------------

  openHowTo(): void {
    const step = (n: number, title: string, body: string) => `
      <div class="howto-step"><span class="howto-num">${n}</span><div>
        <strong style="font-size:13px;">${title}</strong>
        <p style="margin:2px 0 0; font-size:12px; color:var(--text-secondary);">${body}</p>
      </div></div>`;
    const lock = this.app.puzzle.lockedBarIndex + 1;
    this.open('modal-howto', `
      <div class="modal-head">
        <h2 id="howto-title" class="modal-title" style="margin:0;">How to Play in 15 Seconds</h2>
        ${closeBtn('modal-howto')}
      </div>
      ${step(1, 'Listen &amp; Pick a Bar', `Bar ${lock} is today’s fixed <strong>Anchor</strong> chord; you fill the other three. The 4 dots on each bar are beat lights. Tap Play to loop the melody while you experiment.`)}
      ${step(2, 'Drop Chords with 2 Taps (or Piano)', 'Pick Root + Quality for the open bars. Need training wheels? Toggle <strong>Helper</strong> for teal dots on consonant chords.')}
      ${step(3, 'Chase Rare Harmony', 'Every legal harmony passes — rarer functional moves (tritone subs, borrowed chords) climb the Spice Tiers and unlock collectible pins.')}
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:6px;">
        <span class="tier-badge" data-tier="radio-safe" style="padding:6px 8px;">● Radio Safe (0–49)</span>
        <span class="tier-badge" data-tier="jazz-standard" style="padding:6px 8px;">◆ Jazz Standard (50–74)</span>
        <span class="tier-badge" data-tier="modal-interchange" style="padding:6px 8px;">◐ Modal Borrow (75–89)</span>
        <span class="tier-badge" data-tier="deep-reharm" style="padding:6px 8px;">▲ Deep Reharm (90–100)</span>
      </div>
      <button class="cta-primary" type="button" data-close-modal="modal-howto">Got It — Back to Studio</button>`);
  }

  // ---------------------------------------------------------------------------
  // View 8B — Stats, streak & trophy case
  // ---------------------------------------------------------------------------

  openStats(): void {
    const app = this.app;
    const st = app.store.stats(app.todayNumber);
    const today = app.store.getResult(app.todayNumber);
    const todayTier = today ? tierForTotal(today.total) : null;
    const maxCount = Math.max(1, ...TIER_ROWS.map((r) => st.spiceDistribution[r.key]));
    const unlocked = BADGE_IDS.filter((id) => st.badgeCounts[id] > 0).length;
    const el = this.open('modal-stats', `
      <div class="modal-head">
        <h2 id="stats-title" class="modal-title" style="margin:0;">Studio Stats &amp; Pins</h2>
        ${closeBtn('modal-stats')}
      </div>
      <div class="kpi-grid">
        <div class="kpi-tile"><div class="kpi-val">${st.played}</div><div class="kpi-lbl">Played</div></div>
        <div class="kpi-tile"><div class="kpi-val">${st.averageScore}</div><div class="kpi-lbl">Avg Score</div></div>
        <div class="kpi-tile"><div class="kpi-val" style="color:var(--accent-primary);">🔥 ${st.currentStreak}</div><div class="kpi-lbl">Streak</div></div>
        <div class="kpi-tile"><div class="kpi-val" style="color:var(--tier-deep-fg);">${st.bestScore}</div><div class="kpi-lbl">Best Spice</div></div>
      </div>
      <div class="meters-stack" style="gap:6px;">
        <div class="palette-section-label"><span>Spice Tier Distribution</span><span>Max streak ${st.maxStreak}</span></div>
        ${TIER_ROWS.map((r) => `
          <div class="meter-row${r.tier === todayTier ? ' is-today' : ''}">
            <div class="meter-head"><span>${r.label}${r.tier === todayTier ? ' · Today' : ''}</span><span class="mono">${st.spiceDistribution[r.key]}</span></div>
            <div class="meter-track"><div class="meter-fill" style="transform:scaleX(${(st.spiceDistribution[r.key] / maxCount).toFixed(3)}); background:${r.tier === todayTier ? 'var(--accent-primary)' : r.color};"></div></div>
          </div>`).join('')}
      </div>
      <div>
        <div class="palette-section-label"><span>Flavor Pin Case (${unlocked} / 8 Unlocked)</span></div>
        <div class="trophy-grid">
          ${BADGE_IDS.map((id) => {
            const n = st.badgeCounts[id];
            const meta = BADGE_META[id];
            return `<button type="button" class="trophy-cell${n ? '' : ' is-locked'}" data-badge="${id}" aria-label="${esc(meta.title)}${n ? ` earned ${n} times` : ', locked'}">
              ${badgeImg(id)}<span class="trophy-name">${esc(meta.title)} ${n ? `×${n}` : '(Locked)'}</span>
            </button>`;
          }).join('')}
        </div>
        <div class="trophy-hint" id="trophy-hint" aria-live="polite">Tap a pin to see how to earn it.</div>
      </div>`);
    $('.trophy-grid', el).addEventListener('click', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-badge]');
      if (!cell) return;
      const id = cell.dataset.badge as BadgeId;
      $('#trophy-hint', el).textContent = `${BADGE_META[id].emoji} ${BADGE_META[id].title}: ${BADGE_META[id].hint}`;
    });
  }

  // ---------------------------------------------------------------------------
  // View 8C — Settings sheet
  // ---------------------------------------------------------------------------

  openSettings(): void {
    const el = this.open('modal-settings', `
      <div class="modal-head">
        <h2 id="settings-title" class="modal-title" style="margin:0;">Studio Settings</h2>
        ${closeBtn('modal-settings')}
      </div>
      <div id="settings-rows"></div>`);
    this.renderSettingsRows(el);
    $('#settings-rows', el).addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('#btn-settings-midi')) {
        this.app.downloadMidi();
        return;
      }
      const choice = t.closest<HTMLElement>('[data-choice]');
      if (choice) {
        const { choice: key, value } = choice.dataset;
        if (key === 'piano') {
          this.app.updateSettings({ piano: value as UserSettings['piano'] });
          this.app.audition(() => this.app.auditionChord());
        } else if (key === 'melodyTone') {
          this.app.updateSettings({ melodyTone: value as UserSettings['melodyTone'] });
          this.app.audition(() => this.app.auditionMelody());
        } else if (key === 'chordStyle') {
          this.app.updateSettings({ chordStyle: value as UserSettings['chordStyle'] });
        }
        return;
      }
      const sw = t.closest<HTMLElement>('[data-setting]');
      if (!sw) return;
      const s = this.app.settings;
      switch (sw.dataset.setting) {
        case 'theme': this.app.updateSettings({ theme: s.theme === 'light' ? 'dark' : 'light' }); break;
        case 'helper': this.app.updateSettings({ consonantHelper: !s.consonantHelper }); break;
        case 'motion': this.app.updateSettings({ reducedMotion: !s.reducedMotion }); break;
        case 'muted': {
          const muting = !s.isMuted;
          if (!muting) void this.app.ensureAudio(); // gesture: unlock audio on unmute
          this.app.updateSettings({ isMuted: muting });
          break;
        }
      }
    });
  }

  refreshSettings(): void {
    const el = document.getElementById('modal-settings');
    if (el && !el.hidden) this.renderSettingsRows(el);
  }

  private renderSettingsRows(el: HTMLElement): void {
    const s = this.app.settings;
    const ready = this.app.engine.status === 'ready';
    const row = (key: string, title: string, sub: string, on: boolean) => `
      <div class="setting-row" style="margin-bottom:8px;">
        <div>
          <div style="font-size:13px; font-weight:600;">${title}</div>
          <div style="font-size:11px; color:var(--text-muted);">${sub}</div>
        </div>
        <button class="switch-pill" type="button" role="switch" data-setting="${key}" aria-checked="${on}" aria-label="${esc(title)}"></button>
      </div>`;
    const audioStatus = `<span class="status-dot${ready && !s.isMuted ? ' is-ready' : ''}"></span>${
      ready ? (s.isMuted ? 'Muted · visual loop only' : 'Media Channel Ready') : 'Audio sleeping · unmute or Play to wake it'
    } · iPhone silent switch safe`;
    const choices = (key: 'piano' | 'chordStyle' | 'melodyTone', title: string, sub: string, opts: { id: string; label: string }[], cur: string) => `
      <div class="setting-row setting-choice" style="margin-bottom:8px;">
        <div>
          <div style="font-size:13px; font-weight:600;">${title}</div>
          <div style="font-size:11px; color:var(--text-muted);">${sub}</div>
        </div>
        <div class="segmented-switch choice-switch" role="radiogroup" aria-label="${esc(title)}">${opts.map((o) => `
          <button class="seg-btn" type="button" role="radio" data-choice="${key}" data-value="${o.id}" aria-checked="${o.id === cur}" aria-selected="${o.id === cur}">${esc(o.label)}</button>`).join('')}
        </div>
      </div>`;
    const canExport = this.app.hasMidiContent();
    $('#settings-rows', el).innerHTML =
      choices('piano', 'Keys Sound', 'The keyboard that plays your chords', PIANO_IDS.map((id) => PIANOS[id]), s.piano) +
      choices('melodyTone', 'Melody Sound', 'The voice that plays the daily melody', LEAD_IDS.map((id) => LEADS[id]), s.melodyTone) +
      choices('chordStyle', 'Chord Style', 'How each bar’s chord is played · next barline', CHORD_STYLES, s.chordStyle) +
      `<div class="setting-row" style="margin-bottom:8px;">
        <div>
          <div style="font-size:13px; font-weight:600;">Download MIDI</div>
          <div style="font-size:11px; color:var(--text-muted);">${canExport ? 'Melody, chords (in this style) &amp; bass · 4 bars' : 'Add a chord to a bar first'}</div>
        </div>
        <button class="hw-btn" type="button" id="btn-settings-midi"${canExport ? '' : ' disabled'}>${ICONS.download} .mid</button>
      </div>` +
      row('theme', 'Daylight Theme (Light)', 'Warm studio newsprint vs Midnight obsidian', s.theme === 'light') +
      row('helper', 'Consonant Helper Dots', 'Show teal LEDs on diatonic chord &amp; piano options', s.consonantHelper) +
      row('muted', 'Muted Mode', audioStatus, s.isMuted) +
      row('motion', 'Reduced Motion', 'Disables shake, pulse &amp; sweeping playhead beam', s.reducedMotion) +
      `<p class="settings-credit">Piano, Rhodes, vibes &amp; flute samples: Fluid R3 GM SoundFont by Frank Wen,
        <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a>.</p>`;
  }
}
