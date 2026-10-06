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
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
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

function DealCard({ deal, section, locked }: { deal: BoardDeal; section: PipelineSection; locked: boolean }) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: deal.id, disabled: locked });
  const { setNodeRef: setDropRef } = useDroppable({ id: `card:${deal.id}` });
  return (
    <li
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      {...attributes}
      {...listeners}
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

function Column({ stageKey, label, outcome, deals, section, locked }: { stageKey: string; label: string; outcome: string; deals: BoardDeal[]; section: PipelineSection; locked: boolean }) {
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
          <DealCard key={deal.id} deal={deal} section={section} locked={locked} />
        ))}
        {deals.length === 0 ? <li className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">Drop here</li> : null}
      </ul>
    </section>
  );
}

// Arrow left/right jump to the neighbouring stage; up/down nudge within the column.
const coordinateGetter: KeyboardCoordinateGetter = (event, { context: { droppableContainers, collisionRect } }) => {
  if (!collisionRect) return undefined;
  const { code } = event;
  if (code === "ArrowDown" || code === "ArrowUp") {
    event.preventDefault();
    return { x: collisionRect.left, y: collisionRect.top + (code === "ArrowDown" ? 72 : -72) };
  }
  if (code !== "ArrowLeft" && code !== "ArrowRight") return undefined;
  event.preventDefault();
  const columns = droppableContainers
    .getEnabled()
    .filter((container) => String(container.id).startsWith("column:") && container.rect.current)
    .map((container) => container.rect.current!)
    .sort((a, b) => a.left - b.left);
  const centre = collisionRect.left + collisionRect.width / 2;
  const current = columns.findIndex((rect) => centre >= rect.left && centre <= rect.left + rect.width);
  const next = columns[current === -1 ? 0 : current + (code === "ArrowRight" ? 1 : -1)];
  return next ? { x: next.left + 12, y: next.top + 24 } : undefined;
};

export function Board({ section, deals: initial, locked = false }: { section: PipelineSection; deals: BoardDeal[]; locked?: boolean }) {
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
    useSensor(KeyboardSensor, { coordinateGetter }),
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
    const previous = deals.find((d) => d.id === id);
    if (!previous) return;
    setDeals(moveCard(deals, id, stage, sortKey));
    startTransition(async () => {
      const result = await moveDealAction(id, stage, sortKey);
      if (!result.ok) {
        // Undo only this card, so a later move that succeeded is not rolled back with it.
        setDeals((current) => moveCard(current, id, previous.stage, previous.sortKey));
        toast.error(result.message);
      }
    });
  }

  const active = deals.find((d) => d.id === activeId) ?? null;
  const stageLabel = (id: string | number) => {
    const key = String(id);
    if (key.startsWith("column:")) return stages.find((st) => st.key === key.slice(7))?.label ?? "a stage";
    const card = deals.find((d) => d.id === key.slice(5));
    return card ? `before ${card.title}` : "a card";
  };
  const title = (id: string | number) => deals.find((d) => d.id === String(id))?.title ?? "card";
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${title(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${title(active.id)} is over ${stageLabel(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `${title(active.id)} was dropped on ${stageLabel(over.id)}.` : `${title(active.id)} was dropped.`),
    onDragCancel: ({ active }) => `Moving ${title(active.id)} was cancelled.`,
  };

  return (
    <DndContext id={`board-${section}`} accessibility={{ announcements, screenReaderInstructions: { draggable: "Press space to pick up this card. Left and right arrows change stage, up and down reorder, space drops it, escape cancels." } }} sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      {locked ? <p className="mb-3 text-sm text-muted-foreground">Clear the search or filter to rearrange cards.</p> : null}
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
        {stages.map((stage) => (
          <Column
            key={stage.key}
            stageKey={stage.key}
            label={stage.label}
            outcome={stage.outcome}
            section={section}
            locked={locked}
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
