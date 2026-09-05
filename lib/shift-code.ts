import type { Role } from "@/types";

// Mã gọn cho lịch: viết tắt vai trò + số cơ sở, ví dụ "QS1" (quản sinh cơ sở
// 1), "LT1" (lễ tân cơ sở 1). Chủ app: "mỗi ngày chị nhìn cái này 8 lần, loạn
// hết cả lên" — card trên lịch tuần rất hẹp, nên một mã hai-ba ký tự quét
// nhanh hơn hẳn nhãn đầy đủ như "Quản sinh".
//
// Giữ ROLE_CODES riêng khỏi ROLE_LABELS thay vì cắt chuỗi tự động: "CSKH" và
// "CTV" vốn đã là viết tắt, cắt máy móc sẽ ra bậy.
export const ROLE_CODES: Record<Role, string> = {
  ceo: "TGĐ",
  coo: "GĐVH",
  training_director: "GĐĐT",
  hr: "HR",
  technical: "KT",
  teacher: "GV",
  student_affairs: "QS",
  teaching_assistant: "TG",
  collaborator: "CTV",
  customer_care: "CSKH",
  operations_staff: "VH",
  receptionist: "LT",
};

// "Cơ sở 1" -> "QS1". Cơ sở "Remote" không có số nên trả về mã trần ("GV") —
// tốt hơn là bịa ra một con số không tồn tại.
export function formatShiftCode(kind: Role, branchName: string | null | undefined): string {
  const digit = branchName?.match(/\d+/)?.[0];
  return digit ? `${ROLE_CODES[kind]}${digit}` : ROLE_CODES[kind];
}
