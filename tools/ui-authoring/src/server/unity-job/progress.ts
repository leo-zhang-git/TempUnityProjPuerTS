import type { UiUnityJobProgress, UiUnityJobProgressStep, UiUnityJobProgressStepStatus } from "../../schema/ui-unity-job.js";
import type { MutableUnityJob } from "./operation-context.js";

export interface UnityJobProgressStepDefinition {
  readonly id: string;
  readonly label: string;
  readonly total?: number;
}

export interface UnityJobProgressStepUpdate {
  readonly id: string;
  readonly label: string;
  readonly status?: UiUnityJobProgressStepStatus;
  readonly completed?: number;
  readonly total?: number;
  readonly currentItem?: string;
}

export function createUnityJobProgress(definitions: readonly UnityJobProgressStepDefinition[]): UiUnityJobProgress {
  return summarizeProgress(
    definitions.map((definition) => ({
      id: definition.id,
      label: definition.label,
      status: "pending",
      completed: 0,
      total: positiveTotal(definition.total),
    })),
  );
}

export function mergeUnityJobProgress(progress: UiUnityJobProgress | undefined, update: UnityJobProgressStepUpdate): UiUnityJobProgress {
  const steps = [...(progress?.steps ?? [])];
  const index = steps.findIndex((step) => step.id === update.id);
  const previous = index >= 0 ? steps[index]! : undefined;
  const total = positiveTotal(update.total ?? previous?.total);
  const status = update.status ?? "running";
  const completed = status === "succeeded" ? total : Math.max(0, Math.min(total, update.completed ?? previous?.completed ?? 0));
  const next: UiUnityJobProgressStep = {
    id: update.id,
    label: update.label,
    status,
    completed,
    total,
    ...(update.currentItem ? { currentItem: update.currentItem } : {}),
  };
  if (index >= 0) steps[index] = next;
  else steps.push(next);
  return summarizeProgress(steps);
}

export function failRunningProgress(progress: UiUnityJobProgress | undefined): UiUnityJobProgress | undefined {
  if (!progress) return undefined;
  const running = progress.steps.some((step) => step.status === "running");
  let markedPending = false;
  const steps = progress.steps.map((step) => {
    if (step.status === "running") return { ...step, status: "failed" as const };
    if (!running && !markedPending && step.status === "pending") {
      markedPending = true;
      return { ...step, status: "failed" as const };
    }
    return step;
  });
  return summarizeProgress(steps);
}

export function completeUnityJobProgress(progress: UiUnityJobProgress | undefined): UiUnityJobProgress | undefined {
  if (!progress) return undefined;
  return summarizeProgress(
    progress.steps.map(({ currentItem: _currentItem, ...step }) => ({
      ...step,
      status: "succeeded" as const,
      completed: step.total,
    })),
  );
}

export function initializeProgress(
  job: MutableUnityJob,
  definitions: readonly UnityJobProgressStepDefinition[],
  preserve: readonly string[] = [],
): UiUnityJobProgress {
  const next = createUnityJobProgress(definitions);
  if (!job.snapshot.progress || preserve.length === 0) return next;
  return preserve.reduce((progress, id) => {
    const existing = job.snapshot.progress?.steps.find((step) => step.id === id);
    return existing ? mergeUnityJobProgress(progress, existing) : progress;
  }, next);
}

function summarizeProgress(steps: readonly UiUnityJobProgressStep[]): UiUnityJobProgress {
  return {
    completed: steps.reduce((sum, step) => sum + step.completed, 0),
    total: steps.reduce((sum, step) => sum + step.total, 0),
    steps,
  };
}

function positiveTotal(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value!) : 1;
}
