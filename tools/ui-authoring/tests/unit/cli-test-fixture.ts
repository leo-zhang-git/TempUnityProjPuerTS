import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCli as executeCli } from "../../src/cli/application.js";
import { type ProjectionNode } from "../../src/kernel/projection.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";

const defaultFontGuid = "00000000000000000000000000000003";

const defaultFontAsset = `m_SourceFontFileGUID: db3631bac854eb44a968d613bfe1a62d
m_AtlasPopulationMode: 0
m_FaceInfo:
  m_PointSize: 30
  m_Scale: 1
  m_LineHeight: 42
  m_AscentLine: 31.8
  m_DescentLine: -10.2
m_GlyphTable:
- m_Index: 1
  m_Metrics:
    m_HorizontalAdvance: 15
  m_Scale: 1
m_CharacterTable:
- m_ElementType: 1
  m_Unicode: 65
  m_GlyphIndex: 1
  m_Scale: 1
m_AtlasTextures:
`;

export function png(width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

export function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "MainCanvas",
    artifactType: "Canvas",
    root: {
      id: "MainCanvas",
      rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [1280, 720] },
      children: [
        {
          id: "label",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [20, -20], sizeDelta: [200, 40] },
          components: { Text: { text: "Ready", fontSize: 20 } },
        },
      ],
    },
  };
}

export function observationNodes(root: ProjectionNode, parentPath: readonly string[] = []): unknown[] {
  const namePath = [...parentPath, root.name];
  return [
    { id: root.id, namePath, active: root.active, rect: root.rect, components: root.components },
    ...root.children.flatMap((child) => observationNodes(child, namePath)),
  ];
}

export async function runCli(workspaceRoot: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  const previousWorkspaceRoot = process.env.UI_AUTHORING_WORKSPACE_ROOT;
  process.env.UI_AUTHORING_WORKSPACE_ROOT = workspaceRoot;
  let stdout = "";
  let stderr = "";
  try {
    const exitCode = await executeCli(args, {
      stdout: (value) => {
        stdout += value;
      },
      stderr: (value) => {
        stderr += value;
      },
    });
    if (exitCode !== 0) {
      throw Object.assign(new Error(stderr.trim() || `CLI exited with code ${exitCode}`), { stdout, stderr, code: exitCode });
    }
    return { stdout, stderr };
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.UI_AUTHORING_WORKSPACE_ROOT;
    else process.env.UI_AUTHORING_WORKSPACE_ROOT = previousWorkspaceRoot;
  }
}

export async function writeDefaultFontContract(workspaceRoot: string): Promise<void> {
  const unityAssetsRoot = join(workspaceRoot, "My project", "Assets");
  const fontDirectory = join(unityAssetsRoot, "Resources", "UI", "Font");
  const settingsDirectory = join(unityAssetsRoot, "TextMesh Pro", "Resources");
  await mkdir(fontDirectory, { recursive: true });
  await mkdir(settingsDirectory, { recursive: true });
  await writeFile(join(fontDirectory, "alipuhui SDF.asset"), defaultFontAsset, "utf8");
  await writeFile(join(fontDirectory, "alipuhui SDF.asset.meta"), `guid: ${defaultFontGuid}\n`, "utf8");
  await writeFile(
    join(settingsDirectory, "TMP Settings.asset"),
    `m_defaultFontAsset: {fileID: 11400000, guid: ${defaultFontGuid}, type: 2}\n`,
    "utf8",
  );
}
