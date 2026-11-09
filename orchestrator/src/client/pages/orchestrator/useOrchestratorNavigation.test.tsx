import { render, screen, waitFor } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { describe, expect, it } from "vitest";
import { useOrchestratorNavigation } from "./useOrchestratorNavigation";

function Probe() {
  const [searchParams] = useSearchParams();
  const navigation = useOrchestratorNavigation({ searchParams });
  const location = useLocation();
  return (
    <div data-testid="navigation">
      {navigation.activeTab}:{location.pathname}
      {location.search}
    </div>
  );
}

describe("Search Jobs navigation", () => {
  it.each([
    ["/jobs/ready", "/jobs/discovered"],
    ["/jobs/ready/job-1?source=google", "/jobs/discovered/job-1?source=google"],
    ["/jobs/unknown", "/jobs/discovered"],
  ])("redirects %s to %s", async (from, to) => {
    render(
      <MemoryRouter initialEntries={[from]}>
        <Routes>
          <Route path="/jobs/:tab/:jobId?" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("navigation")).toHaveTextContent(
        `discovered:${to}`,
      ),
    );
  });
});
