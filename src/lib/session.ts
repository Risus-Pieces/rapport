import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

// Call this at the top of every server component, query and server action that needs a user.
export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
