import { Platform } from 'react-native';
import Purchases, { PurchasesOffering, CustomerInfo } from 'react-native-purchases';
import { REVENUECAT_IOS_KEY, REVENUECAT_ANDROID_KEY } from '../config';

// RevenueCat wrapper. Purchases flow: the user buys a product on the App Store /
// Play Store; RevenueCat records the entitlement and POSTs a webhook to the
// server (server/src/routes/billing.js → /api/billing/webhook), which flips the
// household's plan. We set the RevenueCat app_user_id to the household id so the
// webhook can map the purchase back to the right household.

const apiKey = Platform.OS === 'ios' ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;

export function isPurchasesConfigured(): boolean {
  return Boolean(apiKey);
}

let configured = false;

// Initialize once with the household as the app_user_id. No-op if keys are
// missing (e.g. running in Expo Go / before store setup).
export function configurePurchases(appUserId: string): void {
  if (!apiKey || configured) return;
  Purchases.configure({ apiKey, appUserID: appUserId });
  configured = true;
}

export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.current ?? null;
}

// Record which household member is buying. All members share one app_user_id
// (the household), so this subscriber attribute — set just before purchase and
// carried on the webhook event — is the only signal of who the purchaser is.
export async function setPurchaserAttribute(userId: string): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.setAttributes({ purchaser_user_id: userId });
  } catch {
    // Attribution is best-effort; never block a purchase on it.
  }
}

// Purchase a package; resolves with the updated CustomerInfo. The plan change
// itself is applied server-side via the webhook, so callers should refetch
// billing status afterwards.
export async function purchasePackage(
  pkg: Parameters<typeof Purchases.purchasePackage>[0]
): Promise<CustomerInfo> {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo;
}

export async function restorePurchases(): Promise<CustomerInfo | null> {
  if (!configured) return null;
  return Purchases.restorePurchases();
}
