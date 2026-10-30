import { z } from "zod";
import { Id } from "./models.ts";
export const ReviewInput = z
  .object({
    association: z.enum(["correct", "wrong", "unsure"]),
    boundaries: z.enum(["complete", "cut-off", "too-wide", "unsure"]),
    notes: z.string().max(500),
  })
  .strict();
export const Review = ReviewInput.extend({
  id: Id,
  revisionId: Id,
  createdAt: z.string(),
});
export type Review = z.infer<typeof Review>;
export const ReviewResult = z.object({ review: Review.nullable() });
