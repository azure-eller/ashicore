import "server-only";

type TeamInviteEmailInput = {
  invitationId: string;
  email: string;
  role: string;
  organizationName: string;
  inviterName: string | null;
  request?: Request;
};

function getAppBaseUrl(request?: Request) {
  if (request) {
    return new URL(request.url).origin;
  }

  if (process.env.BETTER_AUTH_URL) {
    return process.env.BETTER_AUTH_URL;
  }

  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  if (process.env.PORT) {
    return `http://localhost:${process.env.PORT}`;
  }

  return "http://localhost:3000";
}

export async function sendTeamInvitationEmail({
  invitationId,
  email,
  role,
  organizationName,
  inviterName,
  request,
}: TeamInviteEmailInput) {
  const baseUrl = getAppBaseUrl(request);
  const inviteUrl = new URL(`/accept-invitation?id=${invitationId}`, baseUrl).toString();
  const resendApiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!resendApiKey || !from) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Missing RESEND_API_KEY or EMAIL_FROM for team invitations.");
    }

    console.info(
      `[team-invite] Skipping email delivery for ${email}. Configure RESEND_API_KEY and EMAIL_FROM to send real invites. Link: ${inviteUrl}`
    );
    return;
  }

  const inviterLine = inviterName ? `${inviterName} invited you` : "You were invited";
  const roleLabel = role === "member" ? "viewer" : role;
  const html = [
    `<p>${inviterLine} to join <strong>${organizationName}</strong> as an ${roleLabel}.</p>`,
    `<p><a href="${inviteUrl}">Accept your invitation</a></p>`,
    `<p>If the button does not work, paste this link into your browser:</p>`,
    `<p>${inviteUrl}</p>`,
  ].join("");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: `Join ${organizationName} on ERP`,
      html,
      text: `${inviterLine} to join ${organizationName} as an ${roleLabel}. Accept your invitation: ${inviteUrl}`,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Failed to send invite email: ${body || response.statusText}`);
  }
}
