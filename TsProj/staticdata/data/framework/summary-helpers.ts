// 表本地 summary builder 共用的小工具：
// - formatScalar：标量值 → 显示字符串，空值统一为 "—"。
// - countWithSuffix：数组长度 + 文案后缀，等同于 schema 上的 arrayCount。

export function formatScalar(value: unknown): string {
	if (value === undefined || value === null || value === "") {
		return "—";
	}
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return JSON.stringify(value);
}

export function countWithSuffix(value: unknown, suffix: string): string {
	return `${Array.isArray(value) ? value.length : 0} ${suffix}`;
}

