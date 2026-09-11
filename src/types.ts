import type { ThinkingLevelMap } from "@earendil-works/pi-ai";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export type InputModality = "text" | "image";

export interface ProviderModelOverride {
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ProviderModelOverrideLayer {
  reasoning?: boolean | null;
  contextWindow?: number | null;
  maxTokens?: number | null;
}

export type ProviderModelOverrides = Record<string, ProviderModelOverride>;
export type ProviderModelOverrideLayers = Record<string, ProviderModelOverrideLayer>;

export interface CpaProviderConfig {
  providerName: string;
  baseUrl: string;
  authRequired: boolean;
  authHeader: boolean;
  headers: Record<string, string>;
  modelsDevEnabled: boolean;
  metadataFallbackProvider: string | null;
  modelAliases: Record<string, string>;
  modelOverrides: ProviderModelOverrides;
}

export interface ModelsDevMetadata {
  id: string;
  /** models.dev provider key retained for owner-hint matching. */
  sourceProvider?: string;
  name?: string;
  reasoning?: boolean;
  /**
   * How the model exposes reasoning control. Only `type: "effort"` entries carry
   * a level list that maps onto pi thinking levels; `toggle` and `budget_tokens`
   * describe other shapes and are not converted.
   */
  reasoning_options?: ModelsDevReasoningOption[];
  modalities?: {
    input?: string[];
    output?: string[];
  };
  limit?: {
    context?: number;
    output?: number;
  };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    tiers?: Array<{
      input?: number;
      output?: number;
      cache_read?: number;
      cache_write?: number;
      tier?: {
        type?: string;
        size?: number;
      };
    }>;
  };
}

export type ModelsDevCatalog = Record<string, ModelsDevMetadata>;

/**
 * One entry of a models.dev `reasoning_options` array.
 *
 * `type` is kept as a plain string because models.dev adds shapes over time
 * (currently `effort`, `toggle`, and `budget_tokens`) and unknown ones must be
 * ignored rather than rejected.
 */
export interface ModelsDevReasoningOption {
  type: string;
  /** Levels for `type: "effort"`, drawn from the same vocabulary pi uses. */
  values?: string[];
  /** Token bounds for `type: "budget_tokens"`. */
  min?: number;
  max?: number;
}

export interface ProviderModelConfigLike {
  id: string;
  name: string;
  reasoning: boolean;
  api?: ProviderModelConfig["api"];
  compat?: ProviderModelConfig["compat"];
  thinkingLevelMap?: ThinkingLevelMap;
  input: InputModality[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    tiers?: Array<{
      inputTokensAbove: number;
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    }>;
  };
  contextWindow: number;
  maxTokens: number;
}
