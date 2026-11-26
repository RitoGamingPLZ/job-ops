import * as api from "@client/api";
import { PageHeader, PageMain } from "@client/components/layout";
import { UsersPanel } from "@client/pages/settings/components/UsersPanel";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import type React from "react";
import { queryKeys } from "@/client/lib/queryKeys";

/** Administrator console: create accounts and control what each user can access. */
export const AdminUsersPage: React.FC = () => {
  const meQuery = useQuery({
    queryKey: queryKeys.auth.currentUser(),
    queryFn: api.getCurrentAuthUser,
    retry: false,
  });

  return (
    <>
      <PageHeader
        icon={Users}
        title="Users"
        subtitle="Create accounts and manage access. Each user gets a private workspace."
      />
      <PageMain>
        <div className="mx-auto max-w-4xl">
          <UsersPanel currentUserId={meQuery.data?.id} />
        </div>
      </PageMain>
    </>
  );
};
