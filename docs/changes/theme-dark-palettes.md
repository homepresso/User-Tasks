# Release notes: dark palettes for every light theme

The 18 light built-in themes (Default, Aurora, Dawn, Studio, Snowfall,
Ember, Ember Minimal, Sage, Sage Minimal, Silver, Silver Minimal, Lavender,
Rose, Cloud, Pearl, Slate, Aurum, Sakura) and the 6 marketplace presets
(Corporate Blue, Startup, Healthcare, Finance, SaaS Modern, Legal) now have
their own dark palette. Before, they showed their light palette in dark
mode, so a member whose device is dark, or a form set to "Always dark",
still saw a light page.

- Each dark palette keeps the theme's hue: a near-black canvas and cards
  tinted with the primary colour, the primary and accent lightened for dark
  backgrounds, and the dark status colours. Themes with a sidebar gradient
  keep their sidebar in both modes.
- Every palette passes the contrast audit (lib/theme/contrast.ts) as
  written; the legibility pass changes nothing.
- Themes set to "Follow device" (the built-in default for these presets)
  switch with the member's setting. A workspace that saved one of these
  themes before keeps its stored copy until it is re-applied from the
  template.

No migration.
