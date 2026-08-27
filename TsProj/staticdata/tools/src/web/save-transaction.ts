export interface SaveViewScope {
	navigationRequestId: number;
	identity: string;
}

export class SaveIntentQueue {
	private running = false;
	private queued = false;

	begin(): "started" | "queued" {
		if (this.running) {
			this.queued = true;
			return "queued";
		}
		this.running = true;
		return "started";
	}

	finish(): boolean {
		if (!this.running) return false;
		this.running = false;
		const queued = this.queued;
		this.queued = false;
		return queued;
	}
}

export function isCurrentSaveView(saved: SaveViewScope, current: SaveViewScope): boolean {
	return saved.navigationRequestId === current.navigationRequestId && saved.identity === current.identity;
}

export function hasPayloadChangedAfterCommit(
	currentPayload: unknown,
	committedPayload: unknown,
	serialize: (payload: unknown) => string = JSON.stringify,
): boolean {
	return serialize(currentPayload) !== serialize(committedPayload);
}

