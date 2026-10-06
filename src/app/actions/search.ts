"use server";

import { searchRecords, type SearchHit } from "@/db/queries/search";
import { requireSession } from "@/lib/session";

export async function searchAction(query: string): Promise<SearchHit[]> {
  const session = await requireSession();
  return searchRecords(session.user.id, String(query ?? ""));
}
