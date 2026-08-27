import { useId } from "react";
import { createWebClasses } from "../../styles/web-styles.js";
import renderingStyles from "../rendering.module.css";

const webClasses = createWebClasses(renderingStyles);

export interface TintedImageProps {
  readonly src: string;
  readonly color?: string | undefined;
  readonly objectFit?: "fill" | "contain" | undefined;
}

export function imageTintMultipliers(color: string | undefined): readonly [number, number, number, number] {
  if (!color || !/^#[0-9A-Fa-f]{8}$/.test(color)) return [1, 1, 1, 1];
  return [
    Number.parseInt(color.slice(1, 3), 16) / 255,
    Number.parseInt(color.slice(3, 5), 16) / 255,
    Number.parseInt(color.slice(5, 7), 16) / 255,
    Number.parseInt(color.slice(7, 9), 16) / 255,
  ];
}

export function usesImageTint(color: string | undefined): boolean {
  return imageTintMultipliers(color).some((value) => value !== 1);
}

export function ImageTintFilterDefinitions({ id, color }: { readonly id: string; readonly color?: string | undefined }) {
  const [red, green, blue, alpha] = imageTintMultipliers(color);
  return (
    <svg className={webClasses("image-tint-definitions")} aria-hidden="true" focusable="false">
      <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feComponentTransfer>
          <feFuncR type="linear" slope={red} intercept={0} />
          <feFuncG type="linear" slope={green} intercept={0} />
          <feFuncB type="linear" slope={blue} intercept={0} />
          <feFuncA type="linear" slope={alpha} intercept={0} />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}

export function TintedImage({ src, color, objectFit = "fill" }: TintedImageProps) {
  const filterId = `image-tint-${useId().replaceAll(":", "")}`;
  if (!usesImageTint(color)) return <img src={src} draggable={false} alt="" style={{ objectFit }} />;
  return (
    <>
      <ImageTintFilterDefinitions id={filterId} color={color} />
      <img src={src} draggable={false} alt="" style={{ filter: `url(#${filterId})`, objectFit }} />
    </>
  );
}
