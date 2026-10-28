"use server";

import type { SearchHit } from "@/db/queries/search";
import { searchScoped } from "@/db/queries/access";
import { getScope } from "@/lib/scope";

export async function searchAction(query: string): Promise<SearchHit[]> {
  return searchScoped(await getScope(), String(query ?? ""));
}
