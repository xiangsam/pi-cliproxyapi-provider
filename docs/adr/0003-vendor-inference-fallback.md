# Vendor inference fallback for proxy-renamed models

Accepted. When the primary metadata matcher from ADR 0001 fails, the package
falls back to stripping proxy variant suffixes and inferring the upstream vendor
from the model name before giving up and registering defaults.

## Context

The primary matcher resolves metadata from models.dev using the CPA model ID,
its `owned_by`, and the configured fallback provider. A real CPA instance
exposed 34 models, and 16 of them resolved to nothing, so pi registered them
with hardcoded defaults: `reasoning: false`, text-only input, a 128000-token
context window, and no thinking levels. The defaults are wrong for every one of
those models, and the failure modes are structural rather than one-off:

- The proxy renames models with variant suffixes that models.dev does not
  publish: `claude-opus-5-5-high`, `gemini-3.6-flash-high`,
  `gpt-oss-120b-medium`, `grok-4.7-build-fast`,
  `grok-imagine-video-1.5-preview`.
- The proxy drops suffixes models.dev keeps: `gemini-3-flash` vs
  `google/gemini-3-flash-preview`, `gemini-3.1-pro-low` vs
  `google/gemini-3.1-pro-preview`.
- The proxy reports a misleading canonical owner: `deepseek-flash` arrives with
  `owned_by: openai`, so the canonical-owner lookup misses the DeepSeek entry.
- models.dev only carries reseller entries for some models (`grok-3-mini`,
  `grok-imagine-image-2.0`), where the upstream vendor lives in the metadata id
  path (`poe/xai/grok-3-mini` has id `xai/grok-3-mini`).

## Decision

The primary matcher from ADR 0001 is unchanged and still runs first. Only when
it returns no match does the package run a vendor-inference pass:

1. Generate candidate names from the CPA model ID by progressively stripping the
   variant suffixes `-non-reasoning`, `-reasoning`, `-thinking`, `-preview`,
   `-medium`, `-build`, `-high`, `-fast`, and `-low`, and by also trying a
   `-preview` variant of each candidate.
2. For each candidate, infer the upstream vendor from the model name
   (`claude-*` → `anthropic`, `gemini-*` → `google`, `gpt-*`/`o1`/`o3`/`o4` →
   `openai`, `deepseek-*` → `deepseek`, `grok-*` → `xai`, and so on).
3. Resolve the candidate using the inferred vendor: a `{vendor}/{candidate}`
   key hit, then a unique suffix candidate whose `sourceProvider` is that
   vendor, then an owner hint that also reads the provider path inside
   `metadata.id`, then the existing unique-suffix and provider-fallback rules.

The pass introduces three new match methods for reporting:
`vendor-prefix`, `vendor-first-party`, and `vendor-hint`.

## Consequences

- Models the primary matcher resolves keep their existing match source, so the
  conservative owner-driven behavior from ADR 0001 is preserved for them.
  Inference only rescues models that would otherwise fall through to defaults.
- Vendor-name inference is an approximation: it describes the model's canonical
  capability, not necessarily the proxy route's billing or accepted thinking
  levels. A mismatch can still be corrected with a metadata alias or pi's own
  `modelOverrides`, both of which outrank inference.
- The fallback is intentionally never applied when the primary matcher already
  matched, even if inference would have chosen a different provider, to keep
  existing deployments' match sources stable.
