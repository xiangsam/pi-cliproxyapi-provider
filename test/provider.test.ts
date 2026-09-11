import test from "node:test";
import assert from "node:assert/strict";
import { buildProviderModels, PI_MODEL_DEFAULTS } from "../src/provider.ts";
import type { CpaModel } from "../src/cpa.ts";

const cpaModels: CpaModel[] = [
  { id: "gpt-5.5", object: "model", owned_by: "openai", created: 1776902400 },
  { id: "claude-opus-4-6-thinking", object: "model", owned_by: "antigravity" },
  { id: "unknown-local", object: "model", owned_by: "feedmob-litellm" }
];

const catalog = {
  "openai/gpt-5.5": {
    id: "openai/gpt-5.5",
    name: "GPT-5.5",
    reasoning: true,
    modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    limit: { context: 1050000, output: 128000 },
    cost: { input: 3, output: 18, cache_read: 0.3, cache_write: 3 }
  },
  "anthropic/claude-opus-4-6": {
    id: "anthropic/claude-opus-4-6",
    name: "Claude Opus 4.6",
    reasoning: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 1000000, output: 128000 },
    cost: { input: 5, output: 25 }
  }
};

test("enriches matched models but preserves CPA model IDs", () => {
  const result = buildProviderModels(cpaModels, catalog, {
    "claude-opus-4-6-thinking": "anthropic/claude-opus-4-6"
  });

  assert.equal(result.models[0].id, "gpt-5.5");
  assert.equal(result.models[0].name, "GPT-5.5");
  assert.deepEqual(result.models[0].input, ["text", "image"]);
  assert.equal(result.models[0].contextWindow, 1050000);
  assert.equal(result.models[1].id, "claude-opus-4-6-thinking");
  assert.equal(result.models[1].name, "Claude Opus 4.6");
  assert.equal(result.stats.enriched, 2);
});

test("uses explicit pi defaults for unmatched dynamic models", () => {
  const result = buildProviderModels([cpaModels[2]], catalog, {});

  assert.deepEqual(result.models[0], {
    id: "unknown-local",
    name: "unknown-local",
    ...PI_MODEL_DEFAULTS
  });
  assert.equal(result.stats.unmatched, 1);
});

test("does not share mutable default objects between fallback models", () => {
  const result = buildProviderModels([{ id: "a" }, { id: "b" }], {}, {});

  result.models[0].input.push("image");
  result.models[0].cost.input = 99;

  assert.deepEqual(result.models[1].input, ["text"]);
  assert.equal(result.models[1].cost.input, 0);
});

test("adds the thinking map to every GPT-5.6 model family member", () => {
  // `minimal` is hidden rather than mapped: the proxy rejects that level for
  // every measured GPT-5.6 model, and these IDs carry no models.dev metadata to
  // override the rule with.
  const expectedThinkingLevelMap = {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  };
  const result = buildProviderModels([
    { id: "gpt-5.6-luna" },
    { id: "0xdev/gpt-5.6-sol" },
    { id: "gpt-5.6-terra" },
  ], catalog, {});

  for (const model of result.models) {
    assert.equal(model.reasoning, true);
    assert.deepEqual(model.thinkingLevelMap, expectedThinkingLevelMap);
  }
});

test("routes GPT-5.6 family models through the Responses API", () => {
  const result = buildProviderModels([
    { id: "gpt-5.6" },
    { id: "gpt-5.6-codex" },
    { id: "0xdev/gpt-5.6-codex-mini" },
    { id: "gpt-5.60" },
    { id: "claude-opus-4-6" },
  ], {}, {});

  assert.deepEqual(result.models.map((model) => model.api), [
    "openai-responses",
    "openai-responses",
    "openai-responses",
    undefined,
    undefined,
  ]);
});

test("uses provider pricing while keeping the canonical GPT-5.6 context window by default", () => {
  const providerCatalog = {
    "openai/gpt-5.6-sol": {
      id: "openai/gpt-5.6-sol",
      limit: { context: 1050000, output: 128000 },
      cost: {
        input: 5,
        output: 30,
        cache_read: 0.5,
        cache_write: 6.25,
        tiers: [{
          input: 10,
          output: 45,
          cache_read: 1,
          cache_write: 12.5,
          tier: { type: "context", size: 272000 },
        }],
      },
    },
    "routing-run/gpt-5.6-sol": {
      id: "routing-run/gpt-5.6-sol",
      limit: { context: 1000000, output: 128000 },
      cost: { input: 2.5, output: 15 },
    },
  };
  const result = buildProviderModels(
    [{ id: "gpt-5.6-sol", owned_by: "openai" }],
    providerCatalog,
    {},
  );

  assert.deepEqual(result.models[0].cost, {
    input: 5,
    output: 30,
    cacheRead: 0.5,
    cacheWrite: 6.25,
    tiers: [{ inputTokensAbove: 272000, input: 10, output: 45, cacheRead: 1, cacheWrite: 12.5 }],
  });
  assert.equal(result.models[0].contextWindow, 272000);
  assert.equal(result.models[0].maxTokens, 128000);
  assert.equal(result.stats.matchMethods["owner-prefix"], 1);
  assert.equal(result.stats.unmatched, 0);

  const full = buildProviderModels(
    [{ id: "gpt-5.6-sol", owned_by: "openai" }],
    providerCatalog,
    {},
    "full",
  );
  assert.equal(full.models[0].contextWindow, 1050000);
  assert.deepEqual(full.models[0].cost, result.models[0].cost);
});

test("recognizes GPT-5.6 through a canonical metadata alias", () => {
  const result = buildProviderModels(
    [{ id: "custom-luna" }],
    {
      "openai/gpt-5.6-luna": {
        id: "openai/gpt-5.6-luna",
        name: "GPT-5.6 Luna",
        reasoning: true,
      },
    },
    { "custom-luna": "openai/gpt-5.6-luna" },
  );

  assert.equal(result.models[0].reasoning, true);
  assert.equal(result.models[0].api, "openai-responses");
  assert.equal(result.models[0].thinkingLevelMap?.max, "max");
  assert.equal(result.models[0].contextWindow, 272000);
});

test("adds GPT-5.6 capabilities even when metadata is unavailable", () => {
  const result = buildProviderModels([{ id: "0xdev/gpt-5.6-luna" }], {}, {});

  assert.equal(result.models[0].reasoning, true);
  assert.equal(result.models[0].thinkingLevelMap?.off, "none");
  assert.equal(result.models[0].thinkingLevelMap?.max, "max");
  assert.equal(result.models[0].contextWindow, 272000);
});

test("applies bounded user overrides without changing forced model API selection", () => {
  const result = buildProviderModels(
    [{ id: "gpt-5.6-codex" }],
    {},
    {},
    "canonical",
    {
      "gpt-5.6-codex": {
        reasoning: false,
        contextWindow: 512000,
        maxTokens: 32768,
      },
    },
  );

  assert.equal(result.models[0].reasoning, false);
  assert.equal(result.models[0].contextWindow, 512000);
  assert.equal(result.models[0].maxTokens, 32768);
  assert.equal(result.models[0].api, "openai-responses");
  assert.equal(result.models[0].thinkingLevelMap?.max, "max");
});

test("derives thinking levels from models.dev reasoning_options", () => {
  const result = buildProviderModels(
    [{ id: "deepseek-flash", object: "model", owned_by: "deepseek" }],
    {
      "deepseek/deepseek-flash": {
        id: "deepseek/deepseek-flash",
        name: "DeepSeek Flash",
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 1000000, output: 384000 },
        cost: { input: 0.15, output: 0.6, cache_read: 0.003 },
      },
    },
    {},
  );

  const model = result.models[0];
  assert.equal(model.reasoning, true);
  // pi offers exactly the published levels, including the extended `max` that it
  // hides unless the map names it.
  assert.deepEqual(model.thinkingLevelMap, {
    off: null,
    minimal: null,
    low: "low",
    medium: null,
    high: "high",
    xhigh: null,
    max: "max",
  });
});

test("lets models.dev levels replace a stale hardcoded capability rule", () => {
  // Regression: a live CLIProxyAPI instance rejects `minimal` for gpt-5.6 with
  // `400 level "minimal" not supported`, while the built-in rule still maps it.
  // models.dev omits `minimal` for this model and matches the proxy, so its list
  // must win or pi sends a request the proxy refuses.
  const result = buildProviderModels(
    [{ id: "gpt-5.6-sol", object: "model", owned_by: "openai" }],
    {
      "openai/gpt-5.6-sol": {
        id: "openai/gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["none", "low", "medium", "high", "xhigh", "max"] }],
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 1050000, output: 128000 },
        cost: { input: 4, output: 20 },
      },
    },
    {},
  );

  const map = result.models[0].thinkingLevelMap;
  assert.equal(map?.minimal, null, "minimal must be hidden, not offered");
  assert.equal(map?.off, "none");
  assert.equal(map?.xhigh, "xhigh");
  assert.equal(map?.max, "max");
});

test("keeps the hardcoded rule as a fallback when metadata has no level list", () => {
  const result = buildProviderModels(
    [{ id: "gpt-5.6-sol", object: "model", owned_by: "openai" }],
    {
      "openai/gpt-5.6-sol": {
        id: "openai/gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        reasoning: true,
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 1050000, output: 128000 },
        cost: { input: 4, output: 20 },
      },
    },
    {},
  );

  // The rule still describes the family when models.dev publishes nothing, but
  // it hides `minimal`: the proxy rejects that level for every measured GPT-5.6
  // model, so offering it here would fail requests whenever metadata is missing.
  assert.equal(result.models[0].thinkingLevelMap?.minimal, null);
  assert.equal(result.models[0].thinkingLevelMap?.off, "none");
  assert.equal(result.models[0].thinkingLevelMap?.max, "max");
});

test("omits the level map when metadata publishes no level list", () => {
  const result = buildProviderModels(
    [{ id: "claude-opus-4-6", object: "model", owned_by: "anthropic" }],
    {
      "anthropic/claude-opus-4-6": {
        id: "anthropic/claude-opus-4-6",
        name: "Claude Opus 4.6",
        reasoning: true,
        reasoning_options: [{ type: "budget_tokens", min: 1024 }],
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 1000000, output: 128000 },
        cost: { input: 5, output: 25 },
      },
    },
    {},
  );

  assert.equal(result.models[0].thinkingLevelMap, undefined);
});

test("preserves models.dev cost so pi can price usage", () => {
  const result = buildProviderModels(
    [{ id: "deepseek-flash", object: "model", owned_by: "deepseek" }],
    {
      "deepseek/deepseek-flash": {
        id: "deepseek/deepseek-flash",
        name: "DeepSeek Flash",
        reasoning: true,
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 1000000, output: 384000 },
        cost: { input: 0.15, output: 0.6, cache_read: 0.003, cache_write: 0.1 },
      },
    },
    {},
  );

  // models.dev quotes USD per million tokens, which is the unit pi expects; it
  // divides by 1000000 when costing usage.
  assert.deepEqual(result.models[0].cost, {
    input: 0.15,
    output: 0.6,
    cacheRead: 0.003,
    cacheWrite: 0.1,
  });
});

test("carries context pricing tiers through to pi", () => {
  const result = buildProviderModels(
    [{ id: "gpt-5.6-sol", object: "model", owned_by: "openai" }],
    {
      "openai/gpt-5.6-sol": {
        id: "openai/gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        reasoning: true,
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 1050000, output: 128000 },
        cost: {
          input: 4,
          output: 20,
          cache_read: 0.4,
          cache_write: 5,
          tiers: [
            {
              input: 8,
              output: 30,
              cache_read: 0.8,
              cache_write: 10,
              tier: { type: "context", size: 272000 },
            },
          ],
        },
      },
    },
    {},
  );

  assert.deepEqual(result.models[0].cost.tiers, [
    { inputTokensAbove: 272000, input: 8, output: 30, cacheRead: 0.8, cacheWrite: 10 },
  ]);
});
