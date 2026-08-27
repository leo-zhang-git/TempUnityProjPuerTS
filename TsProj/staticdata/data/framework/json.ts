import { readFileSync } from "node:fs";

export function readJsonFile(filePath: string): unknown {
	return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

export function expectRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} 必须是对象。`);
	}

	return value as Record<string, unknown>;
}

export function expectArray(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组。`);
	}

	return value;
}

export function expectString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} 必须是非空字符串。`);
	}

	return value;
}

export function expectOneOf<const TValue extends readonly string[]>(value: unknown, choices: TValue, label: string): TValue[number] {
	const stringValue = expectString(value, label);
	if ((choices as readonly string[]).includes(stringValue)) {
		return stringValue as TValue[number];
	}

	throw new Error(`${label} 必须是 ${choices.join("/")}，收到 "${stringValue}"。`);
}

export function expectNumber(value: unknown, label: string): number {
	if (typeof value !== "number" || Number.isNaN(value)) {
		throw new Error(`${label} 必须是数字。`);
	}

	return value;
}

export function expectPositiveNumber(value: unknown, label: string): number {
	const numberValue = expectNumber(value, label);
	if (numberValue <= 0) {
		throw new Error(`${label} 必须是正数。`);
	}

	return numberValue;
}

export function expectNullableString(value: unknown, label: string): string | null {
	if (value === null) {
		return null;
	}

	return expectString(value, label);
}

export function expectBoolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(`${label} 必须是布尔值。`);
	}

	return value;
}

export function expectStringArray(value: unknown, label: string): readonly string[] {
	return freezeArray(
		expectArray(value, label).map((item, index) => {
			return expectString(item, `${label}[${index}]`);
		}),
	);
}

export function freezeArray<T>(items: readonly T[]): readonly T[] {
	return Object.freeze([...items]);
}

export function freezeRecord<T extends object>(value: T): Readonly<T> {
	return Object.freeze({ ...value });
}

