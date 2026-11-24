import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { Accordion } from "@/components/ui/accordion";
import { BackupSettingsSection } from "./BackupSettingsSection";

const values = {
  backupEnabled: { default: false, effective: true },
  backupHour: { default: 2, effective: 3 },
  backupMaxCount: { default: 5, effective: 4 },
};

const Harness = ({ canManageBackups }: { canManageBackups?: boolean }) => {
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
          backups={[]}
          nextScheduled={null}
          isLoading={false}
          isSaving={false}
          onCreateBackup={() => {}}
          onDeleteBackup={() => {}}
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
    expect(screen.getByRole("button", { name: "Create Backup Now" })).toBeInTheDocument();
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
});
