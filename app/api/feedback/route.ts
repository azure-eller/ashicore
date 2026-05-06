import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { getAuthedApiMemberContext } from "@/lib/dal/auth";
import { sendFeedbackEmail } from "@/lib/email/feedback";

const MAX_SCREENSHOTS = 3;
const MAX_BASE64_BYTES_PER_SCREENSHOT = 1_400_000;
const MAX_BASE64_BYTES_TOTAL = 3_500_000;

const feedbackSchema = z.object({
  message: z.string().trim().min(1, "Message is required").max(5000, "Message is too long"),
  pageUrl: z.string().url().max(2000).optional(),
  userAgent: z.string().max(500).optional(),
  screenshots: z
    .array(
      z.object({
        filename: z.string().trim().min(1).max(120),
        contentBase64: z
          .string()
          .min(1)
          .max(MAX_BASE64_BYTES_PER_SCREENSHOT, "Screenshot is too large"),
      })
    )
    .max(MAX_SCREENSHOTS, `At most ${MAX_SCREENSHOTS} screenshots`)
    .refine(
      (shots) =>
        shots.reduce((sum, shot) => sum + shot.contentBase64.length, 0) <=
        MAX_BASE64_BYTES_TOTAL,
      "Combined screenshots are too large"
    )
    .optional(),
});

export const POST = apiHandler(async (request) => {
  const context = await getAuthedApiMemberContext(request.headers);
  const body = await request.json();
  const data = feedbackSchema.parse(body);

  await sendFeedbackEmail({
    message: data.message,
    screenshots: data.screenshots,
    context: {
      organizationName: context.organizationName,
      pageUrl: data.pageUrl ?? null,
      userAgent: data.userAgent ?? null,
      submittedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
});
