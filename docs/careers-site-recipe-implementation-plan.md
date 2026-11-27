# Custom careers-site recipes

> **Status: implemented (first release).** Shipped as designed with these deliberate differences:
>
> - **v2 only when needed.** A recipe is written as version 2 only when it has a verified `search` or detail `fields`; everything else stays version 1, so an older container can still read it.
> - **Deterministic search learning.** Search controls come from the static facet parser plus GET form inputs and are verified by loading the listing (no LLM). The LLM only proposes selector/label rules for optional fields; code seeds JobPosting rules and prunes every rule that does not produce a value on sampled postings.
> - **Identity.** Ignored/imported state is matched on the host key (the per-query digest is stripped at lookup time). Nothing is rewritten in storage, and unignore clears every filter of the host.
> - **Not in this release:** discovering multi-value free text from a board (the contract and builder support it), click/POST/infinite-scroll search, a learned `render` for rendered JSON-LD beyond what the learner observes, and a per-listing recipe key (controls are offered only on the listing path they were learned on).

## Outcome and scope

When a user changes a keyword or location on a custom careers board, the next refresh should run the saved search with those values, follow subsequent pages, identify each posting, and prefill supported job fields. Learning may use the LLM. Refreshing a verified recipe should require zero model calls. The existing Suggest Filters action may still use a model when the user requests suggestions.

The first release covers public HTTPS GET listings, including pages that need Chromium to render. Support page numbers and offsets encoded in the query string. Click-driven pagination, POST-backed searches, and infinite scrolling require additional browser actions beyond this release. A board can support unfiltered discovery even when its filter controls cannot be verified.

## Audit of the current implementation

| Area | Current behavior and consequence |
|---|---|
| Learning | `learnRecipe` in `watchlist/careers-site/learn.ts` can return immediately after verifying a sitemap and JobPosting data. This can skip the listing evidence needed to learn search controls. Its model-assisted path already collects bounded evidence, validates patterns and selectors, checks pagination, and tests a candidate recipe. |
| Search updates | `watchlist/autofilter/facets/careers-site.ts` reads static links, selects and FacetWP metadata. Its fallback count covers recognizable links on one page. `autofilter/suggest.ts` chooses values and builds a URL with repeated keys. The current generic facet discoverer does not advertise a free-text keyword input. Its own comments identify comma-delimited multiselects as a limitation. The existing selection update already saves a careers URL. |
| Listing and identity | The v1 schema in `careers-site/types.ts` models a sitemap **or** a page. `run-recipe.ts` already supports query pagination, a job URL pattern, an optional ID capture, URL fallback and deduplication. A filtered URL takes the HTML listing branch even for a sitemap recipe. That branch re-detects pagination on page one. A sitemap recipe supplies no listing rendering settings for that branch. |
| Detail extraction | `extractJob` reads JobPosting JSON-LD/microdata or CSS selectors. The runner renders details only for selector mode. Title and description are required. The generic adapter maps a small subset into the import draft. The downstream manual import and pipeline mapping already accept salary, deadline, job type and level. |
| Storage and isolation | `repositories/site-recipes.ts` upserts public recipes by hostname. Selected sources and saved results have user and tenant scope. The generic adapter’s process cache and source identity use the host and query. The shared filter-plan repository looks up suggestions by URL key and intent hash. These boundaries matter for different listings on one host and for private keywords. |
| Deployment | Cloudflare AppStore forwards learn/run calls to the scraper container. `api/routes/internal-careers-site.ts` validates incoming recipes, and the Node runner returns jobs to AppStore. Both sides must understand the recipe and extracted fields. |

Source paths in this audit are relative to `orchestrator/src/server/` unless otherwise indicated.

## High-level TypeScript

These sketches illustrate the proposed interfaces and call flow. Helper names below describe new or adapted code. Existing v1 recipes keep their current interpreter.

```ts
type SearchParam = {
  key: string;
  input: { kind: "text" } | { kind: "choice"; values: string[] };
  encoding: "single" | "repeat" | "comma";
};

type SearchListing = {
  url: string;
  params: SearchParam[];
  pagination: PageListing["pagination"];
  maxPages: number;
  render: boolean;
  waitFor?: string;
};

type ExtraField = "salary" | "deadline" | "jobType" | "jobLevel";
type FieldRule =
  | { kind: "selector"; selector: string; attribute?: string }
  | { kind: "label"; container: string; label: string }
  | { kind: "jobPosting"; property: "baseSalary" | "validThrough" | "employmentType" };

type PageListing = Extract<Recipe["listing"], { kind: "page" }>;
type RecipeV2 = Omit<Recipe, "version" | "detail"> & {
  version: 2;
  search?: SearchListing;
  detail: {
    load: { render: boolean; waitFor?: string };
    extract: DetailExtraction; // Existing JSON-LD or CSS rules, with loading handled above.
    fields?: Partial<Record<ExtraField, FieldRule>>;
  };
};
```

**Learn once per public listing.** Extend `learnRecipe` so a verified sitemap can serve discovery while the learner also inspects the original careers listing for search controls. Persist public rules after verification. Sample keywords used for verification come from the public board.

```ts
const discovery = await verifyDiscovery(publicListing, signal);
const evidence = await collectPublicEvidence(publicListing, discovery, signal);
const candidate = await proposeRecipe(evidence, discovery, signal);
const recipe = await verifyCapabilities(candidate, evidence, signal);
await saveVerifiedRecipe(publicListing.key, recipe);
```

**Apply the user's filters on Save.** Extend the existing selection update with server-side validation. The builder starts from the verified listing URL, removes managed filter and pager keys, validates each value against the verified control, and encodes it with the site's observed convention. Saving an empty set restores unfiltered discovery. Read tenant and user scope from the authenticated request.

```ts
const recipe = await loadPublicRecipe(selection.publicListingKey);
const careersUrl = hasFilterValues(input.filters)
  ? buildFilteredUrl(requireVerifiedSearch(recipe), input.filters)
  : selection.unfilteredCareersUrl;
await updateScopedSelection(scope, selection.id, { careersUrl });
```

**Run on refresh.** Adapt `runRecipe` to select the sitemap or page iterator. The page iterator carries filters forward and mutates only the pagination parameter. The runner owns timeouts, deduplication, cache reuse, and the job limit. Chromium runs inside the existing page loader when a detail needs rendering.

```ts
const listing = resolveListingForSelection(recipe, selectedCareersUrl);
for await (const url of discoverJobUrls(listing, recipe.jobUrlPattern, budget)) {
  const id = jobId(url, recipe) ?? url;
  if (seenIds.has(id)) continue;
  const page = await loadAllowedPage(url, recipe.detail.load, budget);
  const job = extractCoreJob(page.html, url, id, recipe.detail.extract);
  if (!job) continue;
  seenIds.add(id);
  jobs.push({ ...job, ...extractVerifiedFields(page.html, recipe.detail.fields) });
  if (jobs.length >= limit) break;
}
```

**Carry the result into the import draft.** Extend the existing `CrawledJob` type and the generic adapter. Populate only the recognized optional fields. The existing manual import and pipeline consumers already accept these names.

```ts
const draft: ManualJobDraft = {
  ...existingDraft,
  salary: job.salary,
  deadline: job.deadline,
  jobType: job.jobType,
  jobLevel: job.jobLevel,
};
```

## Implementation sequence

### 1. Define a backward-compatible contract

Add a v2 branch to the existing recipe schema. Keep v1 parsing and execution covered by the supplied Airbnb recipe. Preserve the existing discovery rule and job identity fields. Add an optional searchable listing with a verified base URL, public parameter definitions, encoding, pagination, render flag and optional wait selector. Allow keyword text and enumerated choices with site values distinct from display labels. Separate detail rendering from extraction mode and permit an optional detail wait selector.

Use the existing job field names. Start with salary, deadline, jobType and jobLevel in addition to the existing fields. Support bounded CSS text/attribute extraction and known JobPosting properties such as validThrough and employmentType. Define salary formatting for currency, range and pay interval. For labeled description sections, support an observed label and bounded adjacent value. Leave ambiguous or missing values empty. A missing optional field must not discard a valid posting.

### 2. Learn and verify each capability

Reuse the static facet parser and existing page loader. Collect evidence from the canonical public listing even when a sitemap succeeds. Inspect public GET forms, input names, option values, pagination links and representative detail pages. Use the existing rendering fallback when static evidence is insufficient. Send bounded public evidence to the learner and exclude user search terms, profile data, cookies and credentials from prompt content and saved recipes.

Verify the candidate using the existing constrained fetcher. Compare an unfiltered baseline with an observed sample filter using returned posting IDs or reliable board totals. Reject a parameter that the site silently ignores. A first-page estimate alone is insufficient to prove total coverage. Verify a second page with different IDs while retaining the filter, and verify an ID capture across distinct postings. Check optional detail values against their source nodes or structured properties on multiple postings when available. Keep verified capabilities independently so a failed salary or pagination rule still permits valid discovery.

### 3. Connect filters to the existing update flow

Expose verified controls in the custom-source editor. Reuse the existing draft, Save, selection update and refresh paths. Build the effective URL on the server using observed keys and encodings. Replace previous values for edited controls, remove cleared filters, reset pagination and preserve required fixed query parameters. Store the resulting selection under the current tenant and user. Verify a direct edit never calls Suggest Filters or the LLM.

Share the URL builder between direct edits and optional suggestions. Keep learned public controls separate from personalized suggestions. Namespace private suggestion caches by tenant and user or bypass the shared cache for private inputs. Separate workspace-scoped result caches from public extraction rules. Account for distinct listing paths on one hostname when choosing the public recipe key. If a listing key is added, migrate with a host-key fallback only where the existing recipe matches the listing.

### 4. Execute the recipe and preserve job identity

For a filtered refresh, use the verified searchable listing and preserve its filters on every page. For an unfiltered refresh, keep the verified sitemap or page discovery route. Reuse existing URL checks, robots handling, timeouts, concurrency limits and Chromium transport. Stop at the configured budget, a repeated page, or a page with no new IDs. Preserve a legitimate zero-result search without triggering host relearning.

Use the same identity extraction for listing and detail URLs. Audit the existing query-dependent source key before changing it. Keep per-selection caches distinct, while matching an existing posting across keyword changes. Cover existing ignored, seen and imported records before switching identity keys. Include the recipe’s extraction configuration in detail-cache invalidation.

### 5. Carry detail fields through both import paths

Extend `CrawledJob`, the container response validation where applicable, the generic adapter’s cached job and `prepareImportDraft`. Reuse the existing manual review and pipeline mappings. Keep the original description available for review. Fetch detail pages with the render and wait policy specified by the recipe, including rendered JSON-LD. Optional fields may remain absent in v1 jobs and cached results.

### 6. Roll out and verify

Deploy readers that accept both versions to the container and AppStore before enabling v2 writes. Keep a working v1 recipe usable while learning a replacement. Deduplicate concurrent learning for the same public listing, then replace the stored recipe only after verification. Allow an existing healthy v1 site to upgrade on an explicit rescan without waiting for three failed crawls. Update the watchlist feature docs with supported controls, partial support and the rescan flow.

| Acceptance case | Expected result |
|---|---|
| Existing Airbnb v1 fixture | Sitemap discovery, numeric ID and current selectors still work. A search endpoint or salary rule is added only if independently verified. |
| Filtered board with two pages | Changing a keyword and clearing location produces the expected URL on page one. Page two retains the keyword and returns fresh IDs. A second edit reuses the same recipe with zero refresh-time LLM calls. |
| Same job appears under two filters | The workspace still recognizes an existing import. An ignored job keeps the expected state. Filtered result caches remain independent. |
| Detail variants | Static selectors, rendered selectors and rendered JSON-LD produce expected values. Absent pay, multiple currencies, missing dates and ambiguous levels never produce invented values. Manual review and pipeline discovery receive the same fields. |
| Tenant and deployment parity | Two users can share public rules while seeing only their own filter values and results. Local and container execution agree on fixtures. A rejected upgrade, stale cache, or older container leaves the verified v1 path recoverable. |

Run the focused learner, runner, adapter, autofilter, repository, UI, pipeline and Cloudflare route tests first. Then run the repository’s five CI checks on Node 22 in order: `vp check`, `npm run check:types:shared`, `npm --workspace orchestrator run check:types`, `npm --workspace orchestrator run build:client`, and `npm --workspace orchestrator run test:run`. Also run the Cloudflare workspace type and test scripts for the changed remote contract.

## Compatibility with the dedicated parsers

Reviewed against the Google, Lever, Greenhouse, Eightfold, Oracle, Amazon, Apple, SmartRecruiters, Workday, Ashby and BambooHR adapters. Dedicated parsers keep their own extraction; the recipe is compatible where the two meet: the filter URL, the paging parameter, the job identity and the import draft.

| Area | What the parsers do | Recipe status |
|---|---|---|
| Multi-value filters | Repeated keys (Lever, Google, Eightfold); comma-joined (Greenhouse departments/offices); one value (Oracle) | `repeat`, `comma`, `single` encodings. Test drives each parser's own URL normalizer and reads the values back (`search-compat.test.ts`). Greenhouse rewrites repeated keys, so its controls must be `single`, as its facets already are |
| Free text | Google `q` and multi-value `location`; Eightfold `query`; Oracle `keyword` | Text controls, now with `multiple` for Google-style locations |
| Values with commas | Lever locations such as "San Francisco, CA" | The schema rejects comma encoding for any value containing a comma; the builder does too |
| Pager | `page` (Apple), `offset` (Amazon, SmartRecruiters), `start` (Eightfold); Oracle pages inside a finder parameter | The learner, which verifies page two, now also recognizes `start`, `from`, `pg` and `pageNumber`. Unverified detection keeps the narrow list. Oracle's in-parameter paging is not expressible |
| Detail fields | Only `jobType` is ever set (Ashby, BambooHR, Lever, Oracle, Workday); none set salary, deadline or level | Recipe fields are a strict superset of the same `ManualJobDraft` shape |
| Job identity | API ids (`positionId`, `id_icims`, `externalId`) | Recipes derive ids from the URL, so state is keyed separately; imported postings still match by URL |
| Extraction | Embedded JSON, vendor APIs | Not expressible in a recipe (Google's `AF_initDataCallback` is the example). Dedicated parsers stay |

### Suggest Filters and learned controls

`WatchlistCatalogSourceAdapter.discoverSearchFacets` is an optional hook. The careers-site adapter implements it from the verified recipe (`facetParamsFromSearch`): text controls become `freeText` keys, repeat-encoded choices become multi, comma-encoded choices stay single because the suggestion URL repeats keys. `suggestFilters` merges the result into the facets at read time, after the shared facet cache copy is taken, and a scraped facet wins on a shared key. A failed lookup only means fewer suggestions. `suggest.ts` still never imports the recipe store.
