import type { Story } from "@ladle/react";
import { DEFAULT_USER_PERMISSIONS, type UserInvitation } from "@shared/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { InvitationsPanel } from "./InvitationsPanel";

const INITIAL_INVITATIONS: UserInvitation[] = [
  {
    id: "inv-pending-1",
    label: "QA reviewer invite",
    permissions: {
      ...DEFAULT_USER_PERMISSIONS,
      defaultModel: true,
      pipeline: true,
    },
    status: "pending",
    expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    usedAt: null,
    usedByUsername: null,
  },
  {
    id: "inv-used-1",
    label: "Teammate onboarding",
    permissions: {
      ...DEFAULT_USER_PERMISSIONS,
    },
    status: "used",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    usedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    usedByUsername: "alex.dev",
  },
  {
    id: "inv-revoked-1",
    label: "Expired workshop link",
    permissions: {
      ...DEFAULT_USER_PERMISSIONS,
    },
    status: "revoked",
    expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
    usedAt: null,
    usedByUsername: null,
  },
];

function InvitationsStoryHarness({ initialInvitations }: { initialInvitations: UserInvitation[] }) {
  const storeRef = useRef<UserInvitation[]>(initialInvitations.map((item) => ({ ...item })));
  const queryClientRef = useRef<QueryClient | null>(null);
  if (!queryClientRef.current) {
    queryClientRef.current = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  }

  const installHandlers = () => {
    window.__mockFetchHandlers = {
      "/api/workspaces/invitations/": async (urlStr: string, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          const id = decodeURIComponent(urlStr.split("/").pop() ?? "");
          storeRef.current = storeRef.current.filter((inv) => inv.id !== id);
          return { id };
        }
        return {};
      },
      "/api/workspaces/invitations": async (_urlStr: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          const payload = init.body
            ? (JSON.parse(String(init.body)) as {
                label?: string;
                permissions?: UserInvitation["permissions"];
                expiresInDays?: number;
              })
            : {};
          const now = Date.now();
          const created: UserInvitation & { token: string } = {
            id: `inv-${now}`,
            label: payload.label?.trim() || "New invite",
            permissions: payload.permissions ?? { ...DEFAULT_USER_PERMISSIONS },
            status: "pending",
            expiresAt: new Date(
              now + (payload.expiresInDays ?? 7) * 24 * 3600 * 1000,
            ).toISOString(),
            createdAt: new Date(now).toISOString(),
            usedAt: null,
            usedByUsername: null,
            token: `demo_invite_${now.toString(36)}`,
          };
          storeRef.current = [created, ...storeRef.current];
          return { invitation: created };
        }
        return { invitations: storeRef.current };
      },
    };
  };

  installHandlers();

  useEffect(() => {
    installHandlers();
    return () => {
      window.__mockFetchHandlers = null;
    };
  }, []);

  return (
    <QueryClientProvider client={queryClientRef.current}>
      <div className="mx-auto max-w-2xl">
        <InvitationsPanel />
      </div>
    </QueryClientProvider>
  );
}

export const Interactive: Story = () => (
  <InvitationsStoryHarness initialInvitations={INITIAL_INVITATIONS} />
);
Interactive.storyName = "Interactive";

export const EmptyState: Story = () => <InvitationsStoryHarness initialInvitations={[]} />;
EmptyState.storyName = "Empty";
