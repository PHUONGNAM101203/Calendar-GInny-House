import { z } from "zod";

export const swapRequestSchema = z.object({
  shift_id: z.uuid(),
  target_id: z.uuid().optional(),
  target_shift_id: z.uuid().optional(),
  message: z.string().max(280, "Lời nhắn tối đa 280 ký tự").optional(),
});
export type SwapRequestInput = z.infer<typeof swapRequestSchema>;
