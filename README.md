# news-image-20261122-v12 — Sunday 22 November 2026

[![competition](https://make.fun/badge/news-image-20261122.svg)](https://make.fun/bounty/news-image-20261122)
[![rank](https://make.fun/badge/news-image-20261122/mohamad824/news-image-20261122-v12/rank.svg)](https://make.fun/bounty/news-image-20261122)
[![reward](https://make.fun/badge/news-image-20261122/mohamad824/news-image-20261122-v12/reward.svg)](https://make.fun/bounty/news-image-20261122)

One-page broadsheet summing up the world's news of **Sunday 22 November 2026** —
36 stories from the full day, all drawn in code.

**v12 = v10 rebuilt on the diagnosis of why v10 scored low.** v10 (97,84%, rank 1.727) spread a different bright colour on every card — a rainbow that read as a children's infographic, not a serious world newspaper. v12 keeps v10's top-2 structure and full-day content but fixes the two weaknesses the diagnosis found: (1) illustrations — every story is now a detailed atmospheric scene with 3+ specific elements (Bahrain's radar is a tilted dish with a straight beam, not umbrella arcs; Mexico is a Sinaloa arrest scene with big handcuffs, not a generic mountain; Peru is cracked ground with a thick red seismograph line); (2) colour — a calm newspaper palette (cream #F6EEDC, black ink, newspaper red #C8102E, dark navy #0B1020) with saturation concentrated in the illustrations, like the top 1 entry; all "THE DAY IN NUMBERS" figures are red, not a rainbow. Hong Kong's "5,640 voters" now fits in full.

## What it shows

- **3 leads:** COP31 collapses with no deal (Antalya) · strike on a Dymer apartment block kills at least 10 · Iran claims two US Patriot radars hit in Bahrain, US denies damage (labelled CLAIM).
- **12 grid stories:** Sparta II ablaze, Peru M6.8 quake, Eisenkot asked to form Israel's government, Kryvyi Rih missiles, cartel boss captured in Sinaloa, Hong Kong votes fill all 723 seats (98.79% turnout, 5,640 voters), two tankers hit near Hormuz, 20th US MQ-1 drone claimed downed, EU–Indonesia trade deal signed Saturday in Brussels (98.5% of tariffs removed), Somalia orders the UAE envoy to leave, four nations press Israel on Gaza aid, Verstappen wins the Las Vegas Grand Prix.
- **21 more stories** (16–36), a numbered world map ("WHERE IT HAPPENED"), a full-day DATE CHECK, and a certainty legend (CONFIRMED / CLAIM / REPORTED / PENDING).

## How it is built

`main.ts` (Node 22, no network, deterministic) renders the whole page from scratch: its own TrueType parser and rasterizer (Playfair Display Black/Bold for headlines, Barlow Condensed for labels and body — OFL fonts bundled in `fonts/`), its own PNG encoder, and every illustration drawn in code as flat vector editorial scenes. Two runs write byte-identical output.

Run it:

```sh
node main.ts   # writes /output/entry.png (1024x1024, <= 1 MiB)
```

## Palette

Calm newspaper cream `#F6EEDC`, black ink, newspaper red `#C8102E`, dark navy `#0B1020`. Colour is concentrated in atmospheric, muted illustrations (night navy, warm dusk, muted olive, muted terracotta, muted teal); all "THE DAY IN NUMBERS" figures are red.
