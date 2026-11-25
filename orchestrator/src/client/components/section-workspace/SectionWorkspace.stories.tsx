import type { Story } from "@ladle/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type SectionWorkspaceBadge,
  type SectionWorkspaceGroup,
  SectionWorkspaceNav,
  SectionWorkspacePanel,
} from "./SectionWorkspace";

type GroupId = "account" | "automation";
type SectionId = "profile" | "models" | "pipeline" | "webhooks";

const GROUPS: SectionWorkspaceGroup<GroupId, SectionId>[] = [
  {
    id: "account",
    label: "Account & AI",
    items: [
      {
        id: "profile",
        label: "Profile & Resume",
        description: "Manage personal contact fields, target roles, and base CV content.",
        searchTerms: ["resume", "cv", "contact"],
      },
      {
        id: "models",
        label: "AI Models",
        description: "Configure default model providers, API keys, and purpose overrides.",
        searchTerms: ["openai", "anthropic", "gemini", "api key"],
      },
    ],
  },
  {
    id: "automation",
    label: "Pipeline & Delivery",
    items: [
      {
        id: "pipeline",
        label: "Pipeline Cadence",
        description: "Tune discovery concurrency, scoring thresholds, and daily schedules.",
        searchTerms: ["schedule", "scoring"],
      },
      {
        id: "webhooks",
        label: "Webhooks",
        description: "Send signed job event callbacks to external endpoints.",
        searchTerms: ["hmac", "secret", "callbacks"],
      },
    ],
  },
];

export const Interactive: Story = () => {
  const [activeSectionId, setActiveSectionId] = useState<SectionId>("profile");
  const [openGroupIds, setOpenGroupIds] = useState<GroupId[]>(["account", "automation"]);
  const [searchValue, setSearchValue] = useState("");
  const [dirtySectionIds, setDirtySectionIds] = useState<SectionId[]>(["models"]);

  const activeGroup =
    GROUPS.find((group) => group.items.some((item) => item.id === activeSectionId)) ?? GROUPS[0]!;
  const activeItem =
    activeGroup.items.find((item) => item.id === activeSectionId) ?? activeGroup.items[0]!;
  const isDirty = dirtySectionIds.includes(activeSectionId);

  const getItemBadge = (sectionId: SectionId): SectionWorkspaceBadge | null =>
    dirtySectionIds.includes(sectionId) ? { label: "Unsaved", variant: "secondary" } : null;

  const toggleDirty = () => {
    setDirtySectionIds((current) =>
      current.includes(activeSectionId)
        ? current.filter((id) => id !== activeSectionId)
        : [...current, activeSectionId],
    );
  };

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <SectionWorkspaceNav
        groups={GROUPS}
        activeSectionId={activeSectionId}
        openGroupIds={openGroupIds}
        onOpenGroupIdsChange={setOpenGroupIds}
        onSectionSelect={setActiveSectionId}
        searchValue={searchValue}
        onSearchValueChange={setSearchValue}
        searchPlaceholder="Filter sections"
        searchEmptyLabel="No matching settings sections."
        getItemBadge={getItemBadge}
      />

      <SectionWorkspacePanel
        groupLabel={activeGroup.label}
        sectionLabel={activeItem.label}
        sectionDescription={activeItem.description}
        badge={isDirty ? { label: "Unsaved", variant: "secondary" } : null}
        secondaryBadge={{ label: "Workspace", variant: "outline" }}
        actions={
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={toggleDirty}
              className="min-w-[10.5rem]"
            >
              {isDirty ? "Clear unsaved state" : "Mark section dirty"}
            </Button>
            <Button type="button" size="sm" disabled={!isDirty}>
              Save section
            </Button>
          </>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Viewing section: <strong className="text-foreground">{activeItem.label}</strong>
            </span>
            <span>Changes stay scoped to your workspace.</span>
          </div>
        }
      >
        <div className="space-y-4 rounded-xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
          <p>
            Switching between navigation items or toggling the unsaved badge should keep button
            widths, borders, and panel chrome visually steady on both mobile and desktop.
          </p>
          <p>
            Active section ID: <code className="text-foreground">{activeSectionId}</code>
          </p>
        </div>
      </SectionWorkspacePanel>
    </div>
  );
};
Interactive.storyName = "Interactive";
