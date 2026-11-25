import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  type SectionWorkspaceGroup,
  sectionWorkspaceItemMatchesSearch,
  SectionWorkspaceNav,
  SectionWorkspacePanel,
} from "./SectionWorkspace";

type GroupId = "account" | "automation";
type SectionId = "profile" | "models" | "webhooks";

const GROUPS: SectionWorkspaceGroup<GroupId, SectionId>[] = [
  {
    id: "account",
    label: "Account",
    items: [
      {
        id: "profile",
        label: "Profile & Resume",
        description: "Manage personal fields",
        searchTerms: ["resume"],
      },
      {
        id: "models",
        label: "AI Models",
        description: "Configure providers and keys",
        searchTerms: ["openai", "anthropic"],
      },
    ],
  },
  {
    id: "automation",
    label: "Automation",
    items: [
      {
        id: "webhooks",
        label: "Webhooks",
        description: "Callback endpoints",
        searchTerms: ["hmac"],
      },
    ],
  },
];

describe("SectionWorkspace", () => {
  it("sets aria-current on the active nav button and filters sections cleanly", async () => {
    const user = userEvent.setup();
    const onSectionSelect = vi.fn();
    const onSearchValueChange = vi.fn();

    const { rerender } = render(
      <div>
        <SectionWorkspaceNav
          groups={GROUPS}
          activeSectionId="profile"
          openGroupIds={["account", "automation"]}
          onOpenGroupIdsChange={vi.fn()}
          onSectionSelect={onSectionSelect}
          searchValue=""
          onSearchValueChange={onSearchValueChange}
          searchPlaceholder="Filter sections"
          searchEmptyLabel="No matching sections"
          getItemBadge={(id) =>
            id === "models" ? { label: "Unsaved", variant: "secondary" } : null
          }
        />
        <SectionWorkspacePanel
          groupLabel="Account"
          sectionLabel="Profile & Resume"
          sectionDescription="Manage personal fields"
          badge={{ label: "Unsaved", variant: "secondary" }}
          actions={<button type="button">Save</button>}
        >
          <div>Panel body</div>
        </SectionWorkspacePanel>
      </div>,
    );

    const profileBtn = screen.getByRole("button", { name: "Profile & Resume" });
    const modelsBtn = screen.getByRole("button", { name: /AI Models/ });
    expect(profileBtn).toHaveAttribute("aria-current", "page");
    expect(modelsBtn).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Panel body")).toBeInTheDocument();

    await user.click(modelsBtn);
    expect(onSectionSelect).toHaveBeenCalledWith("models");

    expect(sectionWorkspaceItemMatchesSearch("openai", GROUPS[0].items[1])).toBe(true);
    expect(sectionWorkspaceItemMatchesSearch("nomatch", GROUPS[0].items[1])).toBe(false);

    rerender(
      <SectionWorkspaceNav
        groups={[]}
        activeSectionId="profile"
        openGroupIds={["account", "automation"]}
        onOpenGroupIdsChange={vi.fn()}
        onSectionSelect={onSectionSelect}
        searchValue="nomatch"
        onSearchValueChange={onSearchValueChange}
        searchPlaceholder="Filter sections"
        searchEmptyLabel="No matching sections"
      />,
    );
    expect(screen.getByText(/No matching sections/)).toBeInTheDocument();
  });
});
