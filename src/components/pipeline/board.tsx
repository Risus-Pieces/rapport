"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { moveDealAction } from "@/app/actions/deals";
import { dropSortKey, moveCard } from "@/lib/board";
import { formatCents } from "@/lib/money";
import { INVESTOR_TYPE_LABELS, investorTypeOf, PIPELINES, type PipelineSection } from "@/lib/sections";
import { formatDay } from "@/lib/dates";
import { cn } from "@/lib/utils";

export type BoardDeal = {
  id: string;
  title: string;
  stage: string;
  sortKey: number;
  amountCents: number | null;
  nextStep: string | null;
  nextStepDate: string | null;
  details: Record<string, unknown>;
};

function CardBody({ deal, section }: { deal: BoardDeal; section: PipelineSection }) {
  const type = investorTypeOf(deal.details);
  return (
    <div className="space-y-1">
      <p className="font-medium">{deal.title}</p>
      <p className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
        {section === "investors" && type ? <span>{INVESTOR_TYPE_LABELS[type]}</span> : null}
        {deal.amountCents !== null ? <span>{formatCents(deal.amountCents)}</span> : null}
      </p>
      {deal.nextStep ? (
        <p className="text-sm text-muted-foreground">
          Next: {deal.nextStep}
          {deal.nextStepDate ? ` · ${formatDay(deal.nextStepDate)}` : ""}
        </p>
      ) : null}
    </div>
  );
}

function DealCard({ deal, section }: { deal: BoardDeal; section: PipelineSection }) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: deal.id });
  const { setNodeRef: setDropRef } = useDroppable({ id: `card:${deal.id}` });
  return (
    <li
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      {...attributes}
      {...listeners}
      aria-label={`${deal.title}. Press space to pick up, then use arrow keys to move between stages.`}
      className={cn(
        "touch-manipulation rounded-xl border border-border bg-card p-3 transition-colors hover:border-input",
        isDragging && "opacity-40",
      )}
    >
      <Link href={`/${section}/${deal.id}`} className="block rounded-lg" draggable={false}>
        <CardBody deal={deal} section={section} />
      </Link>
    </li>
  );
}

function Column({ stageKey, label, outcome, deals, section }: { stageKey: string; label: string; outcome: string; deals: BoardDeal[]; section: PipelineSection }) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${stageKey}` });
  return (
    <section
      aria-labelledby={`stage-${stageKey}`}
      className={cn(
        "flex w-72 shrink-0 snap-start flex-col rounded-2xl border bg-secondary/40 p-3",
        isOver ? "border-primary ring-1 ring-primary" : "border-border",
      )}
    >
      <h3 id={`stage-${stageKey}`} className="mb-3 flex items-center justify-between px-1 text-sm font-medium">
        <span>
          {label}
          {outcome !== "open" ? <span className="ml-2 text-muted-foreground">({outcome})</span> : null}
        </span>
        <span className="text-muted-foreground">{deals.length}</span>
      </h3>
      <ul ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2">
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} section={section} />
        ))}
        {deals.length === 0 ? <li className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">Drop here</li> : null}
      </ul>
    </section>
  );
}

export function Board({ section, deals: initial }: { section: PipelineSection; deals: BoardDeal[] }) {
  const [deals, setDeals] = useState(initial);
  const [syncedFrom, setSyncedFrom] = useState(initial);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Adopt fresh server data (after a refresh) without an effect.
  if (initial !== syncedFrom) {
    setSyncedFrom(initial);
    setDeals(initial);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const stages = PIPELINES[section].stages;

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const id = String(active.id);
    const overId = String(over.id);
    let stage: string;
    let overCard: string | null = null;
    if (overId.startsWith("column:")) {
      stage = overId.slice("column:".length);
    } else {
      overCard = overId.slice("card:".length);
      const target = deals.find((d) => d.id === overCard);
      if (!target) return;
      stage = target.stage;
      if (overCard === id) return;
    }
    const sortKey = dropSortKey(deals, id, stage, overCard);
    const before = deals;
    setDeals(moveCard(deals, id, stage, sortKey));
    startTransition(async () => {
      const result = await moveDealAction(id, stage, sortKey);
      if (!result.ok) {
        setDeals(before);
        toast.error(result.message);
      }
    });
  }

  const active = deals.find((d) => d.id === activeId) ?? null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
        {stages.map((stage) => (
          <Column
            key={stage.key}
            stageKey={stage.key}
            label={stage.label}
            outcome={stage.outcome}
            section={section}
            deals={deals.filter((d) => d.stage === stage.key).sort((a, b) => a.sortKey - b.sortKey)}
          />
        ))}
      </div>
      <DragOverlay>
        {active ? (
          <div className="rounded-xl border border-primary bg-card p-3">
            <CardBody deal={active} section={section} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
