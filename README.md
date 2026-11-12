# AI-Driven Lane Reconstruction

Browser-based research project on the repair of a fire-damaged Shanghai lilong. Six damaged houses are reconstructed from surviving walls, fracture edges and voids, and repaired by three grammars: ALMOND (organic Gothic), BAN (folded tectonic) and SHIKUMEN (reconstructed masonry).

- System website: `web/system.html` (Watch demo walks through input, analysis, inference, repair options and results, then opens the digital space)
- Digital space, stages 01–08: `web/experience.html?tour=1`

## Notes

- The upload and AI-analysis steps are a demonstration on the project dataset; files are previewed in the browser and never uploaded.
- The project film is not included in this repository (file size above GitHub's limit); the website shows its poster only.
- The site is static and needs no build step. Three.js 0.160.0 and fonts load from public CDNs.
- `renders/index.html` is a static listing so the renderer can find the 18 grammar datasets without a server directory index.
- Texture, HDRI, model and sound assets are CC0; sources are listed in `web/assets/CREDITS.md`.
- `references/` holds the three style reference images the repair grammars were read from; they are third-party images included for study and attribution of the project's method.
