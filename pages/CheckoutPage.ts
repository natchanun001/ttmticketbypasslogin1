import type { Page } from '@playwright/test';

export const CHECKOUT_LOCATORS = {
  deliveryPickup: 'a#btn_pickup',
  deliveryPostal: 'a#btn_thaipost',
  deliveryEticket: 'a#btn_eticket',
  paymentQR: 'a#btn_kbankqr',
  paymentCreditCard: 'a#btn_creditcard',
  confirmBtn: 'button#btn_confirm',
  termsCheckbox: 'label#checkagree',
  qrImage: 'div.qr-code-contriner img.img-full-width',
  qrContainer: 'div.qr-code-contriner',
  paymentExpiry: 'div.qr-code-expire-time',
} as const;

export class CheckoutPage {
  constructor(private page: Page) { }

  async selectDeliveryMethod(method: 'pickup' | 'postal' | 'eticket'): Promise<void> {
    const selector = method === 'pickup' ? CHECKOUT_LOCATORS.deliveryPickup : method === 'postal' ? CHECKOUT_LOCATORS.deliveryPostal : CHECKOUT_LOCATORS.deliveryEticket;
    const el = this.page.locator(selector).first();
    if (await el.isVisible()) {
      await el.click();
    }
  }

  async selectPaymentMethod(method: 'qr' | 'credit'): Promise<void> {
    const selector = method === 'qr' ? CHECKOUT_LOCATORS.paymentQR : CHECKOUT_LOCATORS.paymentCreditCard;
    const el = this.page.locator(selector).first();
    if (await el.isVisible()) {
      await el.click();
    }
  }

  async acceptTermsIfRequired(): Promise<void> {
    const checkbox = this.page.locator(CHECKOUT_LOCATORS.termsCheckbox);
    if (await checkbox.isVisible() && !(await checkbox.isChecked())) {
      await checkbox.check();
    }
  }

  async confirmOrder(): Promise<void> {
    await this.page.click(CHECKOUT_LOCATORS.confirmBtn);
    await this.page.waitForLoadState('domcontentloaded');
  }

  async waitForQR(timeoutMs = 30000): Promise<void> {
    await this.page.waitForSelector(CHECKOUT_LOCATORS.qrContainer, {
      state: 'visible',
      timeout: timeoutMs,
    }).then(() => {
      console.log('✅  พบ QR Payment อัตโนมัติ');
    }).catch(() => {
      console.log('⚠️  ไม่พบ QR Payment อัตโนมัติ');
    });
  }
}
