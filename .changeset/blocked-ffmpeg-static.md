---
"scrollframe": patch
---

Explain a missing bundled ffmpeg: when npm blocked ffmpeg-static's install script (npm 12+ default), the CLI now says so and prints the exact fixes (`npx --allow-scripts=ffmpeg-static scrollframe <video>`, or `npm install-scripts approve ffmpeg-static && npm rebuild ffmpeg-static`).
