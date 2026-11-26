import type { Story } from "@ladle/react";
import { Building2 } from "lucide-react";
import { useState } from "react";
import { FilterPillTrigger } from "@/client/pages/orchestrator/filters/FilterPill";
import { MultiCombobox, type MultiComboboxOption } from "./multi-combobox";

const SKILL_OPTIONS: MultiComboboxOption[] = [
  { value: "TypeScript", label: "TypeScript" },
  { value: "React", label: "React" },
  { value: "Node.js", label: "Node.js" },
  { value: "PostgreSQL", label: "PostgreSQL" },
  { value: "GraphQL", label: "GraphQL" },
  { value: "Docker", label: "Docker" },
];

const COMPANY_OPTIONS: MultiComboboxOption[] = [
  { value: "stripe", label: "Stripe", meta: 12 },
  { value: "linear", label: "Linear", meta: 7 },
  { value: "vercel", label: "Vercel", meta: 5 },
  { value: "anthropic", label: "Anthropic", meta: 4 },
  { value: "figma", label: "Figma", meta: 2 },
];

export const InlineTagsAndSkills: Story = () => {
  const [skills, setSkills] = useState<string[]>(["TypeScript", "React"]);

  return (
    <div className="mx-auto max-w-md space-y-3 rounded-xl border border-border bg-card p-5 text-card-foreground">
      <div className="space-y-1.5">
        <label htmlFor="story-inline-skills" className="text-sm font-medium">
          Skills
        </label>
        <MultiCombobox
          id="story-inline-skills"
          variant="inline"
          noun="skill"
          allowCustomValues
          value={skills}
          options={SKILL_OPTIONS}
          placeholder="Add skill…"
          onValueChange={setSkills}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Type to filter suggestions, press Enter or comma to add custom values, or toggle rows in the
        dropdown.
      </p>
    </div>
  );
};
InlineTagsAndSkills.storyName = "Inline (tags & skills)";

export const PopoverCompanyFilter: Story = () => {
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>(["stripe", "linear"]);

  return (
    <div className="mx-auto flex max-w-md items-center justify-between rounded-xl border border-border bg-card p-5 text-card-foreground">
      <div>
        <p className="text-sm font-medium">Filter bar pill</p>
        <p className="text-xs text-muted-foreground">
          {selectedCompanies.length === 0
            ? "All companies"
            : `${selectedCompanies.length} selected`}
        </p>
      </div>
      <MultiCombobox
        variant="popover"
        noun="company"
        value={selectedCompanies}
        options={COMPANY_OPTIONS}
        onValueChange={setSelectedCompanies}
        trigger={
          <FilterPillTrigger
            icon={<Building2 />}
            label="Company"
            active={selectedCompanies.length > 0}
            badge={selectedCompanies.length}
          />
        }
        popoverTitle="Company"
        clearLabel="All companies"
        searchPlaceholder="Search companies..."
        inputAriaLabel="Search companies"
        listAriaLabel="Companies"
        emptyText="No companies found"
        showSelectedChips
        contentClassName="w-72"
      />
    </div>
  );
};
PopoverCompanyFilter.storyName = "Popover (company filter)";

export const Disabled: Story = () => (
  <div className="mx-auto max-w-md space-y-4 rounded-xl border border-border bg-card p-5 text-card-foreground">
    <MultiCombobox
      variant="inline"
      noun="tag"
      disabled
      value={["Backend", "Distributed Systems"]}
      options={SKILL_OPTIONS}
      onValueChange={() => {}}
    />
  </div>
);
Disabled.storyName = "Disabled";
