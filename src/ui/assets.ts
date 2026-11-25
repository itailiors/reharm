/** Every brand / badge / icon asset is imported here so Vite fingerprints it into the bundle. */
import type { BadgeId } from '../types';

import logoUrl from '../../assets/brand/logo.svg';
import faviconUrl from '../../assets/brand/favicon.svg';

import tritoneSub from '../../assets/badges/tritone-sub.png';
import backdoorDominant from '../../assets/badges/backdoor-dominant.png';
import modalBorrow from '../../assets/badges/modal-borrow.png';
import chromaticMediant from '../../assets/badges/chromatic-mediant.png';
import sharp11Melody from '../../assets/badges/sharp11-melody.png';
import smoothBass from '../../assets/badges/smooth-bass.png';
import radioSafe from '../../assets/badges/radio-safe.png';
import jazzTrench from '../../assets/badges/jazz-trench.png';

import tritoneSubSvg from '../../assets/badges/tritone-sub.svg';
import backdoorDominantSvg from '../../assets/badges/backdoor-dominant.svg';
import modalBorrowSvg from '../../assets/badges/modal-borrow.svg';
import chromaticMediantSvg from '../../assets/badges/chromatic-mediant.svg';
import sharp11MelodySvg from '../../assets/badges/sharp11-melody.svg';
import smoothBassSvg from '../../assets/badges/smooth-bass.svg';
import radioSafeSvg from '../../assets/badges/radio-safe.svg';
import jazzTrenchSvg from '../../assets/badges/jazz-trench.svg';

import play from '../../assets/icons/play.svg?raw';
import pause from '../../assets/icons/pause.svg?raw';
import loop from '../../assets/icons/loop.svg?raw';
import lock from '../../assets/icons/lock.svg?raw';
import unlock from '../../assets/icons/unlock.svg?raw';
import pianoKeys from '../../assets/icons/piano-keys.svg?raw';
import gridPalette from '../../assets/icons/grid-palette.svg?raw';
import helperBulb from '../../assets/icons/helper-bulb.svg?raw';
import spiceFlame from '../../assets/icons/spice-flame.svg?raw';
import share from '../../assets/icons/share.svg?raw';
import audioOn from '../../assets/icons/audio-on.svg?raw';
import audioMuted from '../../assets/icons/audio-muted.svg?raw';
import undoReset from '../../assets/icons/undo-reset.svg?raw';
import info from '../../assets/icons/info.svg?raw';
import stats from '../../assets/icons/stats.svg?raw';

export const BRAND = { logo: logoUrl, favicon: faviconUrl };

/** 512px enamel pin PNGs (lazy-loaded inside modals). */
export const BADGE_PNG: Record<BadgeId, string> = {
  'tritone-sub': tritoneSub,
  'backdoor-dominant': backdoorDominant,
  'modal-borrow': modalBorrow,
  'chromatic-mediant': chromaticMediant,
  'sharp11-melody': sharp11Melody,
  'smooth-bass': smoothBass,
  'radio-safe': radioSafe,
  'jazz-trench': jazzTrench,
};

/** 64px inline-vector fallbacks used when a PNG fails to load. */
export const BADGE_SVG: Record<BadgeId, string> = {
  'tritone-sub': tritoneSubSvg,
  'backdoor-dominant': backdoorDominantSvg,
  'modal-borrow': modalBorrowSvg,
  'chromatic-mediant': chromaticMediantSvg,
  'sharp11-melody': sharp11MelodySvg,
  'smooth-bass': smoothBassSvg,
  'radio-safe': radioSafeSvg,
  'jazz-trench': jazzTrenchSvg,
};

const strip = (svg: string) => svg.replace(/\s(width|height)="24"/g, '').replace(/<svg /, '<svg aria-hidden="true" focusable="false" ');

export const ICONS = {
  play: strip(play),
  pause: strip(pause),
  loop: strip(loop),
  lock: strip(lock),
  unlock: strip(unlock),
  'piano-keys': strip(pianoKeys),
  'grid-palette': strip(gridPalette),
  'helper-bulb': strip(helperBulb),
  'spice-flame': strip(spiceFlame),
  share: strip(share),
  'audio-on': strip(audioOn),
  'audio-muted': strip(audioMuted),
  'undo-reset': strip(undoReset),
  info: strip(info),
  stats: strip(stats),
} as const;

export type IconName = keyof typeof ICONS;

/** Fill every [data-icon] element with its inline SVG. */
export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    const name = el.dataset.icon as IconName;
    if (ICONS[name] && !el.querySelector('svg')) el.insertAdjacentHTML('afterbegin', ICONS[name]);
  });
}
