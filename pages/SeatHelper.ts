import { SeatPage, SeatInfo, ZoneInfo } from './SeatPage';

export interface SeatSelectionResult {
  selected: SeatInfo[];
  success: boolean;
}

export async function selectZone(
  seatPage: SeatPage,
  zonePriority: string[],
): Promise<string | null> {
  const available: ZoneInfo[] = await seatPage.getAvailableZones();

  if (available.length === 0) {
    return null;
  }

  // 1. Try zones in priority order
  for (const preferredZone of zonePriority) {
    const found = await seatPage.selectZoneByLabel(preferredZone);
    if (found) {
      return preferredZone;
    }
  }

  // 2. Fallback: first available zone
  return await seatPage.selectFirstAvailableZone();
}

export function selectSeats(input: {
  seatsByRow: Map<string, SeatInfo[]>;
  quantity: number;
}): SeatSelectionResult {
  const { seatsByRow, quantity } = input;

  // Simple strategy: take the first row that has enough consecutive seats
  const rows = [...seatsByRow.keys()].sort();

  for (const rowLabel of rows) {
    const seats = seatsByRow.get(rowLabel) ?? [];
    if (seats.length < quantity) continue;

    const sorted = [...seats].sort((a, b) => a.index - b.index);

    // Find consecutive seats
    for (let i = 0; i <= sorted.length - quantity; i++) {
      const group = sorted.slice(i, i + quantity);
      const isAdjacent = group.every(
        (s, j) => j === 0 || s.index === group[j - 1].index + 1,
      );
      if (isAdjacent) {
        return { selected: group, success: true };
      }
    }
  }

  return { selected: [], success: false };
}
