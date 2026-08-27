import type { VisualCaseDefinition } from "./visual-contract.js";

export interface VisualCaptureOptions {
  readonly compareName?: string;
  readonly caseId?: string;
  readonly componentType?: string;
}

const captureOptions = new Set(["--compare", "--case", "--component"]);

export function parseVisualCaptureOptions(args: readonly string[]): VisualCaptureOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    if (!option || !captureOptions.has(option)) throw new Error(`Unknown visual capture option '${option ?? ""}'`);
    if (values.has(option)) throw new Error(`Visual capture option '${option}' may only be specified once`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
    values.set(option, value);
  }
  const compareName = values.get("--compare");
  const caseId = values.get("--case");
  const componentType = values.get("--component");
  return {
    ...(compareName ? { compareName } : {}),
    ...(caseId ? { caseId } : {}),
    ...(componentType ? { componentType } : {}),
  };
}

export function selectVisualCases(cases: readonly VisualCaseDefinition[], options: VisualCaptureOptions): readonly VisualCaseDefinition[] {
  const selected = cases.filter(
    (entry) =>
      (!options.caseId || entry.id === options.caseId) && (!options.componentType || entry.componentType === options.componentType),
  );
  if (selected.length > 0) return selected;
  if (options.caseId && options.componentType) {
    throw new Error(`No visual case matches case '${options.caseId}' and component '${options.componentType}'`);
  }
  if (options.caseId) throw new Error(`Unknown visual case '${options.caseId}'`);
  if (options.componentType) throw new Error(`No visual cases are registered for component '${options.componentType}'`);
  throw new Error("No visual cases are registered");
}
