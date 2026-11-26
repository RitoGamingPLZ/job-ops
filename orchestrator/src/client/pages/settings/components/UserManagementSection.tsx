import * as api from "@client/api";
import {
  InvitationsPanel,
  invitationsQueryKey,
} from "@client/pages/settings/components/InvitationsPanel";
import { UsersPanel } from "@client/pages/settings/components/UsersPanel";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/client/lib/queryKeys";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function UserManagementSection() {
  const meQuery = useQuery({
    queryKey: queryKeys.auth.currentUser(),
    queryFn: api.getCurrentAuthUser,
    retry: false,
  });
  const isAdmin = meQuery.data?.isSystemAdmin === true;
  // Shares its cache entry with InvitationsPanel; only used for the tab badge.
  const invitationsQuery = useQuery({
    queryKey: invitationsQueryKey,
    queryFn: api.listUserInvitations,
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <div className="space-y-2">
        <div className="text-sm font-semibold">Workspace</div>
        <p className="text-sm text-muted-foreground">
          Signed in as {meQuery.data?.username ?? "a workspace user"}.
        </p>
      </div>
    );
  }

  const pendingInvitations = (invitationsQuery.data ?? []).filter(
    (invitation) => invitation.status === "pending",
  ).length;

  return (
    <Tabs defaultValue="users">
      <TabsList>
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="invitations">
          Invitations{pendingInvitations > 0 ? ` (${pendingInvitations})` : ""}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="users" className="mt-4">
        <UsersPanel currentUserId={meQuery.data?.id} />
      </TabsContent>
      <TabsContent value="invitations" className="mt-4">
        <InvitationsPanel />
      </TabsContent>
    </Tabs>
  );
}
