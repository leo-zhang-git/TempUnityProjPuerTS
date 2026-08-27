import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolveStaticDataDir } from "../../data/framework/paths.js";

export interface StaticdataFrameConfig {
	host: string;
	staticdataWebBase: number;
	portSlot: number;
	slotCount: number;
	fallbackPortCount: number;
}

export function loadStaticdataFrameConfig(): StaticdataFrameConfig {
	const staticDataRoot = resolveStaticDataDir();
	const repoRoot = resolve(staticDataRoot, "..", "..");
	const defaultsPath = resolve(repoRoot, "frame-config.json");
	const localPath = resolve(repoRoot, "frame-config.local.json");
	let defaults: unknown;
	let local: unknown;
	try {
		defaults = JSON.parse(readFileSync(defaultsPath, "utf8"));
		local = JSON.parse(readFileSync(localPath, "utf8"));
	} catch (error) {
		throw new Error(`无法读取框架配置，请先运行 0.初始化框架配置.bat：${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(defaults) || defaults.version !== 1) {
		throw new Error(`Invalid frame configuration: ${defaultsPath}`);
	}
	const hosts = defaults.hosts;
	const ports = defaults.ports;
	const tools = defaults.tools;
	if (!isRecord(hosts) || typeof hosts.loopback !== "string") {
		throw new Error(`Invalid hosts configuration: ${defaultsPath}`);
	}
	if (
		!isRecord(ports) ||
		!isPositiveInteger(ports.slotCount) ||
		!isPositiveInteger(ports.fallbackPortCount) ||
		!isPositiveInteger(ports.staticdataWebBase)
	) {
		throw new Error(`Invalid ports configuration: ${defaultsPath}`);
	}
	if (ports.slotCount > 1000 || ports.fallbackPortCount > 10000) {
		throw new Error(`Port configuration is too large: ${defaultsPath}`);
	}
	if (!isRecord(tools) || !isRecord(tools.staticdata) || tools.staticdata.enabled !== true) {
		throw new Error(`Staticdata Web is disabled in ${defaultsPath}`);
	}
	if (!isRecord(local) || local.version !== 1 || typeof local.workspaceId !== "string" || !local.workspaceId || !isIntegerOrZero(local.portSlot)) {
		throw new Error(`Invalid local frame configuration: ${localPath}`);
	}
	if (local.portSlot >= ports.slotCount) {
		throw new Error(`portSlot must be between 0 and ${ports.slotCount - 1}: ${localPath}`);
	}
	if (typeof local.rootPath !== "string" || normalizePath(local.rootPath) !== normalizePath(repoRoot)) {
		throw new Error(`Local frame configuration belongs to another workspace; run 0.初始化框架配置.bat: ${localPath}`);
	}
	const fallbackLastPort = ports.staticdataWebBase + ports.slotCount + ports.fallbackPortCount - 1;
	if (fallbackLastPort > 65535) {
		throw new Error(`Resolved staticdata fallback port ${fallbackLastPort} is outside the valid TCP port range.`);
	}
	return {
		host: hosts.loopback,
		staticdataWebBase: ports.staticdataWebBase,
		portSlot: local.portSlot,
		slotCount: ports.slotCount,
		fallbackPortCount: ports.fallbackPortCount,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isIntegerOrZero(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function normalizePath(value: string): string {
	return value.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
}
