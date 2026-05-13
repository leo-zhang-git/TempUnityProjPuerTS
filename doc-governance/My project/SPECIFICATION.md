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
- `TsProj/` does not exist in this Unity project root yet.
- PuerTS is not present in the Unity project package or asset surface yet.
- The current sample behavior is the default empty Unity project behavior; no TypeScript-driven UI sample exists yet.

## Fixed Rules

- The project keeps TypeScript-side source and tooling under `TsProj/`.
- Unity C# code acts as the engine bridge and lifecycle host for PuerTS; gameplay sample logic belongs on the TypeScript side.
- The first sample behavior uses a clickable Unity UI button and displays `hello world`.
- Generated JavaScript output must be separated from TypeScript source inside `TsProj/`.
- Reference material from `../program/` can guide folder shape, but this template owns its own minimal structure.

## Validation and Maintenance

- Use Unity editor or batchmode checks to validate Unity package and scene changes when Unity files change.
- Use TypeScript compiler checks from `TsProj/` after TypeScript tooling exists.
- Use a play-mode or manual Unity scene check to validate the `hello world` button behavior after the sample scene exists.
- Update this file whenever current behavior, package state, runtime entrypoints, or observable sample behavior changes.
