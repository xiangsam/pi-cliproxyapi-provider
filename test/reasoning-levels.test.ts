import test from "node:test";
import assert from "node:assert/strict";
import { thinkingLevelMapFromReasoningOptions } from "../src/reasoning-levels.ts";

test("maps an exhaustive effort list and hides every level it omits", () => {
  // The CLIProxyAPI shape for a model that only offers three levels. Hiding the
  // rest is required: an unsupported level reaches the proxy and it answers 400.
  const map = thinkingLevelMapFromReasoningOptions([
    { type: "effort", values: ["low", "high", "max"] },
  ]);

  assert.deepEqual(map, {
    off: null,
    minimal: null,
    low: "low",
    medium: null,
    high: "high",
    xhigh: null,
    max: "max",
  });
});

test("maps off to none when the model can disable thinking", () => {
  const viaEffortValue = thinkingLevelMapFromReasoningOptions([
    { type: "effort", values: ["none", "low", "high"] },
  ]);
  assert.equal(viaEffortValue?.off, "none");

  // models.dev splits "can be switched off" from the level list: a toggle entry
  // alongside a level list that lacks `none` still means off is selectable.
  // deepseek-flash has this shape and a live proxy accepts `none` for it.
  const viaToggle = thinkingLevelMapFromReasoningOptions([
    { type: "toggle" },
    { type: "effort", values: ["low", "high", "max"] },
  ]);
  assert.equal(viaToggle?.off, "none");
  assert.equal(viaToggle?.low, "low");
  assert.equal(viaToggle?.max, "max");

  const neither = thinkingLevelMapFromReasoningOptions([
    { type: "effort", values: ["low", "high"] },
  ]);
  assert.equal(neither?.off, null);
});

test("exposes xhigh and max, which pi only offers when explicitly mapped", () => {
  const map = thinkingLevelMapFromReasoningOptions([
    { type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
  ]);

  // pi hides extended levels whose key is undefined and shows the ones mapped to
  // a string, so these must be strings rather than absent.
  assert.equal(map?.xhigh, "xhigh");
  assert.equal(map?.max, "max");
});

test("ignores token and toggle shapes, which describe no levels", () => {
  assert.equal(thinkingLevelMapFromReasoningOptions([{ type: "toggle" }]), undefined);
  assert.equal(
    thinkingLevelMapFromReasoningOptions([{ type: "budget_tokens", min: 1024, max: 63999 }]),
    undefined,
  );
  assert.equal(
    thinkingLevelMapFromReasoningOptions([{ type: "toggle" }, { type: "budget_tokens", min: 1024 }]),
    undefined,
  );
});

test("prefers the effort entry when a model publishes several option types", () => {
  const map = thinkingLevelMapFromReasoningOptions([
    { type: "toggle" },
    { type: "effort", values: ["low", "medium", "high", "max"] },
    { type: "budget_tokens", min: 1024 },
  ]);

  assert.equal(map?.low, "low");
  assert.equal(map?.max, "max");
  assert.equal(map?.minimal, null);
});

test("returns undefined when no level list is published", () => {
  assert.equal(thinkingLevelMapFromReasoningOptions(undefined), undefined);
  assert.equal(thinkingLevelMapFromReasoningOptions([]), undefined);
  assert.equal(thinkingLevelMapFromReasoningOptions([{ type: "effort" }]), undefined);
  assert.equal(thinkingLevelMapFromReasoningOptions([{ type: "effort", values: [] }]), undefined);
});

test("ignores unknown values instead of inventing levels for them", () => {
  // models.dev carries a handful of noise values (`default`, `null`). They match
  // no pi level, so they must be dropped rather than passed through.
  const map = thinkingLevelMapFromReasoningOptions([
    { type: "effort", values: ["low", "high", "default", "null"] },
  ]);

  assert.deepEqual(Object.values(map ?? {}).filter((value) => value !== null), ["low", "high"]);
});
