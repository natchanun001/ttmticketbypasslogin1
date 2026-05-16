import type { Page } from '@playwright/test';

export const CHECKOUT_LOCATORS = {
  deliveryPickup:     'input[value="pickup"], input[value="self_pickup"], label:has-text("รับที่งาน") input',
  deliveryPostal:     'input[value="postal"], input[value="delivery"], label:has-text("จัดส่ง") input',
  paymentQR:          'input[value="qr"], input[value="qr_promptpay"], label:has-text("QR") input',
  paymentCreditCard:  'input[value="credit"], input[value="credit_card"], label:has-text("Credit") input',
  confirmBtn:         'button[type="submit"].btn-confirm, .btn-confirm-order, button:has-text("ยืนยัน"), button:has-text("Confirm")',
  termsCheckbox:      'input[name="terms"], input[type="checkbox"].terms-agree',
  qrImage:            '.qr-code img, .payment-qr img, #qr-promptpay img',
  qrContainer:        '.qr-code, .payment-qr, #qr-payment-container',
  paymentExpiry:      '.payment-expiry, .qr-expiry, .time-remaining',
} as const;

export class CheckoutPage {
  constructor(private page: Page) {}

  async selectDeliveryMethod(method: 'pickup' | 'postal'): Promise<void> {
    const selector = method === 'pickup' ? CHECKOUT_LOCATORS.deliveryPickup : CHECKOUT_LOCATORS.deliveryPostal;
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
    }).catch(() => {
        console.log('⚠️  ไม่พบ QR Payment อัตโนมัติ');
    });
  }
}
