import { escapeAttr } from "./dom-utils.js";

const UNITY_IMAGE_PROFILE = "unity-image";
const UNITY_IMAGE_EXTENSION = /\.(?:jpe?g|png|webp)$/i;

interface ImagePreviewField {
	kind: string;
	profile?: string;
}

export function isUnityImageField(field: ImagePreviewField): boolean {
	return field.kind === "path" && field.profile === UNITY_IMAGE_PROFILE;
}

export function renderUnityImagePreview(authoredValue: unknown, resolvedValue: unknown, options: { compact?: boolean } = {}): string {
	const resolvedPath = typeof resolvedValue === "string" ? resolvedValue.trim() : "";
	const imagePath = typeof authoredValue === "string" ? authoredValue.trim() : resolvedPath;
	const loadable = isLoadableUnityImagePath(imagePath);
	const stateClass = loadable ? "is-loading" : imagePath ? "is-invalid" : "is-empty";
	const stateLabel = loadable ? "加载中" : imagePath ? "路径无效" : "无图片";
	return `
      <div class="unity-image-preview${options.compact ? " is-compact" : ""} ${stateClass}" data-unity-image-preview data-unity-image-current-path="${escapeAttr(imagePath)}" data-unity-image-resolved-path="${escapeAttr(resolvedPath)}">
        <div class="unity-image-preview-frame">
          <img data-unity-image-preview-image loading="lazy" decoding="async" alt="图片预览" ${loadable ? `src="${escapeAttr(createUnityImageUrl(imagePath))}"` : "hidden"} />
          <span class="unity-image-preview-state" data-unity-image-preview-state>${stateLabel}</span>
        </div>
      </div>
    `;
}

export function refreshUnityImagePreview(input: HTMLInputElement): void {
	const preview = input.closest("[data-field-input-host]")?.querySelector<HTMLElement>("[data-unity-image-preview]");
	if (!preview) {
		return;
	}
	const inputPath = input.value.trim();
	const imagePath = inputPath || (preview.dataset.unityImageResolvedPath ?? "").trim();
	if (
		preview.dataset.unityImageCurrentPath === imagePath &&
		(preview.classList.contains("is-loading") || preview.classList.contains("is-loaded"))
	) {
		return;
	}
	preview.dataset.unityImageCurrentPath = imagePath;
	const image = preview.querySelector<HTMLImageElement>("[data-unity-image-preview-image]");
	const state = preview.querySelector<HTMLElement>("[data-unity-image-preview-state]");
	if (!image || !state) {
		return;
	}

	setPreviewState(preview, isLoadableUnityImagePath(imagePath) ? "loading" : imagePath ? "invalid" : "empty");
	if (!isLoadableUnityImagePath(imagePath)) {
		image.hidden = true;
		image.removeAttribute("src");
		state.textContent = imagePath ? "路径无效" : "无图片";
		return;
	}

	image.hidden = false;
	state.textContent = "加载中";
	image.src = createUnityImageUrl(imagePath);
}

export function handleUnityImageResourceEvent(event: Event): void {
	const image = event.target;
	if (!(image instanceof HTMLImageElement) || !image.matches("[data-unity-image-preview-image]")) {
		return;
	}
	const preview = image.closest<HTMLElement>("[data-unity-image-preview]");
	const state = preview?.querySelector<HTMLElement>("[data-unity-image-preview-state]");
	if (!preview || !state) {
		return;
	}
	if (event.type === "load") {
		setPreviewState(preview, "loaded");
		state.textContent = "";
		return;
	}
	setPreviewState(preview, "error");
	state.textContent = "加载失败";
}

function createUnityImageUrl(imagePath: string): string {
	return `/api/image?path=${encodeURIComponent(imagePath)}`;
}

function isLoadableUnityImagePath(imagePath: string): boolean {
	if (!imagePath.startsWith("Assets/") || imagePath.includes("\\") || !UNITY_IMAGE_EXTENSION.test(imagePath)) {
		return false;
	}
	const segments = imagePath.slice("Assets/".length).split("/");
	return segments.length > 0 && segments.every((segment) => Boolean(segment) && segment !== "." && segment !== "..");
}

function setPreviewState(preview: HTMLElement, state: "empty" | "error" | "invalid" | "loaded" | "loading"): void {
	for (const className of ["is-empty", "is-error", "is-invalid", "is-loaded", "is-loading"]) {
		preview.classList.toggle(className, className === `is-${state}`);
	}
}

