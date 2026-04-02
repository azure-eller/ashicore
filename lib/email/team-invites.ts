import "server-only";

import { getCanonicalAppUrl } from "@/lib/email/config";
import { sendTransactionalEmail } from "@/lib/email/send";

type TeamInviteEmailInput = {
  invitationId: string;
  email: string;
  role: string;
  organizationName: string;
  inviterName: string | null;
};

export async function sendTeamInvitationEmail({
  invitationId,
  email,
  role,
  organizationName,
  inviterName,
}: TeamInviteEmailInput) {
  const baseUrl = getCanonicalAppUrl();
  const inviteUrl = new URL(`/accept-invitation?id=${invitationId}`, baseUrl).toString();
  const inviterLine = inviterName ? `${inviterName} invited you` : "You were invited";
  const roleLabel = role === "member" ? "viewer" : role;

  await sendTransactionalEmail({
    tag: "team-invite",
    to: email,
    subject: `Join ${organizationName} on ERP`,
    html: [
      `<p>${inviterLine} to join <strong>${organizationName}</strong> as an ${roleLabel}.</p>`,
      `<p><a href="${inviteUrl}">Accept your invitation</a></p>`,
      "<p>If the button does not work, paste this link into your browser:</p>",
      `<p>${inviteUrl}</p>`,
    ].join(""),
    text: `${inviterLine} to join ${organizationName} as an ${roleLabel}. Accept your invitation: ${inviteUrl}`,
  });
}
