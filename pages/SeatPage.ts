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
  // Zone selection
  zoneContainer: '.zone-map, .zone-container, #zone-map',
  zoneItem: '.zone-item, [data-zone], .zone-btn',
  zoneSoldOut: '.zone-item.sold-out, [data-zone].disabled, .zone-unavailable',
  zoneAvailable: 'map area, map[name="Map"] area, map[name="uMap"] area',
  zoneLabel: 'href',

  // Seat selection
  seatMapContainer: '#tableseats, .map-zone, .seat-map',
  seatRow: '#tableseats tr, .seat-row, tr[data-row]',
  seatRowLabel: 'td.headrow, .row-label, [data-row-name]',
  seatAvailable: 'div.seatuncheck', // สำหรับ TTM ตัวที่เลือกได้จะมี class นี้
  seatSoldOut: 'td.not-available, div.seatnotavail', // ตัวที่เลือกไม่ได้

  quantitySelect: 'select[name="quantity"], #ticket-quantity',
  quantityMinus: '.qty-minus, button.decrease-qty',
  quantityPlus: '.qty-plus, button.increase-qty',
  quantityDisplay: '.qty-display, #quantity-value',

  proceedBtn: 'a#booknow',
} as const;

export class SeatPage {
  constructor(private page: Page) { }

  async waitForSeatMap(): Promise<void> {
    // รอแผนผังโซนหรือแผนผังที่นั่ง
    await this.page.waitForSelector(`${SEAT_LOCATORS.seatMapContainer}, ${SEAT_LOCATORS.zoneContainer}`, { state: 'attached', timeout: 30000 }).catch(() => {
      console.log('⚠️  ไม่พบหน้าผังอัตโนมัติ (หรืออาจจะยังโหลดไม่เสร็จ)');
    });
  }

  async getAvailableZones(): Promise<ZoneInfo[]> {
    const areas = this.page.locator(SEAT_LOCATORS.zoneAvailable);
    const count = await areas.count();
    const result: ZoneInfo[] = [];

    for (let i = 0; i < count; i++) {
      const area = areas.nth(i);
      const href = await area.getAttribute('href');

      let label = '';
      if (href && href.includes('#')) {
        label = href.split('#').pop() || '';
      }

      if (label) {
        const specificLocator = this.page.locator(`map area[href$="#${label}"]`)
        result.push({ label, locator: specificLocator });
        console.log(`🔍  พบโซนที่นั่ง: ${label}`);
      }
    }

    console.log(`🔍  สรุปพบทั้งหมด ${result.length} โซน: ${result.map(z => z.label).join(', ')}`);
    return result;
  }

  async selectZoneByLabel(label: string): Promise<boolean> {
    console.log(`🔍  กำลังพยายามเลือกโซน "${label}"...`);

    const zoneLocator = this.page.locator(`map area[href$="#${label}"]`);

    if (await zoneLocator.count() > 0) {
      console.log(`🔍  พบโซน "${label}" แล้ว กำลังส่งคำสั่ง Click Event...`);
      await zoneLocator.dispatchEvent('click');
      console.log(`✅  ส่งคำสั่งคลิกโซน "${label}" เรียบร้อย`);

      // รอให้หน้าเปลี่ยนหรือโหลดผังที่นั่ง
      await this.page.waitForLoadState('domcontentloaded').catch(() => { });
      return true;
    }

    console.log(`❌  ไม่พบโซน "${label}" ในหน้าเว็บ`);
    return false;
  }

  async selectFirstAvailableZone(): Promise<string | null> {
    const zones = await this.getAvailableZones();
    if (zones.length === 0) return null;
    const label = zones[0].label;
    await this.selectZoneByLabel(label);
    return label;
  }

  // async getAllSeatsByRow(): Promise<Map<string, SeatInfo[]>> {
  //   console.log('🔍  กำลังดึงข้อมูลที่นั่งว่าง...');
  //   const rows = this.page.locator(SEAT_LOCATORS.seatRow);
  //   const rowCount = await rows.count();
  //   const seatMap = new Map<string, SeatInfo[]>();

  //   for (let r = 0; r < rowCount; r++) {
  //     const row = rows.nth(r);

  //     // หาชื่อแถว (เช่น A, B, C)
  //     const headRow = row.locator(SEAT_LOCATORS.seatRowLabel);
  //     if (await headRow.count() === 0) continue;

  //     const rowLabel = (await headRow.first().innerText()).trim();
  //     if (!rowLabel) continue;

  //     // หาที่นั่งที่ว่างในแถวนี้
  //     const availableSeats = row.locator(SEAT_LOCATORS.seatAvailable);
  //     const seatCount = await availableSeats.count();
  //     const rowSeats: SeatInfo[] = [];

  //     for (let s = 0; s < seatCount; s++) {
  //       const seat = availableSeats.nth(s);
  //       const seatText = await seat.innerText();
  //       const seatIndex = parseInt(seatText.trim(), 10);

  //       if (!isNaN(seatIndex)) {
  //         rowSeats.push({
  //           row: rowLabel,
  //           index: seatIndex,
  //           locator: seat
  //         });
  //       }
  //     }

  //     if (rowSeats.length > 0) {
  //       seatMap.set(rowLabel, rowSeats);
  //       console.log(`   📍 แถว ${rowLabel}: พบที่นั่งว่าง ${rowSeats.length} ที่`);
  //     }
  //   }

  //   return seatMap;
  // }

  async getAllSeatsByRow(): Promise<Map<string, SeatInfo[]>> {
    console.log('🔍  กำลังดึงข้อมูลที่นั่งว่าง...');
    const scrapedData = await this.page.evaluate((locators) => {
      const rowElements = document.querySelectorAll(locators.seatRow);
      const results: { rowLabel: string, seats: { index: number, nth: number }[] }[] = [];
      
      rowElements.forEach((row) => {
        const headRow = row.querySelector(locators.seatRowLabel);
        if (!headRow) return;
        
        const rowLabel = (headRow as HTMLElement).innerText.trim();
        if (!rowLabel) return;
        
        const availableSeats = row.querySelectorAll(locators.seatAvailable);
        const rowSeats: { index: number, nth: number }[] = [];
        
        availableSeats.forEach((seat, idx) => {
          const seatText = (seat as HTMLElement).innerText.trim();
          const seatIndex = parseInt(seatText, 10);
          if (!isNaN(seatIndex)) {
            rowSeats.push({ index: seatIndex, nth: idx });
          }
        });
        
        if (rowSeats.length > 0) {
          results.push({ rowLabel, seats: rowSeats });
        }
      });
      
      return results;
    }, SEAT_LOCATORS);

    const seatMap = new Map<string, SeatInfo[]>();
    
    // แปลงข้อมูลที่ scrape ได้กลับเป็น SeatInfo พร้อม Locator
    for (const rowData of scrapedData) {
      const rowLocator = this.page.locator(SEAT_LOCATORS.seatRow).filter({ hasText: rowData.rowLabel }).first();
      const rowSeats: SeatInfo[] = rowData.seats.map(s => ({
        row: rowData.rowLabel,
        index: s.index,
        locator: rowLocator.locator(SEAT_LOCATORS.seatAvailable).nth(s.nth)
      }));
      
      seatMap.set(rowData.rowLabel, rowSeats);
      console.log(`   📍 แถว ${rowData.rowLabel}: พบที่นั่งว่าง ${rowSeats.length} ที่`);
    }

    return seatMap;
  }

  async clickSeat(seat: SeatInfo): Promise<void> {
    // ใช้ dispatchEvent เพื่อความชัวร์และเร็ว
    await seat.locator.dispatchEvent('click');
  }

  async setQuantity(quantity: number): Promise<void> {
    const selectEl = this.page.locator(SEAT_LOCATORS.quantitySelect);
    if (await selectEl.isVisible()) {
      await selectEl.selectOption(String(quantity));
      return;
    }

    const plusBtn = this.page.locator(SEAT_LOCATORS.quantityPlus);
    if (await plusBtn.isVisible()) {
      // เช็คจำนวนปัจจุบันก่อน
      const display = this.page.locator(SEAT_LOCATORS.quantityDisplay);
      let current = 1;
      if (await display.isVisible()) {
        current = parseInt(await display.innerText(), 10) || 1;
      }

      for (let i = 0; i < quantity - current; i++) {
        await plusBtn.click();
        // await this.page.waitForTimeout(100);
      }
    }
  }

  async clickProceed(): Promise<void> {
    console.log('🚀  กำลังกดยืนยันการเลือกที่นั่ง...');
    const btn = this.page.locator(SEAT_LOCATORS.proceedBtn).filter({ visible: true }).first();
    await btn.click();
    await this.page.waitForLoadState('domcontentloaded');
  }
}
