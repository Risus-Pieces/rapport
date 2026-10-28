"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteCompany } from "@/db/queries/companies";
import { createContact, deleteContact } from "@/db/queries/contacts";
import {
  createInvestorDeal,
  createRestaurantDeal,
  DealError,
  getDeal,
  moveDeal,
  updateInvestorDeal,
  updateRestaurantDeal,
} from "@/db/queries/deals";
import { contactSchema } from "@/lib/validation/contact";
import { isPipelineSection } from "@/lib/sections";
import { getScope } from "@/lib/scope";
import { fieldErrors, formToObject, uuid } from "@/lib/validation/common";
import { investorSchema, investorUpdateSchema, restaurantSchema } from "@/lib/validation/deal";
import type { FormState } from "@/lib/form-state";

function refreshAll() {
  revalidatePath("/", "layout");
}

function failed(values: Record<string, string>, errors: Record<string, string>, message: string | null = null): FormState {
  return { errors, message, saved: 0, values };
}

export async function createRestaurantAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { workspaceId } = await getScope();
  const values = formToObject(formData);
  const parsed = restaurantSchema.safeParse(values);
  if (!parsed.success) return failed(values, fieldErrors(parsed.error));
  let id: string;
  try {
    id = (await createRestaurantDeal(workspaceId, parsed.data)).id;
  } catch (error) {
    console.error("createRestaurantAction failed:", error instanceof Error ? error.message : error);
    return failed(values, {}, "Could not save. Try again.");
  }
  refreshAll();
  redirect(`/restaurants/${id}`);
}

export async function createInvestorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { workspaceId } = await getScope();
  const values = formToObject(formData);
  const parsed = investorSchema.safeParse(values);
  if (!parsed.success) return failed(values, fieldErrors(parsed.error));
  let id: string;
  try {
    id = (await createInvestorDeal(workspaceId, parsed.data)).id;
  } catch (error) {
    if (error instanceof DealError) return failed(values, {}, error.message);
    console.error("createInvestorAction failed:", error instanceof Error ? error.message : error);
    return failed(values, {}, "Could not save. Try again.");
  }
  refreshAll();
  redirect(`/investors/${id}`);
}

export async function updateDealAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { workspaceId } = await getScope();
  const values = formToObject(formData);
  const id = uuid.safeParse(values.id);
  if (!id.success || !isPipelineSection(values.section ?? "")) return failed(values, {}, "That deal could not be found.");
  const stage = values.stage ?? "";
  const savedSection = values.section as "restaurants" | "investors";
  try {
    if (savedSection === "restaurants") {
      const parsed = restaurantSchema.safeParse(values);
      if (!parsed.success) return failed(values, fieldErrors(parsed.error));
      if (!(await updateRestaurantDeal(workspaceId, id.data, { ...parsed.data, stage }))) {
        return failed(values, {}, "That deal no longer exists.");
      }
    } else {
      // The investor type is fixed at creation; the form does not change it.
      const parsed = investorUpdateSchema.safeParse(values);
      if (!parsed.success) return failed(values, fieldErrors(parsed.error));
      if (!(await updateInvestorDeal(workspaceId, id.data, { ...parsed.data, stage }))) {
        return failed(values, {}, "That deal no longer exists.");
      }
    }
  } catch (error) {
    if (error instanceof DealError) return failed(values, {}, error.message);
    console.error("updateDealAction failed:", error instanceof Error ? error.message : error);
    return failed(values, {}, "Could not save. Try again.");
  }
  refreshAll();
  redirect(`/${savedSection}/${id.data}`);
}

export type MoveResult = { ok: true } | { ok: false; message: string };

// Called by the board after a drop; the board has already moved the card and rolls back on failure.
export async function moveDealAction(id: string, stage: string, sortKey: number): Promise<MoveResult> {
  const { workspaceId } = await getScope();
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return { ok: false, message: "That deal could not be found." };
  try {
    const moved = await moveDeal(workspaceId, parsed.data, stage, sortKey);
    if (!moved) return { ok: false, message: "That deal no longer exists." };
  } catch (error) {
    if (error instanceof DealError) return { ok: false, message: error.message };
    console.error("moveDealAction failed:", error instanceof Error ? error.message : error);
    return { ok: false, message: "Could not move the card. Try again." };
  }
  refreshAll();
  return { ok: true };
}

// Removes the investor or restaurant entirely: an institution or restaurant (company) with its
// deals and activities, or an angel (contact) with their deal and activities.
export async function deleteDealPartyAction(formData: FormData) {
  const { workspaceId } = await getScope();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  const deal = await getDeal(workspaceId, id.data);
  if (!deal || deal.section === "general") return;
  if (deal.companyId) await deleteCompany(workspaceId, deal.companyId);
  else if (deal.contactId) await deleteContact(workspaceId, deal.section, deal.contactId);
  refreshAll();
  redirect(`/${deal.section}`);
}

// Adds a person (an owner, chef or partner) to the deal's company.
export async function addPersonAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { workspaceId } = await getScope();
  const values = formToObject(formData);
  const id = uuid.safeParse(values.dealId);
  if (!id.success) return failed(values, {}, "That deal could not be found.");
  const deal = await getDeal(workspaceId, id.data);
  if (!deal || deal.section === "general" || !deal.companyId) return failed(values, {}, "That deal has no company to attach people to.");
  const parsed = contactSchema.safeParse({ name: values.name, title: values.title, email: values.email, companyId: deal.companyId });
  if (!parsed.success) return failed(values, fieldErrors(parsed.error));
  try {
    await createContact(workspaceId, deal.section, parsed.data);
  } catch (error) {
    console.error("addPersonAction failed:", error instanceof Error ? error.message : error);
    return failed(values, {}, "Could not save. Try again.");
  }
  refreshAll();
  return { errors: {}, message: null, saved: Date.now(), values: {} };
}
