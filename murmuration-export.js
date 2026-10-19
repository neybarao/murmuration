// Export generation. Builds the downloadable ES module and the integration snippet from the
// same runtime sources the editor preview runs, so the two can never drift apart.

function buildMurmurationModule({ states, transitionDuration }) {
  return `export const murmurationStates = ${JSON.stringify(states, null, 2)};
export const defaultTransitionDuration = ${transitionDuration};
const MURMURATION_DEFAULTS = Object.freeze(${JSON.stringify(MURMURATION_DEFAULTS, null, 2)});
${createParticleRenderer.toString()}

${createMurmurationRuntime.toString()}

export function createMurmurationBackground(el, {
  states = murmurationStates,
  transitionDuration = defaultTransitionDuration,
  ...options
} = {}) {
  return createMurmurationRuntime(el, { states, transitionDuration, ...options });
}
`;
}

function buildMurmurationSnippet({ states, transitionDuration }) {
  return `<div id="murmuration-bg"></div>
<script type="module">
  import { createMurmurationBackground } from "./murmuration-background.js";
  const states = ${JSON.stringify(states, null, 2)};

  const murmuration = createMurmurationBackground(
    document.querySelector("#murmuration-bg"),
    { states, initialState: "home", transitionDuration: ${transitionDuration} }
  );

  // When the application changes state:
  // murmuration.transitionTo("chat");

  // Register additional collections when needed:
  // murmuration.setState("results", { ...states.chat, shape: "spiral" });
<\/script>`;
}
