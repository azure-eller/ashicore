import { z } from "zod";

export const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(120, "Name must be 120 characters or fewer."),
});

export const changeEmailSchema = z.object({
  newEmail: z
    .email("Enter a valid email address.")
    .transform((email) => email.toLowerCase().trim()),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required."),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Please confirm your new password."),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ["newPassword"],
    message: "Choose a new password that is different from the current password.",
  });

export const accountSettingsSchema = z
  .object({
    name: updateProfileSchema.shape.name,
    email: changeEmailSchema.shape.newEmail,
    currentPassword: z.string(),
    newPassword: z.string(),
    confirmPassword: z.string(),
  })
  .superRefine((value, ctx) => {
    const wantsPasswordChange =
      value.currentPassword.length > 0 ||
      value.newPassword.length > 0 ||
      value.confirmPassword.length > 0;

    if (!wantsPasswordChange) {
      return;
    }

    if (value.currentPassword.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["currentPassword"],
        message: "Current password is required.",
      });
    }

    if (value.newPassword.length < 8) {
      ctx.addIssue({
        code: "custom",
        path: ["newPassword"],
        message: "New password must be at least 8 characters.",
      });
    }

    if (value.confirmPassword.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Please confirm your new password.",
      });
    }

    if (
      value.newPassword.length > 0 &&
      value.confirmPassword.length > 0 &&
      value.newPassword !== value.confirmPassword
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Passwords do not match.",
      });
    }

    if (
      value.currentPassword.length > 0 &&
      value.newPassword.length > 0 &&
      value.currentPassword === value.newPassword
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["newPassword"],
        message: "Choose a new password that is different from the current password.",
      });
    }
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type AccountSettingsInput = z.infer<typeof accountSettingsSchema>;
