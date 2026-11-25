import type { Story } from "@ladle/react";
import {
  ALL_USER_PERMISSIONS_GRANTED,
  DEFAULT_USER_PERMISSIONS,
  type UserPermissions,
} from "@shared/types";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PermissionToggles } from "./PermissionToggles";

export const Interactive: Story = () => {
  const [permissions, setPermissions] = useState<UserPermissions>({
    ...DEFAULT_USER_PERMISSIONS,
  });

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl border border-border/70 bg-card p-4 text-card-foreground sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-foreground">Workspace permissions</h2>
          <p className="text-xs text-muted-foreground">
            Controls which server capabilities this member may invoke.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setPermissions({ ...DEFAULT_USER_PERMISSIONS })}
        >
          Reset defaults
        </Button>
      </div>
      <PermissionToggles
        idPrefix="story-perm"
        value={permissions}
        onChange={(key, enabled) => setPermissions((prev) => ({ ...prev, [key]: enabled }))}
      />
    </div>
  );
};
Interactive.storyName = "Interactive";

export const AllGrantedReadOnly: Story = () => (
  <div className="mx-auto max-w-md rounded-xl border border-border/70 bg-card p-4 text-card-foreground sm:p-5">
    <PermissionToggles
      idPrefix="story-perm-readonly"
      value={ALL_USER_PERMISSIONS_GRANTED}
      disabled={true}
      onChange={() => {}}
    />
  </div>
);
AllGrantedReadOnly.storyName = "All granted (disabled)";
