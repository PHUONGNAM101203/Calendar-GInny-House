// Vietnam public holidays — client-only overlay (see CalendarSidebar's
// "Ngày lễ ở Việt Nam" toggle), not stored in the database since these are
// fixed national dates, not something any user creates or edits. Lunar-
// calendar holidays (Tết) shift every year — this list should be refreshed
// against the government's official announcement each year rather than
// computed.
export type Holiday = { date: string; name: string };

export const VIETNAM_HOLIDAYS: Holiday[] = [
  // 2025
  { date: "2025-01-01", name: "Tết Dương lịch" },
  { date: "2025-01-25", name: "Nghỉ Tết Nguyên Đán" },
  { date: "2025-01-26", name: "Nghỉ Tết Nguyên Đán" },
  { date: "2025-01-27", name: "Nghỉ Tết Nguyên Đán" },
  { date: "2025-01-28", name: "Giao thừa Tết Ất Tỵ" },
  { date: "2025-01-29", name: "Mùng 1 Tết Ất Tỵ" },
  { date: "2025-01-30", name: "Mùng 2 Tết Ất Tỵ" },
  { date: "2025-01-31", name: "Mùng 3 Tết Ất Tỵ" },
  { date: "2025-02-01", name: "Nghỉ Tết Nguyên Đán" },
  { date: "2025-04-06", name: "Giỗ Tổ Hùng Vương" },
  { date: "2025-04-30", name: "Ngày Giải phóng miền Nam" },
  { date: "2025-05-01", name: "Ngày Quốc tế Lao động" },
  { date: "2025-09-01", name: "Nghỉ Quốc khánh" },
  { date: "2025-09-02", name: "Ngày Quốc khánh" },
  // 2026
  { date: "2026-01-01", name: "Tết Dương lịch" },
  { date: "2026-02-15", name: "Nghỉ Tết Nguyên Đán" },
  { date: "2026-02-16", name: "Giao thừa Tết Bính Ngọ" },
  { date: "2026-02-17", name: "Mùng 1 Tết Bính Ngọ" },
  { date: "2026-02-18", name: "Mùng 2 Tết Bính Ngọ" },
  { date: "2026-02-19", name: "Mùng 3 Tết Bính Ngọ" },
  { date: "2026-02-20", name: "Nghỉ Tết Nguyên Đán" },
  { date: "2026-04-25", name: "Giỗ Tổ Hùng Vương" },
  { date: "2026-04-30", name: "Ngày Giải phóng miền Nam" },
  { date: "2026-05-01", name: "Ngày Quốc tế Lao động" },
  { date: "2026-09-01", name: "Nghỉ Quốc khánh" },
  { date: "2026-09-02", name: "Ngày Quốc khánh" },
  // 2027
  { date: "2027-01-01", name: "Tết Dương lịch" },
  { date: "2027-02-05", name: "Giao thừa Tết Đinh Mùi" },
  { date: "2027-02-06", name: "Mùng 1 Tết Đinh Mùi" },
  { date: "2027-02-07", name: "Mùng 2 Tết Đinh Mùi" },
  { date: "2027-02-08", name: "Mùng 3 Tết Đinh Mùi" },
  { date: "2027-04-15", name: "Giỗ Tổ Hùng Vương" },
  { date: "2027-04-30", name: "Ngày Giải phóng miền Nam" },
  { date: "2027-05-01", name: "Ngày Quốc tế Lao động" },
  { date: "2027-09-01", name: "Nghỉ Quốc khánh" },
  { date: "2027-09-02", name: "Ngày Quốc khánh" },
];
