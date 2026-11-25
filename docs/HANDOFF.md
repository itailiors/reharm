# REHARM — Handoff (2026-11-25)

## Goal
Production REHARM daily web game (Vite + vanilla TS + Tone.js), built strictly from `design/` (handoff contract, ux-spec, motion-spec, brand-bible, tokens, preview) and `assets/`. Research source: `../music-theory-dle-research.md` (§1 iOS audio, Concept 2 rules).

## Done
- b648af9 — full build, pushed to private repo https://github.com/itailiors/reharm (main tracks origin).
- step 2 (deploy prep) — `.github/workflows/deploy.yml` runs `npm run check` and publishes `dist/` to GitHub Pages on push to main. `SITE_URL` (Pages base_url) makes og:image/og:url absolute via a vite plugin. Local builds keep the relative path. Committed, NOT pushed.
- `npm run check` = tsc + vitest (176 tests) + vite build; green after step 2.
- Verified in the in-app browser at 390×844 and 1280×800: gate, studio, queued→legal barline commit, clash + suggestion chips, Lock Mix reveal, share modal, receiver (spoiler-safe + A/B compare), piano recognizer, stats, light theme, muted visual clock.

## Layout (read code, not this list, for details)
- `src/theory/` chords/legality/analysis/scorer/voicing; `src/puzzles/bank.json` (33 melodies) + `index.ts` (daily selector, EPOCH_ISO = 2026-11-25 = Puzzle #1).
- `src/audio/engine.ts` (Tone.js, iOS unlock, barline swaps), `timeline.ts` (pure math + silent WAV).
- `src/share/` codec/card/storage; `src/ui/` app controller, modals, receiver; `styles.css` = verbatim prototype CSS minus QA ribbon, `app.css` = token-only additions.
- `tests/solver.ts` = brute-force helpers for bank checks.

## In progress
Nothing. LIVE at https://itailiors.github.io/reharm/ (repo made public 2026-11-25, Pages source = GitHub Actions; every push to main redeploys). First deploy run 45671548615 green; absolute og tags and og-image.png (200) checked live.

- Live share flow checked 2026-11-25 (in-app browser): fill → Lock Mix → Share card links to itailiors.github.io/reharm/#1:…; opening that link shows the receiver (spoiler-safe, A/B) with no console errors. Live og/twitter tags complete; og-image.png served as image/png.

## Next 3 steps
1. Test on a real iPhone with the silent switch on via the live URL (audioSession + silent loop + Tone.start path); the only untested area. Also paste the URL into iMessage/Discord/WhatsApp to see the real preview (can't be checked from here).
2. Share card now ships as og-image.jpg (74 KB, q88 JPEG of the 851 KB og-image.png master) so WhatsApp previews it. If the art changes, re-export the JPEG from the PNG.
3. Housekeeping: bump configure-pages/deploy-pages when Node 24 versions ship (runs warn about Node 20); tune the percentile curve with real data later.

## Decisions + why
- Vanilla TS over React: smallest bundle for mobile Safari (JS 94 KB gz, mostly Tone).
- Rarity = tier base of best functional device + 3/extra device kind (cap 6) + chain bonus − penalties (−6 unexplained chromatic, −3 unresolved dominant). Mediants must touch the tonic or link borrowed↔diatonic. Prevents jazz-salad (salad scores rarity 0).
- Loop wrap (bar 4 → bar 1) counts for devices; bass flow uses only the 3 in-bar transitions.
- Palette chords are "colorized" by the melody (Db7 under G → Db7#11) to match mockups; `dim` key = dim7.
- Percentile is a fixed curve (no backend).
- Queued chord commit happens inside the barline scheduleRepeat via Draw + setTimeout backstop; a separate scheduleOnce('@1m') never fired its visual commit in testing.
- Repo created private (outward-facing default).
- GitHub Pages via Actions (user choice). `base: './'` stays, so it works under /reharm/ and on a custom domain.

## Gotchas
- Tone.Draw drops callbacks >250 ms late when rAF is throttled — keep the backstop for any one-shot visual.
- Share codec: `#`→`s` only when not closing "sus" (sus4/sus2); roots are always flat-spelled.
- `.bar-slot[data-slot-state=empty]` overrides the selected ring in the prototype CSS; fixed in app.css.
- renderOled replaces `#oled-screen` children, so `#playhead-beam` id no longer exists (query `.playhead-beam`).
- Dev preview: `.claude/launch.json` "reharm-dev" on port 5173.
- `vite.config.ts` is outside tsconfig `include`, so the IDE flags node:fs/process there; `npm run check` is unaffected.
- The og:image rewrite matches the exact `<meta property="og:image" content="og-image.jpg" />` line in index.html; keep it if you edit that tag.

## Suggested skills
- `ship` for commit + push after changes.
- `run` to launch and drive the app; `anthropic-skills:built-in-browser` before browser checks.
- `mattpocock-skills:diagnosing-bugs` for audio/timing issues found on device.
- `code-review` before a public release.
