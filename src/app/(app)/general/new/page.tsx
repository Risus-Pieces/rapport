import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/session";
import { ContactForm } from "../_components/contact-form";

export const metadata = { title: "Add contact" };

export default async function NewContactPage() {
  await requireSession();
  return (
    <>
      <PageHeader title="Add contact" accent="general" />
      <ContactForm defaults={{ priority: "high" }} cancelHref="/general" />
    </>
  );
}
