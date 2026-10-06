"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createInvestorAction, createRestaurantAction, updateDealAction } from "@/app/actions/deals";
import { describedBy, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { emptyFormState } from "@/lib/form-state";
import {
  FIRM_TYPE_LABELS,
  FIRM_TYPES,
  INVESTOR_TYPE_LABELS,
  INVESTOR_TYPES,
  PIPELINES,
  type InvestorType,
  type PipelineSection,
} from "@/lib/sections";

export type DealDefaults = {
  id?: string;
  name?: string;
  stage?: string;
  amount?: string;
  nextStep?: string;
  nextStepDate?: string;
  city?: string;
  cuisine?: string;
  neighborhood?: string;
  currentSupplier?: string;
  orderFrequency?: string;
  investorType?: InvestorType;
  email?: string;
  background?: string;
  firmType?: string;
  focusStage?: string;
  checkSize?: string;
  introducedBy?: string;
};

type DealFormProps = { section: PipelineSection; defaults?: DealDefaults; cancelHref: string };

export function DealForm({ section, defaults = {}, cancelHref }: DealFormProps) {
  const editing = Boolean(defaults.id);
  const action = editing ? updateDealAction : section === "restaurants" ? createRestaurantAction : createInvestorAction;
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const [pickedType, setPickedType] = useState<InvestorType | "">(defaults.investorType ?? "");
  const investorType = editing ? (defaults.investorType ?? "") : pickedType;
  const errors = state.errors;
  const submitted = Object.keys(state.values).length > 0;
  const v = (key: keyof DealDefaults) => (submitted ? (state.values[key] ?? "") : (defaults[key] ?? ""));

  const text = (key: keyof DealDefaults, label: string, extra: { type?: string; hint?: string; inputMode?: "decimal" } = {}) => (
    <FormField id={key} label={label} error={errors[key]} hint={extra.hint}>
      <Input
        id={key}
        name={key}
        type={extra.type}
        inputMode={extra.inputMode}
        defaultValue={v(key)}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={describedBy(key, errors[key], extra.hint)}
      />
    </FormField>
  );

  const stageItems = PIPELINES[section].stages.map((stage) => ({ value: stage.key, label: stage.label }));
  const typeItems = INVESTOR_TYPES.map((value) => ({ value, label: INVESTOR_TYPE_LABELS[value] }));
  const firmItems = FIRM_TYPES.map((value) => ({ value, label: FIRM_TYPE_LABELS[value] }));
  const noun = PIPELINES[section].noun;

  return (
    <form action={formAction} className="max-w-xl space-y-5" noValidate>
      {editing ? <input type="hidden" name="id" value={defaults.id} /> : null}
      {editing ? <input type="hidden" name="section" value={section} /> : null}

      {section === "investors" && !editing ? (
        <FormField id="investorType" label="Type" error={errors.investorType} hint="An angel is a person. An institution is a firm, with partners added later.">
          <Select
            name="investorType"
            items={typeItems}
            value={pickedType}
            onValueChange={(value) => setPickedType((value as InvestorType) ?? "")}
          >
            <SelectTrigger id="investorType" aria-invalid={errors.investorType ? true : undefined} aria-describedby="investorType-message">
              <SelectValue placeholder="Choose angel or institution" />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {typeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      ) : null}
      {section === "investors" && editing ? (
        <p className="text-sm text-muted-foreground">Type: {investorType ? INVESTOR_TYPE_LABELS[investorType] : "Unknown"} (fixed when added)</p>
      ) : null}

      {section === "investors" && !investorType ? null : (
        <>
          {text("name", investorType === "angel" ? "Name" : section === "restaurants" ? "Restaurant name" : "Firm name")}

          {section === "restaurants" ? (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                {text("city", "City")}
                {text("neighborhood", "Neighborhood")}
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                {text("cuisine", "Cuisine")}
                {text("orderFrequency", "Order frequency")}
              </div>
              {text("currentSupplier", "Current supplier")}
            </>
          ) : null}

          {investorType === "angel" ? (
            <>
              {text("email", "Email", { type: "email" })}
              <FormField id="background" label="Background" error={errors.background}>
                <Textarea id="background" name="background" defaultValue={v("background")} />
              </FormField>
            </>
          ) : null}

          {investorType === "institution" ? (
            <>
              <FormField id="firmType" label="Firm type" error={errors.firmType}>
                <Select name="firmType" items={firmItems} defaultValue={v("firmType") || "vc"}>
                  <SelectTrigger id="firmType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {firmItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <div className="grid gap-5 sm:grid-cols-2">
                {text("focusStage", "Focus stage")}
                {text("checkSize", "Check size range")}
              </div>
              {text("introducedBy", "Introduced by")}
            </>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-2">
            {text("amount", section === "restaurants" ? "Order value (USD)" : "Check size (USD)", { inputMode: "decimal" })}
            {editing ? (
              <FormField id="stage" label="Stage" error={errors.stage}>
                <Select name="stage" items={stageItems} defaultValue={v("stage") || stageItems[0].value}>
                  <SelectTrigger id="stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {stageItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}
          </div>
          <div className="grid gap-5 sm:grid-cols-[1fr_11rem]">
            {text("nextStep", "Next step")}
            {text("nextStepDate", "Next step date", { type: "date" })}
          </div>
        </>
      )}

      {state.message ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" disabled={pending || (section === "investors" && !investorType)}>
          {pending ? "Saving…" : editing ? "Save changes" : `Add ${noun}`}
        </Button>
        <Button variant="outline" size="lg" render={<Link href={cancelHref} />}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
