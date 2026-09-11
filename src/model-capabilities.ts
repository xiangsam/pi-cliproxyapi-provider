import type { ThinkingLevelMap } from "@earendil-works/pi-ai";

export interface ModelCapabilityContext {
  availableModelId: string;
  metadataModelId?: string;
}

export interface ModelCapabilityOverrides {
  reasoning?: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
}

interface ModelCapabilityRule {
  matches: (context: ModelCapabilityContext) => boolean;
  overrides: ModelCapabilityOverrides;
}

/**
 * Fallback level map for the GPT-5.6 family, used only when models.dev publishes
 * no effort list for the model.
 *
 * `minimal` is explicitly unsupported. Measured against a live CLIProxyAPI
 * instance, gpt-5.6-sol, -terra, and -luna all answer
 * `400 level "minimal" not supported, valid levels: low, medium, high, xhigh, max`,
 * so offering it produces a failing request. models.dev omits `minimal` for the
 * same models, which is why this rule is the fallback rather than the source of
 * truth; it stays correct by hiding what the model does not accept.
 */
const GPT_5_6_THINKING_LEVEL_MAP: ThinkingLevelMap = {
  off: "none",
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

function includesModelFamily(context: ModelCapabilityContext, family: string): boolean {
  return [context.availableModelId, context.metadataModelId]
    .filter((id): id is string => id !== undefined)
    .some((id) => id.includes(family));
}

const MODEL_CAPABILITY_RULES: readonly ModelCapabilityRule[] = [
  {
    matches: (context) => includesModelFamily(context, "gpt-5.6"),
    overrides: {
      reasoning: true,
      thinkingLevelMap: GPT_5_6_THINKING_LEVEL_MAP,
    },
  },
];

export function getModelCapabilityOverrides(context: ModelCapabilityContext): ModelCapabilityOverrides {
  const resolved: ModelCapabilityOverrides = {};

  for (const rule of MODEL_CAPABILITY_RULES) {
    if (!rule.matches(context)) continue;
    if (rule.overrides.reasoning !== undefined) resolved.reasoning = rule.overrides.reasoning;
    if (rule.overrides.thinkingLevelMap) resolved.thinkingLevelMap = { ...rule.overrides.thinkingLevelMap };
  }

  return resolved;
}
