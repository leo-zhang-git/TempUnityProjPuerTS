# Unity PuerTS Template Architecture

## Design Goals

- Provide a small, reusable Unity template for projects that want game logic in TypeScript.
- Keep Unity-side code focused on engine integration, lifecycle, scene objects, and the PuerTS bridge.
- Keep TypeScript-side code focused on gameplay flow, UI command handling, and sample logic.
- Make the first runnable slice intentionally small so the bridge can be validated before larger framework choices are added.

## Module Boundaries

- `Assets/` owns Unity scenes, prefabs, serialized assets, and C# bridge scripts.
- `Packages/` owns Unity package references, including the PuerTS integration once it is added.
- `ProjectSettings/` owns Unity editor and player settings.
- `TsProj/` owns TypeScript source, TypeScript compiler config, Node package metadata, generated JavaScript output, and TypeScript-side scripts.
- `TsProj/src/` is the preferred source root for TypeScript code.
- `TsProj/dist/` is the preferred build output root for JavaScript consumed by Unity/PuerTS.

## Key Tradeoffs

- Keeping `TsProj/` at the Unity project root makes the template self-contained and easy to copy, while still matching the broad structure used by `../program/TsProj`.
- A minimal TypeScript project is favored over copying the full `../program/TsProj` layout because this template only needs the PuerTS bridge and a small UI sample.
- Unity UI is sufficient for the first sample because the requirement is a button click and text display, not a full UI framework.
- C# remains necessary at the runtime boundary because Unity owns scene lifecycle, serialized object references, and package initialization.

## Guardrails

- Do not move TypeScript source into `Assets/`; keep `Assets/` for Unity-facing files and `TsProj/` for TypeScript-facing files.
- Do not make the initial sample depend on the large production structure in `../program/`.
- Do not introduce server-side TypeScript, hotfix packaging, config export, or production tooling unless the template scope changes explicitly.
- Do not treat Unity generated folders such as `Library/`, `Temp/`, and `Logs/` as source or documentation authority.
- Keep the first bridge path debuggable before adding abstraction layers.
