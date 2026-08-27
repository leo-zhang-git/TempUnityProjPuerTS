const REF_LOOKUP_OPTION_LIMIT = 12;

export interface RefLookupOption {
	id: string;
	category: string;
	label?: string;
	issueCount: number;
}

export interface RefLookupTarget {
	table: string;
	categories?: readonly string[];
}

interface RefLookupTable {
	options: readonly RefLookupOption[];
}

export function selectRefLookupOptions(
	lookupTables: Readonly<Record<string, RefLookupTable>> | undefined,
	targets: readonly RefLookupTarget[],
	rawNeedle: string,
	limit = REF_LOOKUP_OPTION_LIMIT,
): Array<RefLookupOption & { table: string }> {
	if (targets.length === 0 || limit <= 0) {
		return [];
	}
	const needle = rawNeedle.trim().toLowerCase();
	const result = [];
	for (const target of targets) {
		const categorySet = new Set(target.categories ?? []);
		for (const entry of lookupTables?.[target.table]?.options ?? []) {
			if (categorySet.size > 0 && !categorySet.has(entry.category)) {
				continue;
			}
			if (needle && !lookupOptionMatches(entry, target.table, needle)) {
				continue;
			}
			result.push({ ...entry, table: target.table });
			if (result.length >= limit) {
				return result;
			}
		}
	}
	return result;
}

function lookupOptionMatches(entry: RefLookupOption, table: string, needle: string): boolean {
	return [entry.id, entry.label, table, entry.category].some(
		(value) => value !== undefined && String(value).toLowerCase().includes(needle),
	);
}

