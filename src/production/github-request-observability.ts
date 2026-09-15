import type { RecordsStore } from "../storage/records-store.js";

type GitHubRequestCategory =
  | "tree"
  | "contents_read"
  | "contents_write"
  | "graphql_read"
  | "graphql_write"
  | "other";

type RequestCounts = Record<GitHubRequestCategory, number>;

export interface GitHubRateLimitSnapshot {
  limit?: number;
  remaining?: number;
  used?: number;
  reset?: number;
  resource?: string;
}

export interface GitHubRequestSnapshot {
  total: number;
  byCategory: RequestCounts;
  rateLimit?: GitHubRateLimitSnapshot;
}

export interface GitHubRequestTracker {
  fetch: typeof globalThis.fetch;
  snapshot(): GitHubRequestSnapshot;
}

function emptyCounts(): RequestCounts {
  return {
    tree: 0,
    contents_read: 0,
    contents_write: 0,
    graphql_read: 0,
    graphql_write: 0,
    other: 0,
  };
}

function graphqlMutation(body: BodyInit | null | undefined): boolean {
  if (typeof body !== "string") return false;
  try {
    const payload = JSON.parse(body) as { query?: unknown };
    return typeof payload.query === "string" && /^\s*mutation\b/.test(payload.query);
  } catch {
    return false;
  }
}

function requestCategory(
  url: URL,
  method: string,
  body?: BodyInit | null,
): GitHubRequestCategory {
  if (url.pathname.includes("/git/trees/")) return "tree";
  if (url.pathname === "/graphql" && method === "POST") {
    return graphqlMutation(body) ? "graphql_write" : "graphql_read";
  }
  if (url.pathname.includes("/contents/")) {
    if (method === "GET") return "contents_read";
    if (method === "PUT") return "contents_write";
  }
  return "other";
}

function numericHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function readRateLimit(headers: Headers): GitHubRateLimitSnapshot | undefined {
  const rateLimit: GitHubRateLimitSnapshot = {};
  const limit = numericHeader(headers, "x-ratelimit-limit");
  const remaining = numericHeader(headers, "x-ratelimit-remaining");
  const used = numericHeader(headers, "x-ratelimit-used");
  const reset = numericHeader(headers, "x-ratelimit-reset");
  const resource = headers.get("x-ratelimit-resource");
  if (limit !== undefined) rateLimit.limit = limit;
  if (remaining !== undefined) rateLimit.remaining = remaining;
  if (used !== undefined) rateLimit.used = used;
  if (reset !== undefined) rateLimit.reset = reset;
  if (resource !== null) rateLimit.resource = resource;
  return Object.keys(rateLimit).length > 0 ? rateLimit : undefined;
}

export function createGitHubRequestTracker(
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
): GitHubRequestTracker {
  let total = 0;
  const byCategory = emptyCounts();
  let rateLimit: GitHubRateLimitSnapshot | undefined;

  const trackedFetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input instanceof URL ? input : input.toString(),
    );
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    total += 1;
    byCategory[requestCategory(url, method, init?.body)] += 1;

    const response = await baseFetch(input, init);
    rateLimit = readRateLimit(response.headers) ?? rateLimit;
    return response;
  };

  return {
    fetch: trackedFetch,
    snapshot: () => ({
      total,
      byCategory: { ...byCategory },
      ...(rateLimit ? { rateLimit: { ...rateLimit } } : {}),
    }),
  };
}

function diffCounts(after: RequestCounts, before: RequestCounts): RequestCounts {
  return {
    tree: after.tree - before.tree,
    contents_read: after.contents_read - before.contents_read,
    contents_write: after.contents_write - before.contents_write,
    graphql_read: after.graphql_read - before.graphql_read,
    graphql_write: after.graphql_write - before.graphql_write,
    other: after.other - before.other,
  };
}

function observedStoreMethod<T>(
  operation: string,
  tracker: GitHubRequestTracker,
  action: () => Promise<T>,
): Promise<T> {
  const before = tracker.snapshot();
  let outcome: "success" | "error" = "success";
  return action()
    .catch((error) => {
      outcome = "error";
      throw error;
    })
    .finally(() => {
      const after = tracker.snapshot();
      const requests = after.total - before.total;
      console.info(
        "[capture-reflect][github-api]",
        JSON.stringify({
          operation,
          outcome,
          requests,
          byCategory: diffCounts(after.byCategory, before.byCategory),
          ...(requests > 0 && after.rateLimit ? { rateLimit: after.rateLimit } : {}),
        }),
      );
    });
}

export function withGitHubRequestObservability(
  store: RecordsStore,
  tracker: GitHubRequestTracker,
): RecordsStore {
  return {
    captureJournal: (input) =>
      observedStoreMethod("capture_journal", tracker, () => store.captureJournal(input)),
    captureNote: (input) =>
      observedStoreMethod("capture_note", tracker, () => store.captureNote(input)),
    saveReview: (input) =>
      observedStoreMethod("save_review", tracker, () => store.saveReview(input)),
    getRecords: (input) =>
      observedStoreMethod("get_records_by_date_range", tracker, () => store.getRecords(input)),
    searchRecords: (input) =>
      observedStoreMethod("search_records", tracker, () => store.searchRecords(input)),
  };
}
