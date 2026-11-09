import { createContext, useContext, type ReactNode } from "react";
import type { Formatter, FormatterProgressivePolicy, LayerFormat } from "@asterdoc/types";

export interface ArtifactFormatting {
  formatter?: Formatter;
  progressive?: FormatterProgressivePolicy;
  /** The presentation documents below inherit, such as a React layer's `format`. */
  presentation?: LayerFormat;
}
const Context = createContext<ArtifactFormatting>({});
export function FormatterProvider({ children, ...value }: ArtifactFormatting & { children?: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useArtifactFormatting(): ArtifactFormatting { return useContext(Context); }
