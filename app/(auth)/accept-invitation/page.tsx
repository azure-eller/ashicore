import { AcceptInvitationForm } from "@/components/accept-invitation-form";
import { getPublicInvitationDetails } from "@/app/(dashboard)/settings/queries";

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const invitation = id ? await getPublicInvitationDetails(id) : null;

  return <AcceptInvitationForm invitation={invitation} />;
}
