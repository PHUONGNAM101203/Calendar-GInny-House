"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRingIcon } from "lucide-react";
import { toast } from "sonner";
import { subscribeToPushAction } from "@/actions/push";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

// Push endpoints are base64url-encoded in the VAPID key env var; the Push
// API's applicationServerKey wants raw bytes.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

// A menu row inside the notification bell, not a separate header icon —
// this is a one-time-per-device setup action, not something that needs
// permanent header real estate. Hides itself entirely on browsers with no
// Push API (older Safari on macOS, etc.) rather than showing a dead button.
export default function PushNotificationToggle() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    // Feature detection needs navigator/window, unavailable during SSR —
    // can't compute this in the useState initializer, has to be an effect.
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(true);
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => registration.pushManager.getSubscription())
      .then((existing) => setSubscribed(Boolean(existing)))
      .catch(() => {});
  }, []);

  function handleEnable() {
    startTransition(async () => {
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        toast.error("Chưa cấu hình thông báo đẩy trên máy chủ");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Bạn đã từ chối quyền thông báo trên trình duyệt");
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          // Cast needed because TS 5.7+'s generic Uint8Array<ArrayBufferLike>
          // doesn't structurally match lib.dom.d.ts's ArrayBufferView<ArrayBuffer>
          // expectation here, even though this is exactly the shape the Push
          // API wants at runtime.
          applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
        });
        const raw = subscription.toJSON();
        if (!raw.endpoint || !raw.keys?.p256dh || !raw.keys?.auth) {
          throw new Error("invalid subscription");
        }
        const result = await subscribeToPushAction({
          endpoint: raw.endpoint,
          keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setSubscribed(true);
        toast.success("Đã bật thông báo đẩy trên thiết bị này");
      } catch {
        toast.error("Không thể bật thông báo đẩy trên thiết bị này");
      }
    });
  }

  if (!supported) return null;

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={subscribed || isPending}
        onClick={handleEnable}
        className="gap-2 text-sm"
      >
        <BellRingIcon className="size-3.5 shrink-0" />
        {subscribed
          ? "Đã bật thông báo đẩy trên thiết bị này"
          : isPending
            ? "Đang bật..."
            : "Bật thông báo đẩy trên thiết bị này"}
      </DropdownMenuItem>
    </>
  );
}
