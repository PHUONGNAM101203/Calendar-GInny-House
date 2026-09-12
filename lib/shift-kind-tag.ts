import { ROLE_LABELS } from "@/lib/roles";
import type { Role } from "@/types";

// What kind of shift this is — NOT an attendance-status readout (that lives
// in the "Toàn hệ thống" table's own Trạng thái column).
//
// Three tiers, in order:
//   1. The shift's own covering_role (0085). Only a quản sinh kiêm lễ tân
//      creates this ambiguity, and only they get the dropdown that sets it.
//   2. Someone whose reception duty IS their front-desk job — covers_reception
//      with any primary other than quản sinh. Keeps the pre-0085 behaviour for
//      CSKH/HR kiêm lễ tân, whose every shift read "Ca lễ tân" and still
//      should. Same condition as lib/roles.ts's isReceptionistExempt, on
//      purpose: the people exempt from clock-in reminders are exactly the
//      people whose shifts are reception shifts by default.
//   3. Their primary role.
export function computeShiftKind(
  shift: { covering_role: Role | null },
  assignee: { role: Role; covers_reception?: boolean }
): Role {
  if (shift.covering_role) return shift.covering_role;
  if (assignee.covers_reception && assignee.role !== "student_affairs") return "receptionist";
  return assignee.role;
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

// Có được chọn giữa vai trò gốc và ca lễ tân hay không.
//
// Không chỉ là `coversReception`: một người vốn đã là lễ tân mà bị bật thêm
// cờ này sẽ thấy dropdown có hai lựa chọn trùng tên "Lễ tân", vì vai trò gốc
// của họ cũng chính là lễ tân. Cờ ấy dành cho người có vai trò KHÁC nhận
// thêm việc trực quầy (hiện là quản sinh, CSKH và HR), nên với lễ tân nó
// không mang thêm nghĩa gì. Dùng chung cho cả lối quản lý tạo ca và lối tự
// đăng ký ca để hai bên không lệch nhau.
export function canChooseCoveringRole(
  role: Role,
  coversReception: boolean | null | undefined
): boolean {
  return Boolean(coversReception) && role !== "receptionist";
}
