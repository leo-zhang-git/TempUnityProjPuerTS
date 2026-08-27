export interface NavigationLoadingToken {
	requestId: number;
	target: string;
	startedAt: number;
	requestStartedAt: number | undefined;
	requestMs: number | undefined;
	renderStartedAt: number | undefined;
	renderMs: number | undefined;
	paintMs: number | undefined;
	timer: ReturnType<typeof setInterval> | undefined;
}

export interface NavigationTiming {
	requestMs: number;
	renderMs: number;
	paintMs: number;
	totalMs: number;
}

interface NavigationLoadingOptions {
	overlayNode: HTMLElement;
	targetNode: HTMLElement;
	phaseNode: HTMLElement;
	elapsedNode: HTMLElement;
}

export function createNavigationLoading({ overlayNode, targetNode, phaseNode, elapsedNode }: NavigationLoadingOptions) {
	let active: NavigationLoadingToken | undefined;

	function begin(requestId: number, target: string): NavigationLoadingToken {
		clearActiveTimer();
		const token: NavigationLoadingToken = {
			requestId,
			target,
			startedAt: performance.now(),
			requestStartedAt: undefined,
			requestMs: undefined,
			renderStartedAt: undefined,
			renderMs: undefined,
			paintMs: undefined,
			timer: undefined,
		};
		active = token;
		overlayNode.hidden = false;
		document.body.setAttribute("aria-busy", "true");
		update(token, "准备中");
		token.timer = setInterval(() => update(token), 100);
		return token;
	}

	async function beginRequest(token: NavigationLoadingToken): Promise<boolean> {
		if (!isActive(token)) return false;
		update(token, "请求中");
		await nextPaint();
		if (!isActive(token)) return false;
		token.requestStartedAt = performance.now();
		return true;
	}

	function finishRequest(token: NavigationLoadingToken): void {
		if (!isActive(token) || token.requestStartedAt === undefined) return;
		token.requestMs = performance.now() - token.requestStartedAt;
	}

	async function beginRender(token: NavigationLoadingToken): Promise<boolean> {
		if (!isActive(token)) return false;
		token.renderStartedAt = performance.now();
		update(token, "渲染中");
		await nextPaint();
		return isActive(token);
	}

	async function finish(token: NavigationLoadingToken): Promise<NavigationTiming | undefined> {
		if (!isActive(token)) return undefined;
		if (token.renderStartedAt !== undefined) {
			token.renderMs = performance.now() - token.renderStartedAt;
		}
		update(token, "首次绘制");
		const paintStartedAt = performance.now();
		await nextPaint();
		if (!isActive(token)) return undefined;
		token.paintMs = performance.now() - paintStartedAt;
		const timing = toTiming(token);
		update(token, "完成");
		close(token);
		return timing;
	}

	function cancel(token: NavigationLoadingToken): void {
		if (isActive(token)) close(token);
	}

	function fail(token: NavigationLoadingToken): void {
		if (isActive(token)) close(token);
	}

	function update(token: NavigationLoadingToken, phase = phaseNode.textContent || "处理中"): void {
		if (!isActive(token)) return;
		targetNode.textContent = token.target;
		phaseNode.textContent = phase;
		elapsedNode.textContent = formatElapsed(performance.now() - token.startedAt);
	}

	function close(token: NavigationLoadingToken): void {
		if (!isActive(token)) return;
		clearActiveTimer();
		active = undefined;
		overlayNode.hidden = true;
		document.body.removeAttribute("aria-busy");
	}

	function clearActiveTimer(): void {
		if (active?.timer !== undefined) clearInterval(active.timer);
	}

	function isActive(token: NavigationLoadingToken): boolean {
		return active === token;
	}

	function toTiming(token: NavigationLoadingToken): NavigationTiming {
		return {
			requestMs: token.requestMs ?? 0,
			renderMs: token.renderMs ?? 0,
			paintMs: token.paintMs ?? 0,
			totalMs: performance.now() - token.startedAt,
		};
	}

	return {
		begin,
		beginRender,
		beginRequest,
		cancel,
		fail,
		finish,
		finishRequest,
	};
}

export function formatNavigationTiming(timing: NavigationTiming): string {
	return `请求 ${formatDuration(timing.requestMs)} / 渲染 ${formatDuration(timing.renderMs)} / 绘制 ${formatDuration(timing.paintMs)} / 总计 ${formatDuration(timing.totalMs)}`;
}

function nextPaint(): Promise<void> {
	return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function formatElapsed(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function formatDuration(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

