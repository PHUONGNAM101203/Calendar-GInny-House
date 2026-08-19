import { ROLE_LABELS } from "@/lib/roles";
import type { Role } from "@/types";

// What kind of shift this is, purely by who's covering it — NOT an
// attendance-status readout (that lives in the restored "Toàn hệ thống"
// table's own Trạng thái column; duplicating it here was the thing this
// replaces). "Kiêm lễ tân" (secondary_role === "receptionist") always wins
// over the assignee's primary role, matching every other lễ tân-exemption
// check in the app (lib/roles.ts's isReceptionistExempt).
export function computeShiftKind(assignee: { role: Role; secondary_role: Role | null }): Role {
  return assignee.secondary_role === "receptionist" ? "receptionist" : assignee.role;
}

// Same lowercase-after-"Ca" convention SHIFT_TYPE_LABELS already uses
// ("Ca sáng", "Ca remote") — kept as its own map rather than lowercasing
// ROLE_LABELS on the fly, since acronyms like CTV/CSKH/HR must stay
// uppercase.
export const SHIFT_KIND_LABELS: Record<Role, string> = {
  ceo: `Ca ${ROLE_LABELS.ceo}`,
  coo: `Ca ${ROLE_LABELS.coo}`,
  training_director: `Ca ${ROLE_LABELS.training_director}`,
  hr: `Ca ${ROLE_LABELS.hr}`,
  technical: "Ca kỹ thuật",
  teacher: "Ca giáo viên",
  student_affairs: "Ca quản sinh",
  teaching_assistant: "Ca trợ giảng",
  collaborator: `Ca ${ROLE_LABELS.collaborator}`,
  customer_care: `Ca ${ROLE_LABELS.customer_care}`,
  operations_staff: "Ca vận hành",
  receptionist: "Ca lễ tân",
};
