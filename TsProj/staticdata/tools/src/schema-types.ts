import type { registry } from "./schemas.js";

export type TableName = keyof typeof registry.tables;

export type CategoryName<TTable extends TableName> = keyof (typeof registry.tables)[TTable]["categories"];

