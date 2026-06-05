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

export type SeatMode = 
  | 'FRONT_LEFT' 
  | 'FRONT_RIGHT' 
  | 'BACK_LEFT' 
  | 'BACK_RIGHT' 
  | 'CENTER' 
  | 'RANDOM' 
  | 'ANY_RANDOM';

export function selectSeats(input: {
  seatsByRow: Map<string, SeatInfo[]>;
  quantity: number;
  zone: string;
  excludeSet: Set<string>;
  mode?: SeatMode;
}): SeatSelectionResult {
  const { seatsByRow, quantity, zone, excludeSet, mode = 'FRONT_LEFT' } = input;

  // 1. ดึงแถวทั้งหมดและกรองที่นั่งที่ติด Lock/Dead ออก
  const availableRowsMap = new Map<string, SeatInfo[]>();
  for (const [rowLabel, seats] of seatsByRow.entries()) {
    const filtered = seats.filter(s => !excludeSet.has(`${zone}-${s.row}-${s.index}`));
    if (filtered.length > 0) {
      availableRowsMap.set(rowLabel, filtered);
    }
  }

  const rowLabels = [...availableRowsMap.keys()];
  if (rowLabels.length === 0) return { selected: [], success: false };

  // 2. จัดลำดับแถวตาม Mode
  if (mode.startsWith('FRONT')) {
    rowLabels.sort(); // A -> Z
  } else if (mode.startsWith('BACK')) {
    rowLabels.sort().reverse(); // Z -> A
  } else if (mode === 'RANDOM' || mode === 'ANY_RANDOM') {
    rowLabels.sort(() => Math.random() - 0.5);
  }

  // 3. โหมด ANY_RANDOM: เลือกที่ไหนก็ได้ให้ครบจำนวน (ไม่เน้นติดกัน)
  if (mode === 'ANY_RANDOM') {
    const allAvailableSeats: SeatInfo[] = [];
    for (const label of rowLabels) {
      allAvailableSeats.push(...(availableRowsMap.get(label) || []));
    }
    if (allAvailableSeats.length >= quantity) {
      // สุ่มเลือก N ที่จากทั้งหมด
      const shuffled = allAvailableSeats.sort(() => Math.random() - 0.5);
      return { selected: shuffled.slice(0, quantity), success: true };
    }
    return { selected: [], success: false };
  }

  // 4. โหมดอื่นๆ: ค้นหาที่นั่งที่ "ติดกัน"
  for (const rowLabel of rowLabels) {
    const seats = availableRowsMap.get(rowLabel) || [];
    if (seats.length < quantity) continue;

    // จัดลำดับที่นั่งในแถว (ซ้ายไปขวา หรือ ขวาไปซ้าย)
    let sortedSeats = [...seats].sort((a, b) => a.index - b.index);
    if (mode.endsWith('RIGHT')) {
      sortedSeats.reverse();
    }

    // หาลิสต์ของกลุ่มที่นั่งติดกันที่เป็นไปได้ทั้งหมดในแถวนี้
    const possibleGroups: SeatInfo[][] = [];
    // สำหรับการเช็คติดกัน เราต้องใช้เลข index จริงๆ ดังนั้นต้อง sort แบบ ascending เสมอเพื่อหาความต่อเนื่อง
    const ascendingSeats = [...seats].sort((a, b) => a.index - b.index);
    
    for (let i = 0; i <= ascendingSeats.length - quantity; i++) {
      const group = ascendingSeats.slice(i, i + quantity);
      const isConsecutive = group.every((s, idx) => idx === 0 || s.index === group[idx - 1].index + 1);
      if (isConsecutive) {
        possibleGroups.push(group);
      }
    }

    if (possibleGroups.length === 0) continue;

    // เลือกกลุ่มที่นั่งตาม Mode
    if (mode.endsWith('LEFT')) {
      // เอากลุ่มที่เลขที่นั่งน้อยที่สุด (ซ้ายสุด)
      possibleGroups.sort((a, b) => a[0].index - b[0].index);
      return { selected: possibleGroups[0], success: true };
    } 
    else if (mode.endsWith('RIGHT')) {
      // เอากลุ่มที่เลขที่นั่งมากที่สุด (ขวาสุด)
      possibleGroups.sort((a, b) => b[0].index - a[0].index);
      return { selected: possibleGroups[0], success: true };
    }
    else if (mode === 'CENTER') {
      // หากลุ่มที่อยู่ใกล้กึ่งกลางของแถวมากที่สุด
      // คำนวณหาค่าเฉลี่ย index ของที่นั่งทั้งหมดในแถวนี้ (ทั้งที่ว่างและไม่ว่าง) เพื่อหาจุดกึ่งกลางแถว
      // แต่ในที่นี้เราเอาค่ากึ่งกลางจาก min/max ของที่นั่งที่ "เห็น" ในแถวนี้แทน
      const minIdx = ascendingSeats[0].index;
      const maxIdx = ascendingSeats[ascendingSeats.length - 1].index;
      const midPoint = (minIdx + maxIdx) / 2;

      possibleGroups.sort((a, b) => {
        const avgA = a.reduce((sum, s) => sum + s.index, 0) / a.length;
        const avgB = b.reduce((sum, s) => sum + s.index, 0) / b.length;
        return Math.abs(avgA - midPoint) - Math.abs(avgB - midPoint);
      });
      return { selected: possibleGroups[0], success: true };
    }
    else if (mode === 'RANDOM') {
      // สุ่มเลือกมาหนึ่งกลุ่มจากแถวนี้
      const randomIdx = Math.floor(Math.random() * possibleGroups.length);
      return { selected: possibleGroups[randomIdx], success: true };
    }
  }

  return { selected: [], success: false };
}
