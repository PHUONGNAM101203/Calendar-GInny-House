"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/* Nghiêng 3D theo con trỏ.

   Vì sao là tương tác chứ không phải animation tự chạy: một khối 3D xoay vòng
   mà người dùng không chạm được vào chỉ là trang trí — nó tốn GPU và không nói
   thêm điều gì. Nghiêng theo con trỏ thì khác: người dùng điều khiển nó, và
   chuyển động phản hồi lại chính hành vi của họ.

   Ba điều kiện để hiệu ứng chạy, thiếu một là tắt hẳn:
   - `prefers-reduced-motion` không bật
   - thiết bị có con trỏ chính xác (`pointer: fine`) — điện thoại không có
     hover nên nghiêng theo chạm chỉ gây giật

   Ghi trực tiếp vào CSS custom property thay vì setState: cuộn/di chuột bắn ra
   hàng trăm sự kiện mỗi giây, mỗi lần setState là một lần React render lại cả
   cây con. Ở đây React không hề biết chuột đang di chuyển. */

const MAX_TILT_DEG = 7;

export default function TiltCard({
  children,
  className,
  intensity = 1,
}: {
  children: React.ReactNode;
  className?: string;
  /** 0–1, giảm biên độ cho các khối phụ để chúng không tranh chấp với khối chính */
  intensity?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(pointer: fine)");
    if (reduced.matches || !finePointer.matches) return;

    let frame = 0;

    const onMove = (e: PointerEvent) => {
      if (frame) return; // gộp nhiều sự kiện vào một khung hình
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        // -0.5 … 0.5 quanh tâm khối
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        const amount = MAX_TILT_DEG * intensity;
        // trục Y theo chiều ngang, trục X đảo dấu để khối "ngả về phía" con trỏ
        el.style.setProperty("--tilt-y", `${px * amount}deg`);
        el.style.setProperty("--tilt-x", `${-py * amount}deg`);
      });
    };

    const onLeave = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      el.style.setProperty("--tilt-y", "0deg");
      el.style.setProperty("--tilt-x", "0deg");
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [intensity]);

  return (
    <div ref={ref} className={cn("tilt", className)}>
      <div className="tilt-inner">{children}</div>
    </div>
  );
}
