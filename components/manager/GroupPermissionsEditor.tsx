"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon } from "lucide-react";
import {
  GROUP_MANAGER_ROLES,
  GROUP_TARGET_ROLES,
  GROUP_PERMISSION_TYPES,
  GROUP_PERMISSION_LABELS,
  hasGroupPermission,
  type GroupPermissions,
} from "@/lib/permissions";
import { ROLE_LABELS, MANAGER_GROUP_META } from "@/lib/roles";
import { updateGroupPermissionAction } from "@/actions/group-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Role } from "@/types";

function PermissionCell({
  managerRole,
  targetRole,
  permission,
  checked,
}: {
  managerRole: Role;
  targetRole: Role;
  permission: (typeof GROUP_PERMISSION_TYPES)[number];
  checked: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const result = await updateGroupPermissionAction({
        manager_role: managerRole,
        target_role: targetRole,
        permission,
        granted: !checked,
      });
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      aria-pressed={checked}
      aria-label={`${checked ? "Bỏ" : "Cấp"} quyền ${GROUP_PERMISSION_LABELS[permission]} cho ${ROLE_LABELS[targetRole]}`}
      className="flex size-6 items-center justify-center rounded-[4px] disabled:opacity-50"
      style={{
        backgroundColor: checked ? "var(--primary)" : "transparent",
        boxShadow: "inset 0 0 0 1.5px var(--primary)",
      }}
    >
      {checked && <CheckIcon className="size-3.5 text-primary-foreground" strokeWidth={3} />}
    </button>
  );
}

export default function GroupPermissionsEditor({ permissions }: { permissions: GroupPermissions }) {
  return (
    <div className="space-y-6">
      {GROUP_MANAGER_ROLES.map((managerRole) => (
        <Card key={managerRole}>
          <CardHeader>
            <CardTitle className="text-base">{MANAGER_GROUP_META[managerRole]?.label ?? ROLE_LABELS[managerRole]}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left font-medium text-muted-foreground">Nhóm</th>
                  {GROUP_PERMISSION_TYPES.map((permission) => (
                    <th key={permission} className="p-2 text-center font-medium text-muted-foreground">
                      {GROUP_PERMISSION_LABELS[permission]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GROUP_TARGET_ROLES.map((targetRole) => (
                  <tr key={targetRole} className="border-t">
                    <td className="p-2">{ROLE_LABELS[targetRole]}</td>
                    {GROUP_PERMISSION_TYPES.map((permission) => (
                      <td key={permission} className="p-2 text-center">
                        <PermissionCell
                          managerRole={managerRole}
                          targetRole={targetRole}
                          permission={permission}
                          checked={hasGroupPermission(permissions, managerRole, targetRole, permission)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
