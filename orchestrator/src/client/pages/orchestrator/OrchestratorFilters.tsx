import type React from "react";
import { Tabs } from "@/components/ui/tabs";
import type { FilterTab } from "./constants";
import { OrchestratorFilterBar } from "./filters/OrchestratorFilterBar";
import { OrchestratorTabRow } from "./filters/OrchestratorTabRow";
import type { OrchestratorFiltersProps } from "./filters/types";
import { useFilterBarDerivedState } from "./filters/useFilterBarDerivedState";

export type { OrchestratorFiltersProps } from "./filters/types";

export const OrchestratorFilters: React.FC<OrchestratorFiltersProps> = (props) => {
  const { activeTab, onTabChange, counts, onOpenCommandBar } = props;
  const derived = useFilterBarDerivedState(props);

  return (
    <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as FilterTab)}>
      <div className="space-y-2.5">
        <OrchestratorTabRow counts={counts} onOpenCommandBar={onOpenCommandBar} />
        <OrchestratorFilterBar {...props} {...derived} />
      </div>
    </Tabs>
  );
};
