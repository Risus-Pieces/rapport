import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { getContact } from "@/db/queries/contacts";
import { contactOwner } from "@/db/queries/access";
import { getScope } from "@/lib/scope";
import { uuid } from "@/lib/validation/common";
import { ContactForm } from "../../_components/contact-form";

export const metadata = { title: "Edit contact" };

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const scope = await getScope();
  const id = uuid.safeParse((await params).id);
  if (!id.success) notFound();
  const owner = await contactOwner(scope, id.data);
  if (!owner) notFound();
  const contact = await getContact(owner, id.data);
  if (!contact || contact.section !== "general") notFound();
  return (
    <>
      <PageHeader title={`Edit ${contact.name}`} accent="general" />
      <ContactForm defaults={contact} cancelHref={`/general/${contact.id}`} />
    </>
  );
}
