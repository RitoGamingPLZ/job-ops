export interface FilterIntent {
  titles: string[];
  country: string;
  cities: string[];
  workplaceTypes: ("remote" | "hybrid" | "onsite")[];
}

export interface Facets {
  unfilteredTotal: number;
  /** Count the built filtered listing using the same method as unfilteredTotal. */
  countFiltered?: (input: {
    careersUrl: string;
    signal?: AbortSignal;
  }) => Promise<number>;
  params: Array<{
    key: string;
    multi: boolean;
    values?: Array<{ value: string; count?: number }>;
    freeText?: true;
  }>;
}

export type FacetDiscovery = (input: {
  careersUrl: string;
  signal?: AbortSignal;
}) => Promise<Facets>;

export interface FilterParam {
  key: string;
  values: string[];
}

export interface Suggestion {
  suggestedUrl: string;
  params: FilterParam[];
  rationale: string;
  totals: { filtered: number; unfiltered: number };
  sampleTitles: string[];
}
