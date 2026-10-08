import type { CpaModel } from "./cpa.ts";
import type { ModelsDevCatalog, ModelsDevMetadata } from "./types.ts";

const CANONICAL_OWNER_PREFIXES: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  deepseek: "deepseek",
  mistral: "mistral",
  xai: "xai",
  zhipuai: "zhipuai",
  alibaba: "alibaba",
  moonshotai: "moonshotai",
  minimax: "minimax",
  nvidia: "nvidia",
  cohere: "cohere",
};

export type MetadataMatchMethod =
  | "alias"
  | "exact"
  | "owner-prefix"
  | "owner-hint"
  | "suffix"
  | "normalized-suffix"
  | "provider-fallback"
  | "vendor-prefix"
  | "vendor-first-party"
  | "vendor-hint";

export interface MetadataMatch {
  metadataId: string;
  metadata: ModelsDevMetadata;
  method: MetadataMatchMethod;
}

export function normalizeModelName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function metadataModelName(metadataId: string, metadata: ModelsDevMetadata): string {
  return metadata.id.split("/").at(-1) ?? metadataId.split("/").at(-1) ?? metadataId;
}

function oneMatch(candidates: string[]): string | undefined {
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : undefined;
}

function identifierTokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function containsContiguousTokens(container: string[], sequence: string[]): boolean {
  if (sequence.length === 0 || sequence.length > container.length) return false;
  return container.some((_, start) =>
    start + sequence.length <= container.length &&
    sequence.every((token, offset) => container[start + offset] === token)
  );
}

function sourceProvider(metadataId: string, metadata: ModelsDevMetadata): string {
  // sourceProvider is retained by current catalog snapshots. The prefix fallback
  // keeps older bundled/cache snapshots useful until they are refreshed.
  return metadata.sourceProvider ?? metadataId.split("/")[0] ?? metadataId;
}

function ownerHintMatch(
  owner: string | undefined,
  candidates: string[],
  catalog: ModelsDevCatalog,
  includeIdPath = false,
): string | undefined {
  if (!owner) return undefined;
  const ownerTokens = identifierTokens(owner);
  const normalizedOwner = normalizeModelName(owner);
  const matches = candidates.flatMap((metadataId) => {
    const metadata = catalog[metadataId];
    if (!metadata) return [];
    const found = [];
    const provider = sourceProvider(metadataId, metadata);
    const providerTokens = identifierTokens(provider);
    if (containsContiguousTokens(ownerTokens, providerTokens)) {
      found.push({ metadataId, tokenCount: providerTokens.length, characterCount: provider.length });
    }
    if (includeIdPath && normalizedOwner) {
      // Reseller entries often keep the upstream provider in the metadata id
      // path (e.g. `poe/xai/grok-3-mini` has id `xai/grok-3-mini`). Match the
      // owner against those path segments as a last-resort vendor hint. The
      // large token count ranks this above sourceProvider token matches.
      const idPathSegments = metadata.id.split("/").slice(0, -1);
      for (const segment of idPathSegments) {
        if (normalizeModelName(segment) === normalizedOwner) {
          found.push({ metadataId, tokenCount: 1000 + segment.length, characterCount: segment.length });
        }
      }
    }
    return found;
  });
  if (matches.length === 0) return undefined;

  const bestTokenCount = Math.max(...matches.map((match) => match.tokenCount));
  const mostTokens = matches.filter((match) => match.tokenCount === bestTokenCount);
  const bestCharacterCount = Math.max(...mostTokens.map((match) => match.characterCount));
  return oneMatch(
    mostTokens
      .filter((match) => match.characterCount === bestCharacterCount)
      .map((match) => match.metadataId),
  );
}

export function findMetadataMatch(
  cpaModel: Pick<CpaModel, "id" | "owned_by">,
  catalog: ModelsDevCatalog,
  aliases: Record<string, string>,
  fallbackProvider?: string | null,
): MetadataMatch | undefined {
  const alias = aliases[cpaModel.id];
  if (alias && catalog[alias]) {
    return { metadataId: alias, metadata: catalog[alias], method: "alias" };
  }

  if (catalog[cpaModel.id]) {
    return { metadataId: cpaModel.id, metadata: catalog[cpaModel.id], method: "exact" };
  }

  const catalogKeys = Object.keys(catalog);
  const exactMetadataCandidates = catalogKeys.filter((key) => catalog[key]?.id === cpaModel.id);
  const exactMetadataKey = oneMatch(exactMetadataCandidates);
  if (exactMetadataKey) {
    return { metadataId: exactMetadataKey, metadata: catalog[exactMetadataKey], method: "exact" };
  }

  const suffixCandidates = catalogKeys.filter((key) =>
    metadataModelName(key, catalog[key]) === cpaModel.id
  );
  const normalizedId = normalizeModelName(cpaModel.id);
  const normalizedSuffixCandidates = catalogKeys.filter(
    (key) => normalizeModelName(metadataModelName(key, catalog[key])) === normalizedId,
  );
  const owner = cpaModel.owned_by?.trim().toLowerCase();
  const canonicalOwner = owner ? CANONICAL_OWNER_PREFIXES[owner] : undefined;
  if (canonicalOwner) {
    const ownerKey = `${canonicalOwner}/${cpaModel.id}`;
    if (catalog[ownerKey]) {
      return { metadataId: ownerKey, metadata: catalog[ownerKey], method: "owner-prefix" };
    }
  }

  const hintedKey = ownerHintMatch(owner, normalizedSuffixCandidates, catalog);
  if (hintedKey) {
    return { metadataId: hintedKey, metadata: catalog[hintedKey], method: "owner-hint" };
  }

  const suffixKey = oneMatch(suffixCandidates);
  if (suffixKey) {
    return { metadataId: suffixKey, metadata: catalog[suffixKey], method: "suffix" };
  }

  const normalizedSuffixKey = oneMatch(normalizedSuffixCandidates);
  if (normalizedSuffixKey) {
    return { metadataId: normalizedSuffixKey, metadata: catalog[normalizedSuffixKey], method: "normalized-suffix" };
  }

  if (fallbackProvider) {
    const normalizedFallbackProvider = fallbackProvider.trim().toLowerCase();
    const fallbackKey = oneMatch(normalizedSuffixCandidates.filter((metadataId) => {
      const metadata = catalog[metadataId];
      return metadata && sourceProvider(metadataId, metadata).toLowerCase() === normalizedFallbackProvider;
    }));
    if (fallbackKey) {
      return { metadataId: fallbackKey, metadata: catalog[fallbackKey], method: "provider-fallback" };
    }
  }

  return undefined;
}

/**
 * Proxy-side variant suffixes that CLIProxyAPI appends to model IDs while
 * models.dev publishes the base model. Stripping them lets `grok-4.7-build-fast`
 * resolve to `xai/grok-4.7` and `gemini-3.6-flash-high` to
 * `google/gemini-3.6-flash`. Ordered longest-first so compound suffixes strip
 * one segment at a time.
 */
const VARIANT_SUFFIXES = [
  "-non-reasoning",
  "-reasoning",
  "-thinking",
  "-preview",
  "-medium",
  "-build",
  "-high",
  "-fast",
  "-low",
] as const;

function stripVariantSuffix(name: string): string | undefined {
  for (const suffix of VARIANT_SUFFIXES) {
    if (name.endsWith(suffix) && name.length > suffix.length) return name.slice(0, -suffix.length);
  }
  return undefined;
}

/**
 * Candidate names to try when the primary matcher fails. For each stripped
 * variant it also tries a `-preview` variant, because some proxies drop the
 * `-preview` suffix that models.dev keeps (`gemini-3-flash` vs
 * `google/gemini-3-flash-preview`).
 */
function modelNameCandidates(id: string): string[] {
  const modelName = id.split("/").at(-1) ?? id;
  const candidates: string[] = [];
  const push = (name: string) => {
    if (!candidates.includes(name)) candidates.push(name);
  };

  let current = modelName;
  while (true) {
    push(current);
    if (!current.endsWith("-preview")) push(`${current}-preview`);
    const stripped = stripVariantSuffix(current);
    if (!stripped) break;
    current = stripped;
  }
  return candidates;
}

const MODEL_NAME_PROVIDERS: ReadonlyArray<{ test: RegExp; provider: string }> = [
  { test: /^claude/, provider: "anthropic" },
  { test: /^(gemini|gemma|veo|imagen|nano-banana|lyria)/, provider: "google" },
  { test: /^(gpt-|o1|o3|o4|chatgpt|dall-e|sora|text-embedding|whisper|tts)/, provider: "openai" },
  { test: /^deepseek/, provider: "deepseek" },
  { test: /^grok/, provider: "xai" },
  { test: /^(mistral|codestral|mixtral|ministral|pixtral)/, provider: "mistral" },
  { test: /^glm/, provider: "zhipuai" },
  { test: /^qwen/, provider: "alibaba" },
  { test: /^(kimi|moonshot)/, provider: "moonshotai" },
  { test: /^(minimax|abab)/, provider: "minimax" },
  { test: /^nemotron/, provider: "nvidia" },
  { test: /^command-r/, provider: "cohere" },
];

/**
 * Infer the canonical provider from a model name. This is used only when the
 * primary matcher fails, so it cannot steal matches from the stricter,
 * owner-driven resolution; it exists to rescue proxy-renamed models whose
 * `owned_by` is missing, generic, or misleading (`deepseek-flash` reported as
 * `openai`, for example).
 */
function canonicalProviderForModelName(modelName: string): string | undefined {
  const lower = modelName.toLowerCase();
  return MODEL_NAME_PROVIDERS.find(({ test }) => test.test(lower))?.provider;
}

function matchCandidateWithInference(
  cpaModel: Pick<CpaModel, "id" | "owned_by">,
  candidate: string,
  catalog: ModelsDevCatalog,
  fallbackProvider?: string | null,
): MetadataMatch | undefined {
  if (catalog[candidate]) {
    return { metadataId: candidate, metadata: catalog[candidate], method: "exact" };
  }

  const keys = Object.keys(catalog);
  const exactMetadataCandidates = keys.filter((key) => catalog[key]?.id === candidate);
  const exactMetadataKey = oneMatch(exactMetadataCandidates);
  if (exactMetadataKey) {
    return { metadataId: exactMetadataKey, metadata: catalog[exactMetadataKey], method: "exact" };
  }

  const suffixCandidates = keys.filter(
    (key) => metadataModelName(key, catalog[key]) === candidate,
  );
  const normalizedSuffixCandidates = keys.filter(
    (key) => normalizeModelName(metadataModelName(key, catalog[key])) === normalizeModelName(candidate),
  );

  const vendor = canonicalProviderForModelName(candidate);
  if (vendor) {
    const vendorKey = `${vendor}/${candidate}`;
    if (catalog[vendorKey]) {
      return { metadataId: vendorKey, metadata: catalog[vendorKey], method: "vendor-prefix" };
    }
  }

  if (vendor) {
    const firstParty = suffixCandidates.filter((key) => sourceProvider(key, catalog[key]) === vendor);
    const firstPartyKey = oneMatch(firstParty);
    if (firstPartyKey) {
      return { metadataId: firstPartyKey, metadata: catalog[firstPartyKey], method: "vendor-first-party" };
    }
  }

  const owner = cpaModel.owned_by?.trim().toLowerCase();
  const hintedKey = ownerHintMatch(owner, normalizedSuffixCandidates, catalog, true);
  if (hintedKey) {
    return { metadataId: hintedKey, metadata: catalog[hintedKey], method: "vendor-hint" };
  }

  const suffixKey = oneMatch(suffixCandidates);
  if (suffixKey) {
    return { metadataId: suffixKey, metadata: catalog[suffixKey], method: "suffix" };
  }

  const normalizedSuffixKey = oneMatch(normalizedSuffixCandidates);
  if (normalizedSuffixKey) {
    return { metadataId: normalizedSuffixKey, metadata: catalog[normalizedSuffixKey], method: "normalized-suffix" };
  }

  if (fallbackProvider) {
    const normalizedFallbackProvider = fallbackProvider.trim().toLowerCase();
    const fallbackKey = oneMatch(normalizedSuffixCandidates.filter((metadataId) => {
      const metadata = catalog[metadataId];
      return metadata && sourceProvider(metadataId, metadata).toLowerCase() === normalizedFallbackProvider;
    }));
    if (fallbackKey) {
      return { metadataId: fallbackKey, metadata: catalog[fallbackKey], method: "provider-fallback" };
    }
  }

  return undefined;
}

/**
 * Resolve metadata when the primary matcher fails, by stripping proxy variant
 * suffixes and inferring the vendor from the model name. This is deliberately a
 * fallback: models the primary matcher resolves keep their existing, more
 * conservative match source.
 */
export function inferMetadataMatch(
  cpaModel: Pick<CpaModel, "id" | "owned_by">,
  catalog: ModelsDevCatalog,
  fallbackProvider?: string | null,
): MetadataMatch | undefined {
  for (const candidate of modelNameCandidates(cpaModel.id)) {
    const match = matchCandidateWithInference(cpaModel, candidate, catalog, fallbackProvider);
    if (match) return match;
  }
  return undefined;
}

export function resolveMetadataMatch(
  cpaModel: Pick<CpaModel, "id" | "owned_by">,
  catalog: ModelsDevCatalog,
  aliases: Record<string, string>,
  fallbackProvider?: string | null,
): MetadataMatch | undefined {
  return (
    findMetadataMatch(cpaModel, catalog, aliases, fallbackProvider)
    ?? inferMetadataMatch(cpaModel, catalog, fallbackProvider)
  );
}
