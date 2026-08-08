"use client";

import { Children, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* Hiện vài mục đầu, phần còn lại nằm sau một nút bấm.

   Vì sao: các mục Nghỉ phép / Đổi ca / Giải trình hiện đổ ra toàn bộ đơn. Sáu
   đơn thì vừa mắt; sáu mươi đơn thì trang thành một cuộn giấy và mục nằm dưới
   cùng coi như không tồn tại. Quản lý cần *biết có bao nhiêu* và xử lý vài cái
   trên đầu — không phải cuộn qua hết mới tới mục kế tiếp.

   Các thẻ con do Server Component render rồi truyền xuống; ở đây chỉ cắt lát
   danh sách đã dựng sẵn. Nghĩa là không phải chuyển cả trang sang client, và
   dữ liệu vẫn được tải một lần trên server như cũ.

   Không có ngưỡng nào bị giấu: khi còn mục ẩn, nút luôn nói rõ còn *bao nhiêu*.
   Ẩn bớt mà không cho biết đã ẩn gì thì tệ hơn là để dài. */
export default function CollapsibleGrid({
  children,
  initial = 4,
  className,
}: {
  children: React.ReactNode;
  /** Số mục hiện trước khi phải bấm mở rộng. */
  initial?: number;
  className?: string;
}) {
  const items = Children.toArray(children);
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = items.length - initial;
  const visible = expanded || hiddenCount <= 0 ? items : items.slice(0, initial);

  return (
    <div className="space-y-3">
      <div className={className}>{visible}</div>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {expanded ? "Thu gọn" : `Xem thêm ${hiddenCount} mục`}
          <ChevronDownIcon
            className={cn(
              "size-4 transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)] motion-reduce:transition-none",
              expanded && "rotate-180"
            )}
          />
        </button>
      )}
    </div>
  );
}
