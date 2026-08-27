import {
	type ArrayField,
	deepClone,
	type FieldDefinition,
	getObjectFieldOrder,
	isJsonObject,
	type JsonObject,
	type JsonValue,
	normalizePathValue,
	type ObjectField,
	type SidecarRootField,
	type UnionField,
} from "./tool-schema.js";

export function materializeRecordWithSchema(record: JsonObject, schema: ObjectField): JsonObject {
	return materializeObject(record, schema) ?? {};
}

export function materializeSidecarRecordWithSchema(record: JsonObject, schema: SidecarRootField): JsonObject {
	const value = materializeDefinedValue(record, schema);
	return isJsonObject(value) ? value : {};
}

export function canonicalizeObject(input: JsonObject, schema: ObjectField): JsonObject {
	const ordered: JsonObject = {};
	const seen = new Set<string>();
	for (const fieldName of getObjectFieldOrder(schema)) {
		if (input[fieldName] === undefined) {
			continue;
		}
		ordered[fieldName] = canonicalizeValue(input[fieldName], schema.fields[fieldName]);
		seen.add(fieldName);
	}
	for (const extraKey of Object.keys(input)
		.filter((key) => !seen.has(key))
		.sort()) {
		ordered[extraKey] = canonicalizeLooseValue(input[extraKey]);
	}
	return ordered;
}

export function canonicalizeSidecarRecord(input: JsonObject, schema: SidecarRootField): JsonObject {
	if (schema.kind === "object") {
		return canonicalizeObject(input, schema);
	}
	const value = canonicalizeUnionValue(input, schema);
	return isJsonObject(value) ? value : (canonicalizeLooseValue(input) as JsonObject);
}

function canonicalizeValue(value: JsonValue | undefined, field: FieldDefinition | undefined): JsonValue | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!field) {
		return canonicalizeLooseValue(value);
	}
	if (field.kind === "string" && typeof value === "string" && field.maxDisplayWidth !== undefined) {
		return truncateToDisplayWidth(value, field.maxDisplayWidth);
	}
	if (field.kind === "path" && typeof value === "string") {
		return normalizePathValue(value);
	}
	if (field.kind === "object" && isJsonObject(value)) {
		return canonicalizeObject(value, field);
	}
	if (field.kind === "array" && Array.isArray(value)) {
		return canonicalizeArray(value, field);
	}
	if (field.kind === "map" && isJsonObject(value)) {
		return canonicalizeMap(value, field.value);
	}
	if (field.kind === "union") {
		return canonicalizeUnionValue(value, field);
	}
	return canonicalizeLooseValue(value);
}

function canonicalizeArray(value: JsonValue[], field: ArrayField): JsonValue[] {
	return value.map((item) => canonicalizeValue(item, field.element) as JsonValue);
}

function canonicalizeMap(value: JsonObject, field: FieldDefinition): JsonObject {
	const result: JsonObject = {};
	for (const key of Object.keys(value).sort()) {
		result[key] = canonicalizeValue(value[key], field);
	}
	return result;
}

function canonicalizeUnionValue(value: JsonValue, field: UnionField): JsonValue {
	const variant = selectUnionVariant(value, field);
	if (variant) {
		return canonicalizeValue(value, variant) as JsonValue;
	}

	return canonicalizeLooseValue(value) as JsonValue;
}

function canonicalizeLooseValue(value: JsonValue | undefined): JsonValue | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (Array.isArray(value)) {
		return value.map((item) => canonicalizeLooseValue(item) as JsonValue);
	}
	if (isJsonObject(value)) {
		const result: JsonObject = {};
		for (const key of Object.keys(value).sort()) {
			result[key] = canonicalizeLooseValue(value[key]);
		}
		return result;
	}
	return value;
}

function materializeObject(value: JsonObject | undefined, field: ObjectField): JsonObject | undefined {
	const source = mergeObjectDefault(field.default, value);
	if (!source) {
		return undefined;
	}

	const result: JsonObject = {};
	for (const [fieldName, childField] of Object.entries(field.fields)) {
		const materialized = materializeValue(source[fieldName], childField);
		if (materialized !== undefined) {
			result[fieldName] = materialized;
		}
	}
	return result;
}

function materializeValue(value: JsonValue | undefined, field: FieldDefinition): JsonValue | undefined {
	if (value === undefined) {
		if (field.default === undefined) {
			return undefined;
		}
		return materializeDefinedValue(field.default, field);
	}
	return materializeDefinedValue(value, field);
}

function materializeDefinedValue(value: JsonValue, field: FieldDefinition): JsonValue {
	if (value === null) {
		return null;
	}

	switch (field.kind) {
		case "string":
			return typeof value === "string" && field.maxDisplayWidth !== undefined
				? truncateToDisplayWidth(value, field.maxDisplayWidth)
				: deepClone(value);
		case "object":
			return materializeObject(isJsonObject(value) ? value : undefined, field) ?? {};
		case "array":
			return Array.isArray(value) ? value.map((item) => materializeDefinedValue(item as JsonValue, field.element)) : [];
		case "map":
			return isJsonObject(value) ? materializeMap(value, field.value) : {};
		case "union":
			return materializeUnionValue(value, field);
		case "path":
			return typeof value === "string" ? normalizePathValue(value) : value;
		case "json":
			return deepClone(value);
		default:
			return deepClone(value);
	}
}

function truncateToDisplayWidth(value: string, maxDisplayWidth: number): string {
	let width = 0;
	let result = "";
	for (const character of value) {
		const characterWidth = character.codePointAt(0)! <= 0x7f ? 1 : 2;
		if (width + characterWidth > maxDisplayWidth) break;
		result += character;
		width += characterWidth;
	}
	return result;
}

function materializeMap(value: JsonObject, field: FieldDefinition): JsonObject {
	const result: JsonObject = {};
	for (const [key, childValue] of Object.entries(value)) {
		result[key] = materializeDefinedValue(childValue as JsonValue, field);
	}
	return result;
}

function materializeUnionValue(value: JsonValue, field: UnionField): JsonValue {
	const variant = selectUnionVariant(value, field);
	if (variant) {
		return materializeDefinedValue(value, variant);
	}

	return deepClone(value);
}

function selectUnionVariant(value: JsonValue, field: UnionField): FieldDefinition | undefined {
	const discriminator = getUnionDiscriminator(field);
	if (discriminator && isJsonObject(value)) {
		const matchedVariant = field.variants.find(
			(variant) =>
				variant.kind === "object" &&
				variant.fields[discriminator]?.kind === "literal" &&
				variant.fields[discriminator].value === value[discriminator],
		);
		if (matchedVariant) {
			return matchedVariant;
		}
	}
	return field.variants.find((variant) => matchesFieldShape(value, variant));
}

function getUnionDiscriminator(field: UnionField): string | undefined {
	const firstObject = field.variants.find((variant): variant is ObjectField => variant.kind === "object");
	if (!firstObject) {
		return undefined;
	}
	return Object.entries(firstObject.fields).find(([, childField]) => childField.kind === "literal")?.[0];
}

function matchesFieldShape(value: JsonValue, field: FieldDefinition): boolean {
	if (value === null) {
		return field.kind === "literal" && field.value === null;
	}

	switch (field.kind) {
		case "string":
		case "ref":
		case "path":
		case "enum":
			return typeof value === "string";
		case "number":
			return typeof value === "number" && !Number.isNaN(value);
		case "boolean":
			return typeof value === "boolean";
		case "json":
			return true;
		case "literal":
			return value === field.value;
		case "object":
			if (!isJsonObject(value)) {
				return false;
			}
			for (const key of Object.keys(value)) {
				if (!field.fields[key]) {
					return false;
				}
			}
			for (const [fieldName, childField] of Object.entries(field.fields)) {
				const childValue = value[fieldName];
				if (childValue === undefined) {
					if (childField.required && childField.default === undefined) {
						return false;
					}
					continue;
				}
				if (!matchesFieldShape(childValue, childField)) {
					return false;
				}
			}
			return true;
		case "array":
			return Array.isArray(value) && value.every((item) => matchesFieldShape(item as JsonValue, field.element));
		case "map":
			return isJsonObject(value) && Object.values(value).every((item) => matchesFieldShape(item as JsonValue, field.value));
		case "union":
			return field.variants.some((variant) => matchesFieldShape(value, variant));
	}
}

function mergeObjectDefault(defaultValue: JsonValue | undefined, value: JsonObject | undefined): JsonObject | undefined {
	if (defaultValue === undefined && value === undefined) {
		return undefined;
	}
	const base = isJsonObject(defaultValue) ? deepClone(defaultValue) : {};
	if (!value) {
		return base;
	}
	for (const [key, fieldValue] of Object.entries(value)) {
		base[key] = deepClone(fieldValue);
	}
	return base;
}

