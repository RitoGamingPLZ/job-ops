import { createJob } from "@shared/testing/factories.js";
import type { WatchlistJobResult, WatchlistSelectedSource } from "@shared/types.js";
import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WatchlistJobRow from "./WatchlistJobRow";

const source: WatchlistSelectedSource = {
  id: "bamboohr",
  catalogSourceId: null,
  label: "Example",
  careersUrl: "https://example.bamboohr.com/careers",
  cxsJobsUrl: null,
  sourceType: "bamboohr",
  isCustom: true,
  sortOrder: 0,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

function renderPostedDate(postedAt: string | null) {
  const watchlistJob: WatchlistJobResult = {
    jobRef: "https://example.bamboohr.com/careers/1",
    source: "bamboohr:example",
    sourceJobId: "1",
    sourceType: "bamboohr",
    title: "Engineer",
    employer: "Example",
    jobUrl: "https://example.bamboohr.com/careers/1",
    applicationLink: null,
    location: null,
    postedAt,
    rowState: "new",
    isNewSinceLastCheck: false,
    workspaceJob: null,
  };
  render(
    <table>
      <tbody>
        <WatchlistJobRow
          rankedJob={{
            watchlistJob,
            job: createJob({ title: "Engineer" }),
            matchScore: 0,
            matchedSearchTerm: null,
            locationPriority: 0,
            locationMatched: false,
            rowState: "new",
          }}
          source={source}
          movingJobRef={null}
          ignorePending={false}
          unignorePending={false}
          onIgnore={vi.fn()}
          onUnignore={vi.fn()}
          onMoveToWorkspace={vi.fn()}
          onOpenWorkspaceJob={vi.fn()}
          onLoadJobDetails={vi.fn()}
        />
      </tbody>
    </table>,
  );
}

describe("WatchlistJobRow posted date labels", () => {
  const previousTimezone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "America/Toronto";
  });
  afterAll(() => {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  });

  it("preserves the calendar day of date-only adapter values", () => {
    renderPostedDate("2025-01-01");
    expect(
      screen.getByText(
        new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(2025, 0, 1)),
      ),
    ).toBeInTheDocument();
  });

  it("continues to display full timestamps in local time", () => {
    renderPostedDate("2025-01-01T00:00:00Z");
    expect(
      screen.getByText(
        new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(2024, 11, 31)),
      ),
    ).toBeInTheDocument();
  });

  it.each([null, "not-a-date"])("handles missing or invalid dates (%s)", (value) => {
    renderPostedDate(value);
    expect(screen.getByText(value ?? "—")).toBeInTheDocument();
  });
});
