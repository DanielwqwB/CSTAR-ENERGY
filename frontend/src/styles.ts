import type { CSSProperties } from "react";

type Style = CSSProperties | false | undefined | null | Style[];
/** Compose optional browser styles without mutating shared theme objects. */
export function css(...styles: Style[]): CSSProperties {
  const result: CSSProperties = {};
  for (const style of styles) {
    if (Array.isArray(style)) Object.assign(result, css(...style));
    else if (style) Object.assign(result, style);
  }
  return result;
}
