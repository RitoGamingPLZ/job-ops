import { DEFAULT_USER_PERMISSIONS } from "@shared/types";
import * as api from "@client/api";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { EnvironmentSettingsSection } from "./EnvironmentSettingsSection";

vi.mock("@client/api", () => ({
  changeOwnPassword: vi.fn(),
  createWorkspaceUser: vi.fn(),
  getCurrentAuthUser: vi.fn(),
  getSsoProviders: vi.fn(),
  listSsoIdentities: vi.fn(),
  listWorkspaceUsers: vi.fn(),
  listUserInvitations: vi.fn(async () => []),
  createUserInvitation: vi.fn(),
  deleteUserInvitation: vi.fn(),
  deleteWorkspaceUser: vi.fn(),
  setWorkspaceUserPermissions: vi.fn(),
  resetWorkspaceUserPassword: vi.fn(),
  setWorkspaceUserDisabled: vi.fn(),
  startSsoLink: vi.fn(),
  unlinkSsoIdentity: vi.fn(),
}));

const EnvironmentSettingsHarness = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const methods = useForm<UpdateSettingsInput>({
    defaultValues: {
      adzunaAppId: "adzuna-id",
      adzunaAppKey: "",
      webhookSecret: "",
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <FormProvider {...methods}>
        <Accordion type="multiple" defaultValue={["environment"]}>
          <EnvironmentSettingsSection
            values={{
              readable: {
                adzunaAppId: "adzuna-id",
              },
              private: {
                adzunaAppKeyHint: "adzu",
                webhookSecretHint: "sec-",
              },
            }}
            isLoading={false}
            isSaving={false}
          />
        </Accordion>
      </FormProvider>
    </QueryClientProvider>
  );
};

describe("EnvironmentSettingsSection", () => {
  beforeEach(() => {
    vi.mocked(api.getCurrentAuthUser).mockResolvedValue({
      id: "admin-user",
      username: "admin",
      displayName: "Admin User",
      isSystemAdmin: true,
      isDisabled: false,
      hasPassword: true,
      mustChangePassword: false,
      workspaceId: "tenant-admin",
      workspaceName: "Admin Workspace",
      permissions: { ...DEFAULT_USER_PERMISSIONS },
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
    });
    vi.mocked(api.listWorkspaceUsers).mockResolvedValue([
      {
        id: "workspace-user",
        username: "member",
        displayName: "Member User",
        isSystemAdmin: false,
        isDisabled: false,
        hasPassword: true,
        mustChangePassword: false,
        workspaceId: "tenant-member",
        workspaceName: "Member Workspace",
        permissions: { ...DEFAULT_USER_PERMISSIONS },
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T00:00:00.000Z",
      },
    ]);
    vi.mocked(api.getSsoProviders).mockResolvedValue([]);
    vi.mocked(api.listSsoIdentities).mockResolvedValue([]);
  });

  it("renders values grouped logically and masks private secrets with hints", () => {
    render(<EnvironmentSettingsHarness />);

    expect(screen.getByDisplayValue("adzuna-id")).toBeInTheDocument();

    expect(screen.getAllByText("••••••••")).toHaveLength(1);
    expect(screen.queryByText(/pass\*{4,}/)).not.toBeInTheDocument();
    expect(screen.queryByText(/adzu\*{4,}/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Enable authentication")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("username")).not.toBeInTheDocument();

    // Sections
    expect(screen.getByText("Service Accounts")).toBeInTheDocument();
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.queryByText("RxResume")).not.toBeInTheDocument();
  });
});
