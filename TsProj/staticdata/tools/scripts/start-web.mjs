import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "node:http";

const staticDataRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoRoot = resolve(staticDataRoot, "..", "..");
const frameConfig = readFrameConfig(repoRoot);
const host = readOption("--host") ?? frameConfig.host;

const requestedPort = parsePositiveInteger(
	readOption("--port") ?? String(frameConfig.staticdataWebBase + frameConfig.portSlot),
	"port",
);
const fallbackPorts = createFallbackPorts(frameConfig, requestedPort);
const shouldOpen = !process.argv.includes("--no-open");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

let serverProcess;
let port;
let url;
let shuttingDown = false;

process.once("SIGINT", () => {
	shutDown(130);
});
process.once("SIGTERM", () => {
	shutDown(143);
});

try {
	port = await selectAvailablePort(requestedPort, fallbackPorts);
	url = `http://${host}:${port}`;
	serverProcess = spawn(serverCommand(), serverArguments(), {
		cwd: staticDataRoot,
		stdio: "inherit",
		windowsHide: false,
	});
	serverProcess.once("error", (error) => {
		console.error(`无法启动配表 Web 服务：${error.message}`);
	});
	await waitUntilReady(serverProcess, url);
	console.log(`Staticdata Web ready at ${url}`);
	if (shouldOpen) {
		openBrowser(url);
	}
	const exitCode = await waitForServerExit(serverProcess);
	process.exitCode = exitCode;
} catch (error) {
	if (serverProcess && serverProcess.exitCode === null) {
		terminateProcessTree(serverProcess.pid);
	}
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}

function serverCommand() {
	return process.platform === "win32" ? "cmd.exe" : npmCommand;
}

function serverArguments() {
	const argumentsList = ["run", "web", "--", "--host", host, "--port", String(port)];
	return process.platform === "win32" ? ["/d", "/c", npmCommand, ...argumentsList] : argumentsList;
}

async function selectAvailablePort(preferredPort, candidates) {
	for (const candidate of [preferredPort, ...candidates]) {
		const prepared = await preparePort(candidate);
		if (!prepared) {
			continue;
		}
		if (candidate !== preferredPort) {
			console.log(`Preferred staticdata Web port ${preferredPort} is occupied; using fallback port ${candidate}.`);
		}
		return candidate;
	}
	throw new Error(
		`No available staticdata Web port after ${preferredPort}; checked ${candidates.length + 1} candidate ports.`,
	);
}

async function preparePort(candidatePort) {
	const listenerPid = findListeningPid(candidatePort);
	if (listenerPid === undefined) {
		return isPortAvailable(host, candidatePort);
	}

	const commandLine = readProcessCommandLine(listenerPid);
	if (!isStaticdataWebProcess(commandLine)) {
		return false;
	}

	console.log(`Replacing existing staticdata Web service on port ${candidatePort} (PID ${listenerPid}).`);
	terminateProcessTree(listenerPid);
	if (!(await waitForPortRelease(candidatePort))) {
		throw new Error(`旧配表 Web 服务未能释放端口 ${candidatePort}。`);
	}
	return true;
}

function findListeningPid(targetPort) {
	try {
		const output = execFileSync("netstat", ["-ano", "-p", "tcp"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		const pattern = new RegExp(`^\\s*TCP\\s+\\S+:${targetPort}\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$`, "imu");
		const match = pattern.exec(output);
		return match ? Number(match[1]) : undefined;
	} catch {
		return undefined;
	}
}

function readProcessCommandLine(pid) {
	if (process.platform !== "win32") {
		return undefined;
	}
	try {
		const script = `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`;
		return execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return undefined;
	}
}

function isStaticdataWebProcess(commandLine) {
	if (!commandLine) {
		return false;
	}
	const normalizedCommand = commandLine.replaceAll("\\", "/").toLowerCase();
	const normalizedRoot = staticDataRoot.replaceAll("\\", "/").toLowerCase().replace(/\/$/u, "");
	return normalizedCommand.includes(`${normalizedRoot}/`) && normalizedCommand.includes("tools/src/web-cli.ts");
}

function terminateProcessTree(pid) {
	if (!pid || process.platform !== "win32") {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			return;
		}
		return;
	}
	try {
		execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
		stdio: "ignore",
		});
	} catch {
		return;
	}
}

async function waitForPortRelease(targetPort) {
	const deadline = Date.now() + 8000;
	while (Date.now() < deadline) {
		if (findListeningPid(targetPort) === undefined && (await isPortAvailable(host, targetPort))) {
			return true;
		}
		await delay(200);
	}
	return findListeningPid(targetPort) === undefined && (await isPortAvailable(host, targetPort));
}

function isPortAvailable(targetHost, targetPort) {
	return new Promise((resolvePromise) => {
		const probe = createServer();
		let settled = false;
		const settle = (available) => {
			if (settled) {
				return;
			}
			settled = true;
			if (probe.listening) {
				probe.close(() => resolvePromise(available));
			} else {
				resolvePromise(available);
			}
		};
		probe.once("error", () => settle(false));
		probe.listen({ host: targetHost, port: targetPort }, () => settle(true));
	});
}

async function waitUntilReady(child, serverUrl) {
	const deadline = Date.now() + 90000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`配表 Web 服务在准备完成前退出，退出码 ${child.exitCode}。`);
		}
		if (await canReadManifest(serverUrl)) {
			return;
		}
		await delay(250);
	}
	throw new Error(`配表 Web 服务在 90 秒内未就绪：${serverUrl}`);
}

function canReadManifest(serverUrl) {
	return new Promise((resolvePromise) => {
		const request = get(`${serverUrl}/api/manifest`, { timeout: 1500 }, (response) => {
			let body = "";
			response.setEncoding("utf8");
			response.on("data", (chunk) => {
				body += chunk;
			});
			response.on("end", () => {
				if (response.statusCode !== 200) {
					resolvePromise(false);
					return;
				}
				try {
					const payload = JSON.parse(body);
					resolvePromise(payload?.catalog?.tables !== undefined);
				} catch {
					resolvePromise(false);
				}
			});
		});
		request.on("error", () => resolvePromise(false));
		request.on("timeout", () => request.destroy());
	});
}

function openBrowser(targetUrl) {
	if (process.platform === "win32") {
		spawn("cmd.exe", ["/d", "/c", "start", "", targetUrl], { detached: true, stdio: "ignore", windowsHide: true }).unref();
		return;
	}
	const command = process.platform === "darwin" ? "open" : "xdg-open";
	spawn(command, [targetUrl], { detached: true, stdio: "ignore" }).unref();
}

function waitForServerExit(child) {
	if (child.exitCode !== null) {
		return Promise.resolve(child.exitCode ?? 1);
	}
	return new Promise((resolvePromise) => {
		child.once("exit", (code, signal) => {
			if (shuttingDown) {
				resolvePromise(process.exitCode ?? 0);
				return;
			}
			resolvePromise(code ?? (signal ? 1 : 0));
		});
	});
}

function shutDown(exitCode) {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	process.exitCode = exitCode;
	if (serverProcess && serverProcess.exitCode === null) {
		terminateProcessTree(serverProcess.pid);
	}
}

function readOption(name) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function readFrameConfig(root) {
	const defaultsPath = resolve(root, "frame-config.json");
	const localPath = resolve(root, "frame-config.local.json");
	let defaults;
	let local;
	try {
		defaults = JSON.parse(readFileSync(defaultsPath, "utf8"));
		local = JSON.parse(readFileSync(localPath, "utf8"));
	} catch (error) {
		throw new Error(`无法读取框架配置，请先运行 0.初始化框架配置.bat：${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(defaults) || defaults.version !== 1 || !isRecord(defaults.hosts) || typeof defaults.hosts.loopback !== "string") {
		throw new Error(`Invalid frame configuration: ${defaultsPath}`);
	}
	if (
		!isRecord(defaults.ports) ||
		!isPositiveInteger(defaults.ports.slotCount) ||
		!isPositiveInteger(defaults.ports.fallbackPortCount) ||
		!isPositiveInteger(defaults.ports.staticdataWebBase)
	) {
		throw new Error(`Invalid ports configuration: ${defaultsPath}`);
	}
	if (defaults.ports.slotCount > 1000 || defaults.ports.fallbackPortCount > 10000) {
		throw new Error(`Port configuration is too large: ${defaultsPath}`);
	}
	if (!isRecord(defaults.tools) || !isRecord(defaults.tools.staticdata) || defaults.tools.staticdata.enabled !== true) {
		throw new Error(`Staticdata Web is disabled in ${defaultsPath}`);
	}
	if (!isRecord(local) || local.version !== 1 || typeof local.workspaceId !== "string" || !local.workspaceId || !isPositiveIntegerOrZero(local.portSlot)) {
		throw new Error(`Invalid local frame configuration: ${localPath}`);
	}
	if (local.portSlot >= defaults.ports.slotCount) {
		throw new Error(`portSlot must be between 0 and ${defaults.ports.slotCount - 1}: ${localPath}`);
	}
	if (typeof local.rootPath !== "string" || normalizePath(local.rootPath) !== normalizePath(root)) {
		throw new Error(`Local frame configuration belongs to another workspace; run 0.初始化框架配置.bat: ${localPath}`);
	}
	const fallbackLastPort = defaults.ports.staticdataWebBase + defaults.ports.slotCount + defaults.ports.fallbackPortCount - 1;
	if (fallbackLastPort > 65535) {
		throw new Error(`Resolved staticdata fallback port ${fallbackLastPort} is outside the valid TCP port range.`);
	}
	return {
		host: defaults.hosts.loopback,
		staticdataWebBase: defaults.ports.staticdataWebBase,
		portSlot: local.portSlot,
		slotCount: defaults.ports.slotCount,
		fallbackPortCount: defaults.ports.fallbackPortCount,
	};
}

function createFallbackPorts(config, preferredPort) {
	const start = config.staticdataWebBase + config.slotCount;
	const candidates = [];
	for (let offset = 0; offset < config.fallbackPortCount; offset += 1) {
		const candidate = start + offset;
		if (candidate !== preferredPort) {
			candidates.push(candidate);
		}
	}
	return candidates;
}

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value) {
	return Number.isInteger(value) && value > 0;
}

function isPositiveIntegerOrZero(value) {
	return Number.isInteger(value) && value >= 0;
}

function normalizePath(value) {
	return value.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
}

function parsePositiveInteger(value, field) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`Invalid ${field}: ${value}`);
	}
	return parsed;
}

function delay(milliseconds) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
