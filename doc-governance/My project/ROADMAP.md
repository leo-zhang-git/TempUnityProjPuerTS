# Unity PuerTS Template Roadmap

<!-- governance-profile:start -->

## Current Stage

Stage 3 - Unity-to-JavaScript bridge.

The project now needs Unity to load the built JavaScript output through PuerTS.

## Active Goals

- Stage 1: PuerTS is present in the Unity project and a C# smoke-test entrypoint exists.
- Stage 2: `TsProj/` exists at the workspace root with a minimal TypeScript project, source directory, build output directory, and compiler scripts.
- Stage 3: Connect Unity to `TsProj/dist/main.js` through PuerTS.
- Stage 4: Build the sample Unity UI scene with a button and text label, with click behavior owned by TypeScript.
- Stage 5: Validate the template by running the scene and confirming the button displays `hello world`.

## Progress

- Current authority root: `doc-governance/My project/`.
- Current governance profile: `stage-driven`.
- Active work: replace the inline C# smoke test with a bridge that loads built JavaScript from `TsProj/dist/`.
- Remaining work: decide the player-build JavaScript packaging path before treating the template as build-ready.
- Remaining work: create or update Unity bridge assets and the sample scene.

## Explicit Non-goals

- No production game framework is part of the first template slice.
- No server-side TypeScript structure is part of the first template slice.
- No hotfix packaging pipeline is part of the first template slice.
- No copying of the full `../program/TsProj` tree is part of the first template slice.
- No public README is generated unless explicitly requested.

<!-- governance-profile:end -->
