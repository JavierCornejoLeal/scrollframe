import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ScrollSequence } from "@scrollframe/react";
// Imported statically, exactly as the README recommends.
import manifest from "../public/sequence/manifest.json";

// `?below` places the sequence under a tall intro, to test that frames load late.
const below = new URLSearchParams(location.search).has("below");

// Read by the Playwright specs.
window.__scrollframe = { progress: null, frame: null };

function App() {
  return (
    <main>
      {below && <div className="note" style={{ height: "300vh" }}>Intro</div>}
      <ScrollSequence
        manifest={manifest}
        alt="Synthetic test pattern with a running frame counter"
        scrollLength="400vh"
        priority={!below}
        overlayClassName="overlay"
        onProgress={(progress, frame) => {
          window.__scrollframe = { progress, frame };
        }}
      >
        <h1>scrollframe end-to-end</h1>
      </ScrollSequence>
      <footer className="note">The end</footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
