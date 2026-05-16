import type { Page, Locator } from '@playwright/test';

export interface ZoneInfo {
  label: string;
  locator: Locator;
}

export interface SeatInfo {
  row: string;
  index: number;
  locator: Locator;
}

export const SEAT_LOCATORS = {
  zoneContainer:      '.zone-map, .zone-container, #zone-map',
  zoneItem:           '.zone-item, [data-zone], .zone-btn',
  zoneSoldOut:        '.zone-item.sold-out, [data-zone].disabled, .zone-unavailable',
  zoneAvailable:      '.zone-item:not(.sold-out), [data-zone]:not(.disabled)',
  zoneLabel:          '.zone-name, [data-zone-name]',

  seatMapContainer:   '.seat-map, #seat-map, .seat-container',
  seatRow:            '.seat-row, tr[data-row], .row-container',
  seatRowLabel:       '.row-label, [data-row-name], td.row-number',
  seatItem:           '.seat, td[data-seat], .seat-btn',
  seatAvailable:      '.seat.available, td[data-seat].available, .seat-btn:not(.sold):not(.reserved)',
  seatSelected:       '.seat.selected, td[data-seat].selected, .seat-btn.active',
  seatSoldOut:        '.seat.sold, .seat.reserved, td[data-seat].unavailable',

  quantitySelect:     'select[name="quantity"], #ticket-quantity',
  quantityMinus:      '.qty-minus, button.decrease-qty',
  quantityPlus:       '.qty-plus, button.increase-qty',
  quantityDisplay:    '.qty-display, #quantity-value',

  proceedBtn:         '.btn-proceed, button:has-text("ดำเนินการต่อ"), button:has-text("Proceed")',
} as const;

export class SeatPage {
  constructor(private page: Page) {}

  async waitForSeatMap(): Promise<void> {
    await this.page.waitForSelector(SEAT_LOCATORS.seatMapContainer, { state: 'visible', timeout: 30000 }).catch(() => {
        console.log('⚠️  ไม่พบหน้าผังที่นั่งอัตโนมัติ (หรืออาจจะยังโหลดไม่เสร็จ)');
    });
  }

  async getAvailableZones(): Promise<ZoneInfo[]> {
    const zones = this.page.locator(SEAT_LOCATORS.zoneAvailable);
    const count = await zones.count();
    const result: ZoneInfo[] = [];

    for (let i = 0; i < count; i++) {
      const zone = zones.nth(i);
      const label = (await zone.getAttribute('data-zone-name')) ??
                    (await zone.getAttribute('data-zone')) ??
                    (await zone.innerText()).trim();
      result.push({ label, locator: zone });
    }

    return result;
  }

  async selectZoneByLabel(label: string): Promise<boolean> {
    const zones = await this.getAvailableZones();
    const match = zones.find((z) =>
      z.label.trim().toUpperCase() === label.trim().toUpperCase(),
    );

    if (!match) {
      return false;
    }

    await match.locator.click();
    await this.page.waitForLoadState('domcontentloaded');
    return true;
  }

  async selectFirstAvailableZone(): Promise<string | null> {
    const zones = await this.getAvailableZones();
    if (zones.length === 0) return null;
    const label = zones[0].label;
    await zones[0].locator.click();
    await this.page.waitForLoadState('domcontentloaded');
    return label;
  }

  async getAllSeatsByRow(): Promise<Map<string, SeatInfo[]>> {
    const rows = this.page.locator(SEAT_LOCATORS.seatRow);
    const rowCount = await rows.count();
    const seatMap = new Map<string, SeatInfo[]>();

    for (let r = 0; r < rowCount; r++) {
      const row = rows.nth(r);
      const rowLabel = (await row.getAttribute('data-row')) ??
                       (await row.locator(SEAT_LOCATORS.seatRowLabel).innerText().catch(() => String(r)));

      const seats = row.locator(SEAT_LOCATORS.seatAvailable);
      const seatCount = await seats.count();
      const rowSeats: SeatInfo[] = [];

      for (let s = 0; s < seatCount; s++) {
        rowSeats.push({ row: rowLabel.trim(), index: s, locator: seats.nth(s) });
      }

      if (rowSeats.length > 0) {
        seatMap.set(rowLabel.trim(), rowSeats);
      }
    }

    return seatMap;
  }

  async clickSeat(seat: SeatInfo): Promise<void> {
    await seat.locator.click();
  }

  async setQuantity(quantity: number): Promise<void> {
    const selectEl = this.page.locator(SEAT_LOCATORS.quantitySelect);
    if (await selectEl.isVisible()) {
      await selectEl.selectOption(String(quantity));
      return;
    }

    const plusBtn = this.page.locator(SEAT_LOCATORS.quantityPlus);
    if (await plusBtn.isVisible()) {
      for (let i = 0; i < quantity - 1; i++) {
        await plusBtn.click();
      }
    }
  }

  async clickProceed(): Promise<void> {
    await this.page.click(SEAT_LOCATORS.proceedBtn);
    await this.page.waitForLoadState('domcontentloaded');
  }
}
