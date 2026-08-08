import { cn } from "@/lib/utils";

/* Khung cuộn dùng chung cho các bảng tổng hợp.

   Vì sao cần: các bảng này liệt kê toàn bộ nhân sự. Ở 20 người đã dài quá một
   màn hình; ở 60 người thì mọi thứ nằm dưới nó (biểu đồ, các mục cần duyệt) bị
   đẩy khỏi tầm mắt. Giới hạn chiều cao giữ trang có hình dạng ổn định bất kể
   dữ liệu lớn tới đâu.

   Header dính được ở đây là hợp lệ về cấu trúc — container cuộn chính là *tổ
   tiên* của <thead>. (Đối lập với header lịch RBC, nơi phần cuộn là *anh em*
   nên sticky bất khả thi; xem ghi chú trong globals.css.)

   Nền của <th> phải đục: thiếu nó thì các dòng trôi xuyên qua tên cột.
   `--table-rows` quy ra chiều cao tối đa theo số dòng muốn thấy, nên chỉnh
   "hiện bao nhiêu dòng" là đổi một con số, không phải dò lại px. */
export default function TableScroller({
  children,
  visibleRows = 10,
  className,
}: {
  children: React.ReactNode;
  /** Số dòng hiện trước khi phải cuộn. Mặc định ~1/2 danh sách 20 người. */
  visibleRows?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-auto rounded-xl ring-1 ring-foreground/10",
        // 2.375rem ≈ chiều cao một dòng (py-2 + text-sm), cộng 1 dòng header.
        "max-h-[calc(var(--table-rows)*2.375rem+2.5rem)]",
        "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-1 [&_thead_th]:bg-muted",
        className
      )}
      style={{ "--table-rows": visibleRows } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
