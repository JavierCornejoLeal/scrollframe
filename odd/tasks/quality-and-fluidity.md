# quality-and-fluidity

Objective: the sequence looks as close to the video as WebP allows and scrolls fluidly on desktop, tablet and mobile, whatever the duration.
Branch: `feat/quality-and-fluidity` from `8546cf9` (0.4.0). Delivery: `ask-on-risk`; the owner sees it locally first. Runners: vitest, node:test, Playwright, the playground.

## Specs

- S1: "quiero que pierda la mas minima es decir que sea la calidad mas parecida del video, pero que aparte no nos quite apenas rendimiento por asi decirlo, o que todo fluya correctamente", "esto tanto en desktop tablet mobile". Format: "yo igualmente haria webp".
- S2: "no me gustaria tener recortes, pero si hace falta para darle mas calidad a los videos para mobile y tablet adelante": crops only for portrait phone and tablet, never for landscape, never wider than what object-fit already hides.
- S3: "los frames los que sean necesarios, pero claro me preocupa de que suban un video largo, es decir imaginate 2 minutos de video, y que haga solo 120 frames quedarian mal": frames follow the duration, without a cap that degrades long videos; a long sequence must not download or decode every frame at once.
- S4: "En desktop se muestra como no en pantalla completa": full width by default, no sideways scroll.
- S5: "el h1 encima del video que se hace dentro del componente eso ni lo pongas directamente, no me gusta": no template writes one.
- S6: npm 12: the fix the CLI prints must work after a blocked `npx` run.
- S7 (assumption): sequences and projects from 0.4.0 keep working; manifest additions are optional fields.
- S8: nothing is pushed or published before the owner has seen it working.

## Design (measured, see L2)

- Sets: mobile 3:5 crop up to 1296 q82; tablet 4:5 crop up to 1440 q84; desktop 1920 q84; large 2560 q84. Never upscaled.
- Selection: by viewport aspect, then by the device pixels object-fit:cover needs.
- Frames: 15 per second, at least 120, never above the source. Scroll length: 40vh per second, at least 300vh.
- Engine: `<img>.decode()` (no CORS, fluid in three engines), 4 at a time, about 24 decoded frames aimed ahead by scroll speed, eased progress. Long sequences download a coarse pass plus the frames near the scroll.
- Extraction streams frames, so a long video does not fill the temp folder.

## Tasks

- [ ] T1 (S1, S2, S7) core: manifest fields, set selection, poster
- [ ] T2 (S1, S3) core: engine window, easing, lazy download
- [ ] T3 (S1, S2, S3) cli: sets, frames by duration, streaming extraction
- [ ] T4 (S4, S5) react, element, templates: full width, scroll length, no h1
- [ ] T5 (S6) cli, README: npx with blocked scripts
- [ ] T6 (S1-S8) real verification: three engines, devices, 2 minute video, the owner's React project

## Log

- L1 (2026-11-22): "Calidad AVIF que quiere decir, yo igualmente haria webp, luego no me gustaria tener recortes, pero si hace falta para darle mas calidad a los videos para mobile y tablet adelante / Luego los frames los que sean necesarios, pero claro me preocupa de que suban un video largo, es decir imaginate 2 minutos de video, y que haga solo 120 frames quedarian mal si o no si se meexplico. / Los demas cambios aplicalos, veamos a ver que sucede"
- L2 (2026-11-22): measured on a 15.7 s 4K clip with 0.4.0: VMAF phone 43, tablet portrait 75, QHD 91.5, retina 88; section 1126px wide in the Vite starter; 120 frames whatever the duration. WebP at the sizes above: 90-93, 93.7, 95.6, 93.6. Prototype with 1800 frames at 2560: janky frames Chromium 0/841, WebKit 2/1007, Firefox 7/1571; about 413 MB decoded. createImageBitmap was worse in WebKit and Firefox.
