import { type CSSProperties, useId } from "react";
import { defaultImageFillOrigin, type ImageFillMethod } from "../../../kernel/image-contract.js";
import type { UnitySpriteMetrics } from "../../../kernel/image-intrinsic.js";
import type { UiComponents } from "../../../schema/ui-source-schema.js";
import { assetUrl } from "../../shared/api/client.js";
import { createWebClasses } from "../../styles/web-styles.js";
import renderingStyles from "../rendering.module.css";
import { ImageTintFilterDefinitions, TintedImage, usesImageTint } from "./tinted-image.js";

const webClasses = createWebClasses(renderingStyles);
type ImageComponent = NonNullable<UiComponents["Image"]>;

function clampImageFillAmount(value: number | undefined): number {
  return Math.max(0, Math.min(1, value ?? 1));
}

function radialOrigin(method: ImageFillMethod, origin: string): { readonly x: number; readonly y: number; readonly angle: number } {
  if (method === "radial90") {
    return (
      {
        bottomLeft: { x: 0, y: 100, angle: 0 },
        topLeft: { x: 0, y: 0, angle: 90 },
        topRight: { x: 100, y: 0, angle: 180 },
        bottomRight: { x: 100, y: 100, angle: 270 },
      }[origin] ?? { x: 0, y: 100, angle: 0 }
    );
  }
  if (method === "radial180") {
    return (
      {
        bottom: { x: 50, y: 100, angle: 270 },
        left: { x: 0, y: 50, angle: 0 },
        top: { x: 50, y: 0, angle: 90 },
        right: { x: 100, y: 50, angle: 180 },
      }[origin] ?? { x: 50, y: 100, angle: 270 }
    );
  }
  return (
    {
      bottom: { x: 50, y: 50, angle: 180 },
      right: { x: 50, y: 50, angle: 270 },
      top: { x: 50, y: 50, angle: 0 },
      left: { x: 50, y: 50, angle: 90 },
    }[origin] ?? { x: 50, y: 50, angle: 180 }
  );
}

export function imageFillMaskStyle(image: ImageComponent): CSSProperties {
  if ((image.imageType ?? "simple") !== "filled") return {};
  const amount = clampImageFillAmount(image.fillAmount);
  const method = image.fillMethod ?? "radial360";
  const origin = image.fillOrigin ?? defaultImageFillOrigin(method);
  if (method === "horizontal") {
    return { clipPath: origin === "right" ? `inset(0 0 0 ${(1 - amount) * 100}%)` : `inset(0 ${(1 - amount) * 100}% 0 0)` };
  }
  if (method === "vertical") {
    return { clipPath: origin === "top" ? `inset(0 0 ${(1 - amount) * 100}% 0)` : `inset(${(1 - amount) * 100}% 0 0 0)` };
  }
  const degrees = method === "radial90" ? 90 : method === "radial180" ? 180 : 360;
  const radial = radialOrigin(method, origin);
  const sweep = degrees * amount;
  const start = (image.fillClockwise ?? true) ? radial.angle : radial.angle - sweep;
  const mask = `conic-gradient(from ${start}deg at ${radial.x}% ${radial.y}%, #000 0deg ${sweep}deg, transparent ${sweep}deg 360deg)`;
  return { maskImage: mask, WebkitMaskImage: mask };
}

function slicedStyle(image: ImageComponent, metrics: UnitySpriteMetrics): CSSProperties {
  const multiplier = image.pixelsPerUnitMultiplier ?? 1;
  const [left, bottom, right, top] = metrics.border;
  const scale = 100 / metrics.pixelsPerUnit / multiplier;
  return {
    borderStyle: "solid",
    borderWidth: `${top * scale}px ${right * scale}px ${bottom * scale}px ${left * scale}px`,
    borderImageSource: `url(${JSON.stringify(assetUrl(image.sprite!))})`,
    borderImageSlice: `${top} ${right} ${bottom} ${left}${(image.fillCenter ?? true) ? " fill" : ""}`,
    borderImageRepeat: image.imageType === "tiled" ? "round" : "stretch",
  };
}

export function ImageVisual({ image, metrics }: { readonly image: ImageComponent; readonly metrics?: UnitySpriteMetrics | undefined }) {
  const filterId = `image-tint-${useId().replaceAll(":", "")}`;
  if (!image.sprite)
    return <div className={webClasses("image-visual image-solid-fill")} style={{ backgroundColor: image.color ?? "#FFFFFFFF" }} />;
  const type = image.imageType ?? "simple";
  const tintStyle = usesImageTint(image.color) ? { filter: `url(#${filterId})` } : {};
  if ((type === "sliced" || type === "tiled") && metrics && metrics.border.some((value) => value !== 0)) {
    return (
      <>
        <ImageTintFilterDefinitions id={filterId} color={image.color} />
        <div
          className={webClasses("image-visual image-sliced")}
          data-image-type={type}
          style={{ ...slicedStyle(image, metrics), ...tintStyle }}
        />
      </>
    );
  }
  if (type === "tiled" && metrics) {
    const multiplier = image.pixelsPerUnitMultiplier ?? 1;
    return (
      <>
        <ImageTintFilterDefinitions id={filterId} color={image.color} />
        <div
          className={webClasses("image-visual image-tiled")}
          data-image-type={type}
          style={{
            backgroundImage: `url(${JSON.stringify(assetUrl(image.sprite))})`,
            backgroundRepeat: "repeat",
            backgroundSize: `${metrics.width / multiplier}px ${metrics.height / multiplier}px`,
            ...tintStyle,
          }}
        />
      </>
    );
  }
  return (
    <div className={webClasses("image-visual image-source")} data-image-type={type} style={imageFillMaskStyle(image)}>
      <TintedImage
        src={assetUrl(image.sprite)}
        color={image.color}
        objectFit={image.preserveAspect && (type === "simple" || type === "filled") ? "contain" : "fill"}
      />
    </div>
  );
}
