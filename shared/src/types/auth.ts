export interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
  isSystemAdmin: boolean;
  isDisabled: boolean;
  hasPassword: boolean;
  mustChangePassword: boolean;
  workspaceId: string;
  workspaceName: string;
  createdAt: string;
  updatedAt: string;
}
