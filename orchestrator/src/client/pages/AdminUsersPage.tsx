import { PageHeader, PageMain } from "@client/components/layout";
import { UserManagementSection } from "@client/pages/settings/components/UserManagementSection";
import { Users } from "lucide-react";
import type React from "react";

/** Administrator console: invite people, create accounts and control what each user can access. */
export const AdminUsersPage: React.FC = () => (
  <>
    <PageHeader
      icon={Users}
      title="Users"
      subtitle="Invite people and manage their access. Each user gets a private workspace."
    />
    <PageMain>
      <div className="mx-auto max-w-4xl">
        <UserManagementSection />
      </div>
    </PageMain>
  </>
);
