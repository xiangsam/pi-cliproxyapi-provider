# Derive thinking levels from models.dev reasoning_options

Accepted. The provider maps models.dev `reasoning_options` entries of
`type: "effort"` onto pi's `thinkingLevelMap`, mapping every level the list names
and marking every level it omits as unsupported. models.dev takes precedence over
the built-in GPT-5.6 capability rule, which now serves as a fallback for models
whose metadata carries no effort list.

## Context

pi exposes seven thinking levels (`off`, `minimal`, `low`, `medium`, `high`,
`xhigh`, `max`) but derives the offered set from the model's `thinkingLevelMap`
in a way that has two consequences:

- `xhigh` and `max` are hidden unless the map names them explicitly, so a model
  capable of `max` is unreachable through the UI without a map.
- Levels through `high` are offered by default when the map omits them, so
  leaving a level out is not a way to hide it.

That second rule is why an unsupported level reaches the wire. CLIProxyAPI
validates the level the client sends and answers an unsupported one with
`400 level "medium" not supported, valid levels: low, high, max`. Because pi's
default thinking level is `medium`, a model whose proxy accepts only
`low, high, max` fails on the first request until the user selects a supported
level by hand.

The same field also decides whether thinking can be switched off, and it signals
that separately from the level list. models.dev publishes `{type: "toggle"}`
next to an effort list that omits `none` for 296 catalog entries, `deepseek`
among them, meaning the levels are selectable but thinking can still be turned
off. Reading the effort list alone would hide `off` from a model that supports
it, so the converter treats either signal as permission to offer `off` and sends
`none`, which a live proxy accepts for both `deepseek-flash` and
`deepseek-v4-pro`.

CLIProxyAPI's model discovery endpoint returns only `id`, `object`, `created`,
and `owned_by`, so the proxy cannot report its own level matrix. Per ADR 0001 the
package does not use the proxy Management API.

## Why models.dev outranks the built-in rule

The precedence was initially the other way around: the GPT-5.6 rule was treated
as an intentional override that metadata must not narrow. Measurement against a
live CLIProxyAPI instance showed that was backwards, and shipping it would have
broken requests:

- The rule maps `minimal`, and the proxy rejects it for the GPT-5.6 family with
  `400 level "minimal" not supported, valid levels: low, medium, high, xhigh, max`.
- The models.dev list for the same model omits `minimal` and matches the proxy's
  accepted set exactly.

models.dev moves with the model; the rule was written against an older catalog
and had gone stale. The rule is retained only as a fallback, because it is still
correct for metadata that carries no effort list.

## Consequences

models.dev describes a model's canonical capability, which is not always what a
given CLIProxyAPI route accepts, so the mapping is an approximation. The two
directions of error are not symmetric:

- **Under-offering is safe.** When metadata names fewer levels than the proxy
  accepts, the user loses access to a level until they override the map.
- **Over-offering is not.** When metadata names a level the proxy rejects, pi
  sends it and the request fails with `400`. This was observed, not just reasoned
  about: the stale GPT-5.6 rule produced exactly this failure, which is what
  motivated inverting the precedence.

Fidelity also depends on match confidence. A match resolved by `owner-prefix`
describes the model's canonical provider, while a `suffix` or `provider-fallback`
match may describe a different provider's serving of the same model with
different levels: `deepseek-v4-pro` resolves through the `openrouter` fallback to
`openrouter/deepseek/deepseek-v4-pro`, whose list differs from
`deepseek/deepseek-v4-pro`. Restricting the map to high-confidence matches was
rejected, because the correct match for `deepseek-flash` resolves by `suffix`
precisely because the proxy reports its owner as `openai`.

Verification that every offered level is accepted requires a live proxy and per
model judgement about whether a failure is a rejected level or an unrelated
condition such as credential cooldown, so it is not part of the automated suite.

Users correct a wrong list through pi's own `models.json` `modelOverrides`, which
is applied after provider registration and therefore outranks both models.dev and
the built-in rules. The package's own `modelOverrides` is deliberately not
extended for this: it intentionally supports only `reasoning`, `contextWindow`,
and `maxTokens`.
