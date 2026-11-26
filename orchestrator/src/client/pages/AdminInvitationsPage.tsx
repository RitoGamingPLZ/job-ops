import { PageHeader, PageMain } from "@client/components/layout";
import { InvitationsPanel } from "@client/pages/settings/components/InvitationsPanel";
import { MailPlus } from "lucide-react";
import type React from "react";

/** Administrator console: issue one-time sign-up links and review their status. */
export const AdminInvitationsPage: React.FC = () => (
  <>
    <PageHeader
      icon={MailPlus}
      title="Invitations"
      subtitle="Invite people with a one-time sign-up link."
    />
    <PageMain>
      <div className="mx-auto max-w-4xl">
        <InvitationsPanel />
      </div>
    </PageMain>
  </>
);
