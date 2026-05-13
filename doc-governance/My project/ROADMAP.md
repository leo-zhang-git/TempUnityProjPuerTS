# Unity PuerTS Template Roadmap

<!-- governance-profile:start -->

## Current Stage

Stage 0 - documentation baseline.

The project now has a stage-driven authority document set. The next implementation stage is PuerTS integration into the Unity project.

## Active Goals

- Stage 1: Add PuerTS to the Unity project and identify the C# runtime entrypoint that starts TypeScript.
- Stage 2: Create `TsProj/` with a minimal TypeScript project, source directory, build output directory, and compiler scripts.
- Stage 3: Connect Unity to the built JavaScript output through PuerTS.
- Stage 4: Build the sample Unity UI scene with a button and text label, with click behavior owned by TypeScript.
- Stage 5: Validate the template by running the scene and confirming the button displays `hello world`.

## Progress

- Current authority root: `doc-governance/My project/`.
- Current governance profile: `stage-driven`.
- Active prerequisite: choose the PuerTS acquisition method for this template.
- Remaining work: create `TsProj/` and define the minimal build path from TypeScript to JavaScript.
- Remaining work: create or update Unity bridge assets and the sample scene.

## Explicit Non-goals

- No production game framework is part of the first template slice.
- No server-side TypeScript structure is part of the first template slice.
- No hotfix packaging pipeline is part of the first template slice.
- No copying of the full `../program/TsProj` tree is part of the first template slice.
- No public README is generated unless explicitly requested.

<!-- governance-profile:end -->
