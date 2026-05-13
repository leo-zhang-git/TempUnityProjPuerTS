# Unity PuerTS Template Specification

## Scope

This document records the current stable state of the Unity PuerTS template project.

It covers the Unity project root, package state, intended runtime surface, and the observable behavior that exists in the project. Stage plans belong in [ROADMAP.md](ROADMAP.md), and design rationale belongs in [ARCHITECTURE.md](ARCHITECTURE.md).

## Current Behavior

- The Unity project root is `My project/`.
- The Unity editor version recorded by the project is `2022.3.45f1`.
- The current Unity assets surface contains the default `Assets/Scenes/` folder.
- Unity packages are managed through `Packages/manifest.json` and `Packages/packages-lock.json`.
- `com.unity.ugui` is present in the package manifest, so the project has Unity UI package support available.
- PuerTS package source is present under `My project/Assets/Package/core/` and `My project/Assets/Package/v8/`.
- Unity package dependencies reference PuerTS through local `file:../Assets/Package/...` entries in `My project/Packages/manifest.json`.
- A C# smoke-test script exists at `My project/Assets/Script/PuerTsTest.cs` and starts a `Puerts.ScriptEnv` with the V8 backend.
- The TypeScript project root is the workspace-root `TsProj/`, as a sibling of `My project/`.
- `TsProj/` contains the minimal TypeScript build baseline: `package.json`, `tsconfig.json`, `src/`, and `types/`.
- `TsProj/src/main.ts` exports `start`, `dispose`, and `onHelloButtonClick` as the stable initial runtime surface for the Unity bridge.
- `TsProj/src/app.ts` owns the sample application state and returns/displays `hello world` through a small host interface.
- `TsProj/dist/` is the generated JavaScript output directory and is ignored by Git.
- The current Unity scene has not yet been wired to the TypeScript-built JavaScript output.
- No TypeScript-driven UI sample exists in the scene yet.

## Fixed Rules

- The project keeps TypeScript-side source and tooling under the workspace-root `TsProj/`, outside the Unity project directory.
- Unity C# code acts as the engine bridge and lifecycle host for PuerTS; gameplay sample logic belongs on the TypeScript side.
- The first sample behavior uses a clickable Unity UI button and displays `hello world`.
- Generated JavaScript output must be separated from TypeScript source inside `TsProj/`.
- Development builds emit JavaScript to `TsProj/dist/`.
- Player packaging does not yet have a Unity-owned JavaScript asset sync path.
- Reference material from `../program/` can guide folder shape, but this template owns its own minimal structure.

## Validation and Maintenance

- Use Unity editor or batchmode checks to validate Unity package and scene changes when Unity files change.
- Use `npm run check` from `TsProj/` for TypeScript compiler validation.
- Use `npm run build` from `TsProj/` to generate JavaScript into `TsProj/dist/`.
- Use a play-mode or manual Unity scene check to validate the `hello world` button behavior after the sample scene exists.
- Update this file whenever current behavior, package state, runtime entrypoints, or observable sample behavior changes.
