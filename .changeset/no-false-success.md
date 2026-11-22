---
"@scrollframe/cli": patch
---

Only set up projects that are recognised with certainty, instead of taking any project with React or Vue for one and everything else for plain HTML:

- Next.js with `app/` or `pages/`, React or Vue with Vite and a root `index.html`, Angular serving `public/` at the site root, and folders of static pages are set up.
- Everything else only gets the frames, and the run ends saying it was not set up. This includes projects that used to be set up automatically: React or Vue without Vite, custom base paths, PHP and other backends. `--framework` forces the set-up.
- The URL of a custom `-o` is computed from the folder the project serves.
- In a terminal or with `--yes`, Gatsby, Docusaurus, SvelteKit and Hugo get the frames in `static/`. Without either, the output folder is unchanged and a note says to use `-o static/sequence`.
