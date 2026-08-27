import { Check, Clipboard, Download, Image as ImageIcon, X } from "lucide-react";
import { useState } from "react";
import type { CaptureRequest, CaptureResult } from "../../schema/ui-capture.js";
import dialogStyles from "../editors/shared/dialog.module.css";
import sharedStyles from "../editors/shared/editor-shell.module.css";
import { captureImageUrl, captureUi } from "../shared/api/client.js";
import { SelectControl } from "../shared/select-control.js";
import { createWebClasses } from "../styles/web-styles.js";
import captureStyles from "./capture.module.css";

const webClasses = createWebClasses(sharedStyles, dialogStyles, captureStyles);

export interface CaptureDialogOptions {
  readonly selected: boolean;
  readonly scale: 1 | 2;
  readonly background: string;
  readonly includeDebug: boolean;
}

export function CaptureDialog({
  title,
  selectedLabel,
  buildRequest,
  onClose,
}: {
  readonly title: string;
  readonly selectedLabel?: string | undefined;
  readonly buildRequest: (options: CaptureDialogOptions) => CaptureRequest;
  readonly onClose: () => void;
}) {
  const [selected, setSelected] = useState(Boolean(selectedLabel));
  const [scale, setScale] = useState<1 | 2>(1);
  const [transparent, setTransparent] = useState(true);
  const [color, setColor] = useState("#202624FF");
  const [includeDebug, setIncludeDebug] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [result, setResult] = useState<CaptureResult>();
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const capture = async (): Promise<void> => {
    setCapturing(true);
    setError("");
    setCopied(false);
    try {
      setResult(await captureUi(buildRequest({ selected, scale, background: transparent ? "transparent" : color, includeDebug })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className={webClasses("modal-backdrop")} onPointerDown={onClose}>
      <section
        className={webClasses("authoring-dialog capture-dialog")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <ImageIcon size={15} />
            <strong id="capture-dialog-title">截图</strong>
            <span>{title}</span>
          </div>
          <button className={webClasses("icon-button")} type="button" onClick={onClose} title="关闭">
            <X size={15} />
          </button>
        </header>
        <div className={webClasses("capture-dialog-body")}>
          <div className={webClasses("capture-options")}>
            <label>
              <span>目标</span>
              <SelectControl
                value={selected && selectedLabel ? "selected" : "document"}
                options={[
                  { value: "document", label: "当前文档" },
                  ...(selectedLabel ? [{ value: "selected", label: `当前选择 · ${selectedLabel}` }] : []),
                ]}
                onValueChange={(value) => setSelected(value === "selected")}
              />
            </label>
            <label>
              <span>缩放</span>
              <SelectControl
                value={String(scale)}
                options={[
                  { value: "1", label: "1×" },
                  { value: "2", label: "2×" },
                ]}
                onValueChange={(value) => setScale(Number(value) as 1 | 2)}
              />
            </label>
            <label className={webClasses("capture-checkbox")}>
              <input type="checkbox" checked={transparent} onChange={(event) => setTransparent(event.target.checked)} />
              <span>透明背景</span>
            </label>
            {!transparent ? (
              <label>
                <span>背景颜色</span>
                <input value={color} onChange={(event) => setColor(event.target.value.toUpperCase())} pattern="#[0-9A-Fa-f]{8}" />
              </label>
            ) : null}
            <label className={webClasses("capture-checkbox")}>
              <input type="checkbox" checked={includeDebug} onChange={(event) => setIncludeDebug(event.target.checked)} />
              <span>包含调试叠层</span>
            </label>
          </div>
          {error ? <div className={webClasses("capture-result-error")}>{error}</div> : null}
          {result ? (
            <div className={webClasses("capture-result")}>
              <img src={captureImageUrl(result.manifest.output)} alt={`${title} 截图`} />
              <div>
                <code>{result.manifest.output}</code>
                <span>
                  {result.manifest.viewport[0]} × {result.manifest.viewport[1]}
                  {result.manifest.scale === 2 ? " @2×" : ""}
                </span>
              </div>
              <button
                className={webClasses("icon-button")}
                type="button"
                onClick={() => void navigator.clipboard.writeText(result.manifest.output).then(() => setCopied(true))}
                title="复制仓库相对路径"
              >
                {copied ? <Check size={15} /> : <Clipboard size={15} />}
              </button>
              <a className={webClasses("icon-button")} href={captureImageUrl(result.manifest.output)} download title="下载 PNG">
                <Download size={15} />
              </a>
            </div>
          ) : null}
        </div>
        <footer>
          <button className={webClasses("dialog-secondary")} type="button" onClick={onClose}>
            关闭
          </button>
          <button className={webClasses("dialog-primary")} type="button" onClick={() => void capture()} disabled={capturing}>
            {capturing ? "正在截图..." : "截取 PNG"}
          </button>
        </footer>
      </section>
    </div>
  );
}
