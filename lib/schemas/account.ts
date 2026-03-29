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

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
