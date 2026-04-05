import "server-only";

import { render } from "@react-email/components";
import { getAppName, getCanonicalAppUrl } from "@/lib/email/config";
import { sendTransactionalEmail } from "@/lib/email/send";
import { TeamInvite } from "@/lib/email/components/team-invite";

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
  const inviteUrl = new URL(
    `/accept-invitation?id=${invitationId}`,
    baseUrl
  ).toString();
  const roleLabel = role === "member" ? "viewer" : role;

  const html = await render(
    <TeamInvite
      inviteUrl={inviteUrl}
      organizationName={organizationName}
      inviterName={inviterName}
      roleLabel={roleLabel}
    />
  );
  const text = await render(
    <TeamInvite
      inviteUrl={inviteUrl}
      organizationName={organizationName}
      inviterName={inviterName}
      roleLabel={roleLabel}
    />,
    { plainText: true }
  );

  await sendTransactionalEmail({
    tag: "team-invite",
    to: email,
    subject: `Join ${organizationName} on ${getAppName()}`,
    html,
    text,
  });
}
