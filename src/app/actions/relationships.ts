"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { restoreRelationship, setContactRelationship, setDealRelationship, tryAgainFor } from "@/db/queries/relationships";
import { requireSession } from "@/lib/session";
import { uuid } from "@/lib/validation/common";

const MOVES = ["known", "on_hold", "dismissed", "restore", "try_again"] as const;
type Move = (typeof MOVES)[number];
const CRM_PATH = /^\/(investors|restaurants|general)(\/[0-9a-f-]{36})?(\?[\w=&%+.-]*)?$/;

/** Moves a deal (Investors, Restaurants) or a General contact between relationships, then returns to the page. */
export async function relationshipAction(formData: FormData) {
  const session = await requireSession();
  const id = uuid.safeParse(formData.get("id"));
  const kind = formData.get("kind");
  const move = String(formData.get("move") ?? "") as Move;
  if (!id.success || (kind !== "deal" && kind !== "contact") || !MOVES.includes(move)) return;
  const target = kind === "deal" ? { dealId: id.data } : { contactId: id.data };
  const userId = session.user.id;
  if (move === "restore") await restoreRelationship(userId, target);
  else if (move === "try_again") await tryAgainFor(userId, target);
  else if (kind === "deal") await setDealRelationship(userId, id.data, move);
  else await setContactRelationship(userId, id.data, move);
  revalidatePath("/", "layout");
  const back = formData.get("back");
  if (typeof back === "string" && CRM_PATH.test(back)) redirect(back);
}
