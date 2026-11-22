import type { JobSource } from "@shared/types.js";
import { Globe } from "lucide-react";
import type React from "react";
import { sourceLabel } from "@/lib/utils";
import { orderedFilterSources } from "../constants";
import {
  type SingleSelectFilterOption,
  SingleSelectFilterPill,
} from "./SingleSelectFilterPill";
import type { SourceFilterPillProps } from "./types";

export const SourceFilterPill: React.FC<SourceFilterPillProps> = ({
  sourceFilter,
  onSourceFilterChange,
  sourcesWithJobs,
}) => {
  const options: Array<SingleSelectFilterOption<JobSource | "all">> = [
    { value: "all", label: "All sources" },
    ...orderedFilterSources
      .filter((source) => sourcesWithJobs.includes(source))
      .map((source) => ({
        value: source,
        label: sourceLabel[source] ?? source,
      })),
  ];

  return (
    <SingleSelectFilterPill
      icon={<Globe />}
      label="Source"
      active={sourceFilter !== "all"}
      summary={
        sourceFilter === "all"
          ? null
          : (sourceLabel[sourceFilter] ?? sourceFilter)
      }
      value={sourceFilter}
      options={options}
      onChange={onSourceFilterChange}
      contentClassName="w-72"
    />
  );
};
