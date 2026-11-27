import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "intro",
    {
      type: "category",
      label: "Getting Started",
      items: [
        "getting-started/self-hosting",
        "getting-started/gmail-oauth-setup",
        "getting-started/sso-setup",
      ],
    },
    {
      type: "category",
      label: "Workflows",
      items: [
        "workflows/find-jobs-and-apply-workflow",
        "workflows/post-application-workflow",
        "workflows/add-an-extractor",
      ],
    },
    {
      type: "category",
      label: "Core Features",
      items: [
        "features/overview",
        "features/pipeline-run",
        "features/job-search-bar",
        "features/keyboard-shortcuts",
        "features/multi-select-and-bulk-actions",
        "features/orchestrator",
        "features/settings",
        "features/design-resume",
        "features/resume-pdf",
        "features/in-progress-board",
        "features/ghostwriter",
        "features/post-application-tracking",
        "features/watchlist",
      ],
    },
    {
      type: "category",
      label: "Extractors",
      items: [
        "extractors/overview",
        "extractors/jobspy",
        "extractors/adzuna",
        "extractors/hiring-cafe",
        "extractors/jobindex",
        "extractors/freehire",
        "extractors/manual",
      ],
    },
    {
      type: "category",
      label: "Self-Hosting & Ops",
      items: [
        "getting-started/self-hosting",
        "getting-started/gmail-oauth-setup",
        "getting-started/sso-setup",
        "getting-started/database-backups",
        "troubleshooting/common-problems",
      ],
    },
    {
      type: "category",
      label: "Troubleshooting",
      items: ["troubleshooting/common-problems"],
    },
    {
      type: "category",
      label: "Reference / FAQ",
      items: ["reference/faq", "reference/documentation-style-guide"],
    },
  ],
};

export default sidebars;
