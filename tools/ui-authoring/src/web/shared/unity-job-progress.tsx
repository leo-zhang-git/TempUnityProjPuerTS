import { Check, Circle, LoaderCircle, X } from "lucide-react";
import type { UiUnityJobProgressStep, UiUnityJobSnapshot } from "../../schema/ui-unity-job.js";
import styles from "./unity-job-progress.module.css";

export function UnityJobProgressDetails({ job, ariaLabel }: { readonly job: UiUnityJobSnapshot; readonly ariaLabel: string }) {
  const progress = job.progress;
  const percent = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : undefined;
  const current = progress?.steps.find((step) => step.status === "running" || step.status === "failed");
  return (
    <>
      <div
        className={styles.track}
        data-indeterminate={percent === undefined ? "true" : undefined}
        data-status={job.status}
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <i style={percent === undefined ? undefined : { width: `${percent}%` }} />
      </div>
      <div className={styles.current}>
        <span>{current?.label ?? terminalProgressLabel(job)}</span>
        {current ? <ProgressCount step={current} /> : null}
        {current?.currentItem ? <code>{current.currentItem}</code> : null}
      </div>
      {progress ? (
        <ol className={styles.steps} aria-label="任务步骤">
          {progress.steps.map((step) => (
            <li key={step.id} data-status={step.status}>
              <StepIcon step={step} />
              <span>{step.label}</span>
              <ProgressCount step={step} />
              {step.currentItem && step.status !== "pending" ? <code title={step.currentItem}>{step.currentItem}</code> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}

function ProgressCount({ step }: { readonly step: UiUnityJobProgressStep }) {
  return (
    <small>
      {step.completed}/{step.total}
    </small>
  );
}

function StepIcon({ step }: { readonly step: UiUnityJobProgressStep }) {
  if (step.status === "succeeded") return <Check size={12} />;
  if (step.status === "failed") return <X size={12} />;
  if (step.status === "running") return <LoaderCircle size={12} />;
  return <Circle size={9} />;
}

function terminalProgressLabel(job: UiUnityJobSnapshot): string {
  if (job.status === "failed") return "任务已在失败步骤停止";
  if (job.stage === "blocked") return "任务在阻断项处停止";
  if (job.status === "succeeded") return "任务步骤已完成";
  return job.message;
}
