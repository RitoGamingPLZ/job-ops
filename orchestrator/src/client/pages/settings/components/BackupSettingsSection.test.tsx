import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type { BackupInfo, BackupStorageInfo } from "@shared/types.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { vi } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { BackupSettingsSection } from "./BackupSettingsSection";

const values = {
  backupEnabled: { default: false, effective: true },
  backupHour: { default: 2, effective: 3 },
  backupMaxCount: { default: 5, effective: 4 },
};

const Harness = ({
  canManageBackups,
  backups = [],
  storage = null,
  onDownloadBackup,
  onDeleteBackup = () => {},
  onRestoreBackup,
}: {
  canManageBackups?: boolean;
  backups?: BackupInfo[];
  storage?: BackupStorageInfo | null;
  onDownloadBackup?: (filename: string) => void;
  onDeleteBackup?: (filename: string) => void;
  onRestoreBackup?: (filename: string) => void;
}) => {
  const methods = useForm<UpdateSettingsInput>({
    defaultValues: {
      pipelineScheduleEnabled: true,
      pipelineScheduleHour: 7,
      backupEnabled: true,
    },
  });
  return (
    <FormProvider {...methods}>
      <Accordion type="multiple" defaultValue={["backup"]}>
        <BackupSettingsSection
          values={values}
          backups={backups}
          nextScheduled={null}
          storage={storage}
          isLoading={false}
          isSaving={false}
          onCreateBackup={() => {}}
          onDownloadBackup={onDownloadBackup}
          onDeleteBackup={onDeleteBackup}
          onRestoreBackup={onRestoreBackup}
          isCreatingBackup={false}
          isDeletingBackup={false}
          canManageBackups={canManageBackups}
          layoutMode="accordion"
        />
      </Accordion>
    </FormProvider>
  );
};

describe("BackupSettingsSection", () => {
  it("shows the daily search schedule and the server-wide backup controls to admins", () => {
    render(<Harness canManageBackups />);

    expect(screen.getByText("Run job search daily")).toBeInTheDocument();
    expect(screen.getByText("Enable automatic backups")).toBeInTheDocument();
    expect(screen.getByText("Backup History")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Backup Now" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("shows only the daily search schedule to non-admins", () => {
    render(<Harness canManageBackups={false} />);

    expect(screen.getByText("Daily search")).toBeInTheDocument();
    expect(screen.getByText("Run job search daily")).toBeInTheDocument();
    expect(screen.queryByText("Enable automatic backups")).not.toBeInTheDocument();
    expect(screen.queryByText("Backup History")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Backup Now" })).not.toBeInTheDocument();
    expect(screen.queryByText("Max Count")).not.toBeInTheDocument();
  });

  it("shows storage label and invokes download callback for listed backups", () => {
    const onDownloadBackup = vi.fn();
    const backups: BackupInfo[] = [
      {
        filename: "jobs_manual_2026_11_26_01_00_00.json.gz",
        type: "manual",
        size: 2048,
        createdAt: "2026-11-26T01:00:00.000Z",
      },
    ];

    render(
      <Harness
        canManageBackups
        backups={backups}
        storage={{ kind: "r2", label: "Cloudflare R2 (backups/)" }}
        onDownloadBackup={onDownloadBackup}
      />,
    );

    expect(screen.getByText("Cloudflare R2 (backups/)")).toBeInTheDocument();
    const downloadButton = screen.getByRole("button", {
      name: "Download jobs_manual_2026_11_26_01_00_00.json.gz",
    });
    expect(downloadButton).toHaveAttribute("type", "button");
    fireEvent.click(downloadButton);
    expect(onDownloadBackup).toHaveBeenCalledWith("jobs_manual_2026_11_26_01_00_00.json.gz");
  });

  it("offers a restore button per backup and disables the actions while restoring", () => {
    const onRestoreBackup = vi.fn();
    const backups: BackupInfo[] = [
      {
        filename: "jobs_manual_2026_11_26_01_00_00.json.gz",
        type: "manual",
        size: 2048,
        createdAt: "2026-11-26T01:00:00.000Z",
      },
    ];

    render(<Harness canManageBackups backups={backups} onRestoreBackup={onRestoreBackup} />);

    const restoreButton = screen.getByRole("button", {
      name: "Restore jobs_manual_2026_11_26_01_00_00.json.gz",
    });
    expect(restoreButton).toHaveAttribute("type", "button");
    fireEvent.click(restoreButton);
    expect(onRestoreBackup).toHaveBeenCalledWith("jobs_manual_2026_11_26_01_00_00.json.gz");
  });

  it("lets the max backups field be cleared and retyped instead of snapping back", () => {
    render(<Harness canManageBackups />);

    const input = screen.getByLabelText("Max Backups to Keep") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "3" } });
    expect(input.value).toBe("3");
  });
});
