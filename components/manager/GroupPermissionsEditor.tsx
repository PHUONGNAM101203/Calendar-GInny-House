"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckIcon } from "lucide-react";
import {
  GROUP_MANAGER_ROLES,
  GROUP_TARGET_ROLES,
  GROUP_PERMISSION_TYPES,
  GROUP_PERMISSION_LABELS,
  hasGroupPermission,
  permKey,
  type GroupPermissions,
  type GroupPermissionType,
} from "@/lib/permissions";
import { ROLE_LABELS } from "@/lib/roles";
import { updateGroupPermissionAction } from "@/actions/group-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Role } from "@/types";

export type ManagerHolders = Partial<Record<Role, string[]>>;

export default function GroupPermissionsEditor({
  permissions,
  managerHolders,
}: {
  permissions: GroupPermissions;
  /** full_name(s) of whoever currently holds each manager role, for the card title. */
  managerHolders: ManagerHolders;
}) {
  // Optimistic layer over the server-rendered `permissions` prop. Clicking
  // writes here first so the checkbox flips in the same frame, then the
  // server action runs in the background; a failure rolls this entry back.
  //
  // An overrides map (rather than copying `permissions` into state) keeps the
  // server prop as the base truth with no re-sync effect needed: when a later
  // render delivers fresh permissions, any override still sitting on top
  // already agrees with it, so the two never fight.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());

  function isChecked(managerRole: Role, targetRole: Role, permission: GroupPermissionType): boolean {
    const key = permKey(managerRole, targetRole, permission);
    const override = overrides.get(key);
    return override ?? hasGroupPermission(permissions, managerRole, targetRole, permission);
  }

  function setOverride(key: string, value: boolean) {
    setOverrides((prev) => new Map(prev).set(key, value));
  }

  function toggle(managerRole: Role, targetRole: Role, permission: GroupPermissionType) {
    const key = permKey(managerRole, targetRole, permission);
    const next = !isChecked(managerRole, targetRole, permission);

    // Paint first, ask the server after — this is the whole point of the
    // optimistic layer, so no await/transition gates the visual toggle.
    setOverride(key, next);

    void updateGroupPermissionAction({
      manager_role: managerRole,
      target_role: targetRole,
      permission,
      granted: next,
    }).then((result) => {
      if (!result.ok) {
        setOverride(key, !next); // roll back to what the server still believes
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {GROUP_MANAGER_ROLES.map((managerRole) => {
        const holders = managerHolders[managerRole] ?? [];
        return (
          <Card key={managerRole}>
            <CardHeader>
              <CardTitle className="text-base">
                {holders.length > 0 ? holders.join(", ") : ROLE_LABELS[managerRole]}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {holders.length > 0
                  ? ROLE_LABELS[managerRole]
                  : `${ROLE_LABELS[managerRole]} — chưa có ai được gán vị trí này`}
              </p>
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
                      {GROUP_PERMISSION_TYPES.map((permission) => {
                        const checked = isChecked(managerRole, targetRole, permission);
                        return (
                          <td key={permission} className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => toggle(managerRole, targetRole, permission)}
                              aria-pressed={checked}
                              aria-label={`${checked ? "Bỏ" : "Cấp"} quyền ${GROUP_PERMISSION_LABELS[permission]} cho ${ROLE_LABELS[targetRole]}`}
                              className="flex size-6 items-center justify-center rounded-[4px] transition-colors"
                              style={{
                                backgroundColor: checked ? "var(--primary)" : "transparent",
                                boxShadow: "inset 0 0 0 1.5px var(--primary)",
                              }}
                            >
                              {checked && <CheckIcon className="size-3.5 text-primary-foreground" strokeWidth={3} />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
