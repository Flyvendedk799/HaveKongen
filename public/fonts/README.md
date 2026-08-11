# Map glyphs

MapLibre needs SDF glyph ranges to draw any symbol layer with a `text-field` — the
edge-length labels in Havemåleren are the only such layer.

These `.pbf` ranges are vendored so the map has **no runtime dependency on a font
CDN or an API token**. Only `0-255` (Basic Latin + Latin-1) is shipped, which covers
digits, `,`, `m`, `²` and the Danish letters æ/ø/å — everything the labels render.

Source: `https://fonts.openmaptiles.org/<font stack>/0-255.pbf` (Open Sans, Apache-2.0).

If a label ever needs a character above U+00FF, download the matching range into the
same folder; MapLibre requests one file per 256-codepoint block.
