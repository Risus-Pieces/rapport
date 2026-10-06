export type BoardCard = { id: string; stage: string; sortKey: number };

const byKey = (a: BoardCard, b: BoardCard) => a.sortKey - b.sortKey;

/**
 * Where a dropped card lands. `overCardId` is the card it was dropped on; null means the empty
 * space of the column (the end). Dropping on a card puts the dragged card in that card's slot:
 * before it when coming from below or another column, after it when moving down in the same
 * column. Returns the new sort key.
 */
export function dropSortKey(cards: BoardCard[], draggedId: string, stage: string, overCardId: string | null): number {
  const dragged = cards.find((card) => card.id === draggedId);
  const full = cards.filter((card) => card.stage === stage).sort(byKey);
  const column = full.filter((card) => card.id !== draggedId);
  const end = (column.at(-1)?.sortKey ?? 0) + 1;
  if (overCardId === null) return end;
  const index = column.findIndex((card) => card.id === overCardId);
  if (index === -1) return end;

  const movingDown =
    dragged?.stage === stage &&
    full.findIndex((card) => card.id === draggedId) !== -1 &&
    full.findIndex((card) => card.id === draggedId) < full.findIndex((card) => card.id === overCardId);
  if (movingDown) {
    const after = column[index].sortKey;
    const next = column[index + 1]?.sortKey;
    return next === undefined ? after + 1 : (after + next) / 2;
  }
  const next = column[index].sortKey;
  const previous = index === 0 ? next - 2 : column[index - 1].sortKey;
  return (previous + next) / 2;
}

/** Returns the cards with one moved, for optimistic updates. */
export function moveCard<T extends BoardCard>(cards: T[], id: string, stage: string, sortKey: number): T[] {
  return cards.map((card) => (card.id === id ? { ...card, stage, sortKey } : card));
}

/** True when two neighbouring keys are so close that another halving could collapse them. */
export function needsRenumber(sortedKeys: number[], epsilon = 1e-6): boolean {
  return sortedKeys.some((key, i) => i > 0 && key - sortedKeys[i - 1] < epsilon);
}
