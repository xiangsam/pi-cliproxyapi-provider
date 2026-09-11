import type { ThinkingLevelMap } from "@earendil-works/pi-ai";
import type { ModelsDevReasoningOption } from "./types.ts";

/** pi thinking levels in ascending depth, excluding `off`. */
const PI_THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** The models.dev effort value that means "thinking disabled". */
const EFFORT_OFF = "none";

/**
 * Convert models.dev `reasoning_options` into a pi `ThinkingLevelMap`.
 *
 * models.dev publishes an exhaustive `type: "effort"` list for models whose
 * reasoning depth is selectable, using the same vocabulary pi exposes (`none`
 * plus `minimal`..`max`). The conversion is total in both directions:
 *
 *   - a level present in the list maps to itself, so pi sends that exact value
 *   - a level absent from the list maps to `null`, which hides it in pi's UI
 *   - pi's `off` maps to models.dev `none`, which the list may signal either as
 *     an effort value or as a separate `toggle` entry
 *
 * Null-ing absent levels is the point of this function. Because the list is
 * exhaustive, leaving a level `undefined` would let pi offer it using the
 * provider default, and a proxy that validates the level rejects the request.
 * CLIProxyAPI does exactly that: it answers an unsupported level with
 * `400 level "medium" not supported, valid levels: low, high, max`.
 *
 * `off` needs both signals because models.dev splits the ability to disable
 * thinking from the level list. A model can publish `["low","high","max"]`
 * alongside `{type: "toggle"}`, meaning thinking is selectable only within those
 * levels but can still be switched off; reading the effort list alone would hide
 * `off` from a model that supports it. 296 catalog entries have this shape,
 * including `deepseek/deepseek-flash`, which a live CLIProxyAPI instance accepts
 * `reasoning_effort: "none"` for.
 *
 * Returns `undefined` when the model publishes no effort list, so callers keep
 * their own default. A lone `toggle` or `budget_tokens` entry enumerates no
 * levels and cannot be expressed as a level map, so it is ignored.
 */
export function thinkingLevelMapFromReasoningOptions(
  options: ModelsDevReasoningOption[] | undefined,
): ThinkingLevelMap | undefined {
  const effort = options?.find(
    (option) => option.type === "effort" && Array.isArray(option.values) && option.values.length > 0,
  );
  const values = effort?.values;
  if (!values) return undefined;

  const offered = new Set(values);
  const canDisableThinking =
    offered.has(EFFORT_OFF) || (options?.some((option) => option.type === "toggle") ?? false);
  const map: ThinkingLevelMap = {
    off: canDisableThinking ? EFFORT_OFF : null,
  };
  for (const level of PI_THINKING_LEVELS) {
    map[level] = offered.has(level) ? level : null;
  }
  return map;
}
