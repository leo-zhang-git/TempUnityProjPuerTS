# Unity PuerTS Template

## Project Positioning

This Unity project is a reusable baseline template for running most game logic from TypeScript through PuerTS.

The first delivery target is a minimal vertical slice: Unity starts the PuerTS runtime, TypeScript owns the sample game logic, and clicking a UI button displays `hello world`.

## Governance Profile

- Governance Profile ID: stage-driven
- Governance Profile Name: 按阶段推进
- Governance Profile Summary: 阶段内连续推进，阶段结束后统一收口。

## Document Routing

- Current facts: [SPECIFICATION.md](SPECIFICATION.md)
- Design rationale and boundaries: [ARCHITECTURE.md](ARCHITECTURE.md)
- Future plan and progress: [ROADMAP.md](ROADMAP.md)
- This file only defines execution rules, routing, and maintenance protocol.

## Execution Boundaries

- Treat `doc-governance/My project/` as the authority root for this template's development documents.
- Treat `My project/` as the Unity implementation target for this template.
- Use `../program/` only as a reference for structure and conventions; do not modify it for this template task.
- Keep TypeScript source, TypeScript build config, generated JavaScript, and related Node tooling under the workspace-root `TsProj/`, as a sibling of the Unity project root.
- Keep Unity generated folders such as `Library/`, `Temp/`, `Logs/`, and `UserSettings/` out of documentation authority decisions.
- Preserve Unity serialized assets and scene files carefully; changes to `.unity`, `.prefab`, `.asset`, `.meta`, or ProjectSettings files must be intentional and easy to explain.
- Close each active stage before expanding the next one.

## Document Update Matrix

- Current behavior changed -> update [SPECIFICATION.md](SPECIFICATION.md)
- Design boundary changed -> update [ARCHITECTURE.md](ARCHITECTURE.md)
- Stage or next steps changed -> update [ROADMAP.md](ROADMAP.md)
- Execution or routing rules changed -> update [AGENTS.md](AGENTS.md)

## Done Definition

- Implementation finished for the active stage.
- Required Unity, TypeScript, or documentation checks were run, or the reason they could not run is recorded.
- Document impact was judged against the update matrix.
- The owning authority document was updated when triggered.
