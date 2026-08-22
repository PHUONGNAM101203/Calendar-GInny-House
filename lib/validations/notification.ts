import { z } from "zod";

// Dismissing one stored notification from the bell. The id is the raw
// `notifications.id` uuid — not the `stored-<uuid>` key the bell uses for
// React, which is prefixed only to keep it from colliding with a derived
// item's `swap-<id>` / `leave-<id>`.
export const markNotificationReadSchema = z.object({
  id: z.uuid("Thông báo không hợp lệ"),
});
export type MarkNotificationReadInput = z.infer<typeof markNotificationReadSchema>;
