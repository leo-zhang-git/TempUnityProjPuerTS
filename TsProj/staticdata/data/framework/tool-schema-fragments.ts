// 跨多张表共用的 schema 片段。仅本表使用的片段放在各表 schema.ts 内。

import { type PathField, s } from "./tool-schema.js";

type UnityImagePathOptions = Omit<PathField, "kind" | "profile" | "allowedDirs" | "allowedExtensions">;

export function unityImagePath<const TOptions extends UnityImagePathOptions>(options: TOptions): PathField & TOptions {
	return s.path("unity-image", {
		...options,
		allowedDirs: ["Assets"],
		allowedExtensions: [".png", ".jpg", ".jpeg", ".webp"],
	}) as PathField & TOptions;
}

export function subtable(name: string) {
	return { metadata: { subtable: name } };
}
