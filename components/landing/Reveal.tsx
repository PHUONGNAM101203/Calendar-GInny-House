"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/* Hiện dần khi cuộn tới — IntersectionObserver gắn class `is-revealed`,
   phần chuyển động nằm trọn trong CSS (`.reveal` ở globals.css) nên không
   re-render gì khi cuộn. Chạy một lần rồi ngắt observer. Người bật
   "giảm chuyển động" thấy nội dung ngay, không đợi hiệu ứng. */
export default function Reveal({
  children,
  delay = 0,
  className,
  depth = false,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  /** Rises toward the reader in 3D instead of sliding up. Needs a `.scene-3d`
   *  ancestor to supply the perspective, otherwise it degrades to a plain fade. */
  depth?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.classList.add("is-revealed");
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-revealed");
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(depth ? "reveal-depth" : "reveal", className)}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
