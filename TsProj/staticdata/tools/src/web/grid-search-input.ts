export const GRID_SEARCH_DELAY_MS = 700;

export function isImeCompositionEvent(event: { isComposing?: boolean; keyCode?: number }): boolean {
	return event.isComposing === true || event.keyCode === 229;
}

export function createImeCompositionState() {
	const composingTargets = new WeakSet<object>();
	return {
		start(target: object): void {
			composingTargets.add(target);
		},
		end(target: object): void {
			composingTargets.delete(target);
		},
		isComposing(target: object, event: { isComposing?: boolean; keyCode?: number }): boolean {
			return composingTargets.has(target) || isImeCompositionEvent(event);
		},
	};
}

