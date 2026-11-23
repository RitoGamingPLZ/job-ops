import type React from "react";

export type OrchestratorFilterBarProps = {
  children: React.ReactNode;
};

export const OrchestratorFilterBar: React.FC<OrchestratorFilterBarProps> = ({ children }) => (
  <div id="orchestrator-filter-bar" className="flex flex-col gap-2.5 [&>*]:w-full">
    {children}
  </div>
);
