---
"@scrollframe/cli": patch
---

Stop reporting success for projects the CLI cannot set up. React Router, TanStack Start, Gatsby, Docusaurus, VitePress, Expo, Laravel with Inertia and other stacks are no longer set up as React or Vue, and WordPress, Laravel, Symfony, Django and other backends no longer get an HTML snippet with a URL they do not serve: only the frames are generated and the CLI ends saying so. Gatsby, Docusaurus, SvelteKit and Hugo get the frames in `static/` instead of their build folder. The plain HTML flow now warns that its URL assumes the site root.
