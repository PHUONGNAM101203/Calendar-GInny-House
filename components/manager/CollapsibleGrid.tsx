"use client";

import { Children, useMemo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { periodRange, type OverviewPeriod } from "@/lib/attendance";
import { cn } from "@/lib/utils";

/* Nhóm đơn: lọc theo kỳ + thu gọn phần dài.

   Vì sao thu gọn: các mục Nghỉ phép / Đổi ca / Giải trình đổ ra toàn bộ đơn.
   Sáu đơn thì vừa mắt; sáu mươi đơn thì trang thành cuộn giấy và mục nằm dưới
   coi như không tồn tại.

   Số mục hiện sẵn khác nhau giữa desktop (4) và màn hẹp — điện thoại lẫn máy
   tính bảng — (2), và việc đó làm bằng CSS chứ không phải useIsMobile(). Lý
   do: hook đó trả `undefined` ở lần vẽ đầu, nên chọn số bằng JS sẽ hiện 4 thẻ
   rồi thụt về 2 ngay sau hydrate — đúng kiểu giật đã phải sửa ở lịch. CSS
   quyết định từ khung hình đầu tiên.

   Bộ lọc mặc định là "Tất cả", có chủ đích. Các mục này chứa đơn *chờ duyệt*;
   mặc định lọc theo ngày sẽ giấu mất đơn tồn từ tuần trước, và một đơn nghỉ
   phép bị bỏ quên vì giao diện tự ẩn nó là lỗi nặng hơn nhiều so với một trang
   dài. Người dùng chủ động thu hẹp, hệ thống không tự thu hẹp hộ. */

const PERIOD_LABELS: Record<"all" | OverviewPeriod, string> = {
  all: "Tất cả",
  day: "Hôm nay",
  month: "Tháng này",
  year: "Năm nay",
};

export default function CollapsibleGrid({
  children,
  dates,
  initial = 4,
  initialMobile = 2,
  className,
}: {
  children: React.ReactNode;
  /** created_at của từng thẻ, cùng thứ tự với children. Có mới hiện bộ lọc. */
  dates?: string[];
  /** Số thẻ hiện sẵn trên desktop. */
  initial?: number;
  /** Số thẻ hiện sẵn trên màn hẹp (điện thoại + máy tính bảng). */
  initialMobile?: number;
  className?: string;
}) {
  const items = Children.toArray(children);
  const [expanded, setExpanded] = useState(false);
  const [period, setPeriod] = useState<"all" | OverviewPeriod>("all");

  // Lọc theo created_at, cùng trường mà bảng "Tổng hợp đơn đã gửi" đang dùng —
  // hai chỗ đếm cùng một thứ thì phải đếm theo cùng một mốc, nếu không con số
  // ở bảng và số thẻ ở đây sẽ lệch nhau mà không ai giải thích được.
  const filtered = useMemo(() => {
    if (!dates || period === "all") return items;
    const { start, end } = periodRange(period, new Date());
    return items.filter((_, i) => {
      const raw = dates[i];
      if (!raw) return true;
      const at = new Date(raw);
      return at >= start && at <= end;
    });
  }, [items, dates, period]);

  const hiddenDesktop = filtered.length - initial;
  const hiddenMobile = filtered.length - initialMobile;
  const visible = expanded ? filtered : filtered.slice(0, initial);

  return (
    <div className="space-y-3">
      {dates && (
        <Tabs value={period} onValueChange={(v) => setPeriod(v as "all" | OverviewPeriod)}>
          <TabsList>
            {(["all", "day", "month", "year"] as const).map((p) => (
              <TabsTrigger key={p} value={p}>
                {PERIOD_LABELS[p]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Không có đơn nào trong kỳ đã chọn.</p>
      ) : (
        <div className={className}>
          {visible.map((child, i) => (
            // Thẻ thứ 3-4 có mặt trong DOM nhưng ẩn ở màn hẹp: cùng một cây
            // DOM cho cả hai kích thước, không nhân bản, không phụ thuộc JS.
            <div key={i} className={cn(!expanded && i >= initialMobile && "max-lg:hidden")}>
              {child}
            </div>
          ))}
        </div>
      )}

      {hiddenMobile > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className={cn(
            "flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            // Ở desktop có thể đã hiện hết mà màn hẹp thì chưa — khi đó nút
            // chỉ tồn tại trên màn hẹp.
            hiddenDesktop <= 0 && "lg:hidden"
          )}
        >
          {expanded ? (
            "Thu gọn"
          ) : (
            <>
              {/* Hai nhãn, hai con số — vì số thẻ đang ẩn khác nhau theo bề
                  rộng. Nói sai số lượng còn tệ hơn không nói. */}
              <span className="lg:hidden">Xem thêm {hiddenMobile} mục</span>
              <span className="hidden lg:inline">Xem thêm {Math.max(hiddenDesktop, 0)} mục</span>
            </>
          )}
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
