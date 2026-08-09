import { z } from "zod";
import { GROUP_MANAGER_ROLES, GROUP_TARGET_ROLES, GROUP_PERMISSION_TYPES } from "@/lib/permissions";

export const groupPermissionUpdateSchema = z.object({
  manager_role: z.enum(GROUP_MANAGER_ROLES, "Vai trò quản lý không hợp lệ"),
  target_role: z.enum(GROUP_TARGET_ROLES, "Vai trò được quản lý không hợp lệ"),
  permission: z.enum(GROUP_PERMISSION_TYPES, "Loại quyền không hợp lệ"),
  granted: z.boolean(),
});

export type GroupPermissionUpdateInput = z.infer<typeof groupPermissionUpdateSchema>;
