export type BoardCard = { id: string; stage: string; sortKey: number };

/**
 * Where a dropped card lands. `overCardId` is the card it was dropped on (it goes just before
 * that card); null means the empty space of the column (it goes to the end).
 * Returns the new sort key, computed from the target column without the dragged card.
 */
export function dropSortKey(cards: BoardCard[], draggedId: string, stage: string, overCardId: string | null): number {
  const column = cards
    .filter((card) => card.stage === stage && card.id !== draggedId)
    .sort((a, b) => a.sortKey - b.sortKey);
  if (overCardId === null) return (column.at(-1)?.sortKey ?? 0) + 1;
  const index = column.findIndex((card) => card.id === overCardId);
  if (index === -1) return (column.at(-1)?.sortKey ?? 0) + 1;
  const next = column[index].sortKey;
  const previous = index === 0 ? next - 2 : column[index - 1].sortKey;
  return (previous + next) / 2;
}

/** Returns the cards with one moved, for optimistic updates. */
export function moveCard<T extends BoardCard>(cards: T[], id: string, stage: string, sortKey: number): T[] {
  return cards.map((card) => (card.id === id ? { ...card, stage, sortKey } : card));
}
