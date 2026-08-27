export interface RuntimeTemplateIssue {
	readonly index: number;
	readonly placeholder?: string;
	readonly message: string;
}

export interface ResolveRuntimeTemplateOptions {
	readonly missing?: "error" | "empty" | "keep";
}

const PLACEHOLDER_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function extractRuntimeTemplatePlaceholders(text: string): string[] {
	const placeholders: string[] = [];
	const seen = new Set<string>();
	for (const token of scanRuntimeTemplate(text)) {
		if (token.kind !== "placeholder" || seen.has(token.name)) {
			continue;
		}
		placeholders.push(token.name);
		seen.add(token.name);
	}
	return placeholders;
}

export function validateRuntimeTemplate(text: string): RuntimeTemplateIssue[] {
	const issues: RuntimeTemplateIssue[] = [];
	for (const token of scanRuntimeTemplate(text)) {
		if (token.kind === "issue") {
			issues.push({
				index: token.index,
				...(token.placeholder !== undefined ? { placeholder: token.placeholder } : {}),
				message: token.message,
			});
		}
	}
	return issues;
}

export function resolveRuntimeTemplate(
	text: string,
	values: Readonly<Record<string, string | number | boolean | null | undefined>>,
	options: ResolveRuntimeTemplateOptions = {},
): string {
	const issues = validateRuntimeTemplate(text);
	if (issues.length > 0) {
		throw new Error(`Invalid runtime template: ${issues.map((entry) => entry.message).join("; ")}`);
	}

	const missing = options.missing ?? "error";
	return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, (raw: string, key: string) => {
		const value = values[key];
		if (value === null || value === undefined) {
			if (missing === "empty") {
				return "";
			}
			if (missing === "keep") {
				return raw;
			}
			throw new Error(`Missing runtime template value: ${key}`);
		}
		return String(value);
	});
}

type RuntimeTemplateToken =
	| {
			readonly kind: "placeholder";
			readonly index: number;
			readonly raw: string;
			readonly name: string;
	  }
	| {
			readonly kind: "issue";
			readonly index: number;
			readonly placeholder?: string;
			readonly message: string;
	  };

function scanRuntimeTemplate(text: string): RuntimeTemplateToken[] {
	const tokens: RuntimeTemplateToken[] = [];
	let index = 0;
	while (index < text.length) {
		const char = text[index];
		if (char === "}") {
			tokens.push({
				kind: "issue",
				index,
				message: "Unexpected closing brace in runtime placeholder",
			});
			index += 1;
			continue;
		}
		if (char !== "{") {
			index += 1;
			continue;
		}

		const closeIndex = text.indexOf("}", index + 1);
		if (closeIndex === -1) {
			tokens.push({
				kind: "issue",
				index,
				message: "Unclosed runtime placeholder",
			});
			break;
		}

		const body = text.slice(index + 1, closeIndex);
		if (body.startsWith("$")) {
			index = closeIndex + 1;
			continue;
		}
		if (!PLACEHOLDER_NAME_RE.test(body)) {
			tokens.push({
				kind: "issue",
				index,
				placeholder: body,
				message: `Invalid runtime placeholder: ${body}`,
			});
			index = closeIndex + 1;
			continue;
		}
		tokens.push({
			kind: "placeholder",
			index,
			raw: text.slice(index, closeIndex + 1),
			name: body,
		});
		index = closeIndex + 1;
	}
	return tokens;
}

