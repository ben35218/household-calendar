// Shared pieces of the plan/billing surfaces (the inline plan cards on
// ProfileHome, ComparePlans, AiUsage, UpsellSheet): formatting helpers, the
// RevenueCat package↔tier mapping, and the usePurchase hook that owns the buy flow.

import { useEffect, useMemo, useState } from 'react';
import { Alert, Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import type { BillingStatus } from '../../api';
import { useAuth } from '../../store/auth';
import { useBilling, usePlanActivation } from '../../hooks/useBilling';
import {
  isPurchasesConfigured,
  configurePurchases,
  getCurrentOffering,
  purchasePackage,
  restorePurchases,
  setPurchaserAttribute,
} from '../../lib/purchases';

export type CatalogTier = BillingStatus['catalog'][number];

export const STORE_NAME = Platform.OS === 'ios' ? 'App Store' : 'Google Play';

export const MANAGE_SUBSCRIPTIONS_URL = Platform.select({
  ios: 'https://apps.apple.com/account/subscriptions',
  default: 'https://play.google.com/store/account/subscriptions',
});

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The server resets usage every Wednesday at 5PM Eastern and returns that next
// reset instant. Render it in the device's own timezone: how many whole days
// remain, plus the local weekday + clock time it happens.
export function describeReset(resetsAt?: string): string | null {
  if (!resetsAt) return null;
  const reset = new Date(resetsAt);
  if (Number.isNaN(reset.getTime())) return null;

  // Whole calendar days between today and the reset day, in device-local time,
  // so a reset 6 days + a few hours away reads as "6 days", not "7".
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(reset) - startOfDay(new Date())) / 86_400_000);

  let hour = reset.getHours(); // device-local
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  const min = reset.getMinutes();
  const time = min ? `${hour}:${String(min).padStart(2, '0')} ${ampm}` : `${hour} ${ampm}`;

  if (days <= 0) return `Resets today at ${time}`;
  return `${days} ${days === 1 ? 'day' : 'days'} left · resets ${WEEKDAYS[reset.getDay()]} at ${time}`;
}

// "July 20" (with the year only when it isn't this year) for renewal/expiry dates.
export function shortDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// "150000" reads as noise; "150k" reads as a budget.
export function humanTokens(n: number | null | undefined): string | null {
  if (n == null) return null;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

// Marketing copy per tier. The server catalog stays the source of truth for
// label/price/limits; only the benefit phrasing lives client-side. Model claims
// mirror the server's MonetizationConfig.models (free = fast model, paid = the
// smarter one).
export function tierBenefits(t: CatalogTier): string[] {
  const tokens = humanTokens(t.weeklyTokenLimit);
  switch (t.key) {
    case 'free':
      return [
        tokens ? `${tokens} AI tokens each week — per person` : 'A weekly AI allowance per person',
        'Calendar, chores, recipes, trips & maintenance',
        'AI assistants on our fast model',
      ];
    case 'premium':
      return [
        tokens
          ? `${tokens} AI tokens each week, shared by your whole household`
          : 'A big weekly AI pool, shared by your whole household',
        'Smarter AI model behind every assistant',
        'Everything in Free',
      ];
    case 'unlimited':
      return [
        'No weekly AI cap',
        'Smarter AI model behind every assistant',
        'Everything in Premium',
      ];
    default:
      return tokens ? [`${tokens} AI tokens each week`] : [];
  }
}

// RevenueCat packages are claimed by tier via the product identifier containing
// the tier key (e.g. app.householdcalendar.premium_monthly → premium). Keep the
// store products named accordingly when configuring RevenueCat.
export function tierForPackage(pkg: PurchasesPackage, tierKeys: string[]): string | null {
  const id = `${pkg.product.identifier} ${pkg.identifier}`.toLowerCase();
  return tierKeys.find((key) => key !== 'free' && id.includes(key)) ?? null;
}

export const PERIOD_LABEL: Record<string, string> = {
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  TWO_MONTH: 'Every 2 months',
  THREE_MONTH: 'Every 3 months',
  SIX_MONTH: 'Every 6 months',
  ANNUAL: 'Yearly',
  LIFETIME: 'Lifetime',
};

export function priceLine(pkg: PurchasesPackage): string {
  const per =
    pkg.packageType === 'MONTHLY' ? ' / month'
    : pkg.packageType === 'ANNUAL' ? ' / year'
    : pkg.packageType === 'WEEKLY' ? ' / week'
    : pkg.packageType === 'TWO_MONTH' ? ' / 2 months'
    : pkg.packageType === 'THREE_MONTH' ? ' / 3 months'
    : pkg.packageType === 'SIX_MONTH' ? ' / 6 months'
    : pkg.packageType === 'LIFETIME' ? ''
    // CUSTOM/UNKNOWN: our catalog only sells recurring plans, and a bare price
    // reads as one-time — default to monthly rather than say nothing.
    : ' / month';
  return `${pkg.product.priceString}${per}`;
}

// Localized price of the ACTIVE subscription, by matching the server-stored
// store product id against the loaded packages. Null when unknown.
export function activePriceLine(
  productId: string | null | undefined,
  packages: PurchasesPackage[]
): string | null {
  if (!productId) return null;
  const pkg = packages.find((p) => p.product.identifier === productId);
  return pkg ? priceLine(pkg) : null;
}

// The tier we push hardest: the next step up from wherever the user is now.
export function recommendedTierKey(plan: string | null | undefined): string | null {
  return plan === 'free' ? 'premium' : plan === 'premium' ? 'unlimited' : null;
}

// Owns the whole purchase flow: RevenueCat init, offering load, tier↔package
// grouping, and buy() (purchaser attribution → store sheet → activation poll).
// Shared by ComparePlansScreen and UpsellSheet so both surfaces behave the same.
export function usePurchase() {
  const { user } = useAuth();
  const billing = useBilling();
  const activation = usePlanActivation();
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Configure RevenueCat with the household as app_user_id, then load offerings.
  useEffect(() => {
    if (!isPurchasesConfigured()) return;
    const appUserId = user?.householdId || user?._id;
    if (!appUserId) return;
    configurePurchases(appUserId);
    getCurrentOffering()
      .then((offering) => setPackages(offering?.availablePackages ?? []))
      .catch(() => setPackages([]));
  }, [user?.householdId, user?._id]);

  const catalog = billing.data?.catalog ?? [];
  const tierKeys = catalog.map((t) => t.key);
  const { packagesByTier, orphanPackages } = useMemo(() => {
    const byTier: Record<string, PurchasesPackage[]> = {};
    const orphans: PurchasesPackage[] = [];
    for (const pkg of packages) {
      const tier = tierForPackage(pkg, tierKeys);
      if (tier) (byTier[tier] ??= []).push(pkg);
      else orphans.push(pkg);
    }
    return { packagesByTier: byTier, orphanPackages: orphans };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packages, tierKeys.join(',')]);

  async function buy(pkg: PurchasesPackage) {
    const previousPlan = billing.data?.plan ?? 'free';
    setBusyId(pkg.identifier);
    try {
      // Stamp who's buying before the store sheet opens, so the webhook can
      // attribute the household subscription to this member.
      if (user?._id) await setPurchaserAttribute(user._id);
      await purchasePackage(pkg);
      // The plan flips server-side via the RevenueCat webhook — poll until it
      // does so the screen never shows the old plan to someone who just paid.
      activation.start(previousPlan);
    } catch (e: any) {
      if (!e?.userCancelled) Alert.alert('Purchase failed', e?.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  // Restore reports what actually came back instead of claiming success blindly:
  // no active entitlements is the common case (wrong store account, nothing
  // bought) and deserves a straight answer.
  async function restore() {
    try {
      const info = await restorePurchases();
      const active = Object.keys(info?.entitlements?.active ?? {});
      if (active.length === 0) {
        Alert.alert('Nothing to restore', 'No previous purchases were found for this account.');
        return;
      }
      const previousPlan = billing.data?.plan ?? 'free';
      const { data } = await billing.refetch();
      // Store shows an entitlement but the server still says free — the webhook
      // hasn't landed yet, so poll like a fresh purchase.
      if (data?.plan === 'free') activation.start(previousPlan);
      const label = active.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ');
      Alert.alert('Restored', `Your ${label} subscription has been restored.`);
    } catch {
      Alert.alert('Restore failed', 'Could not restore purchases.');
    }
  }

  return { billing, activation, packages, packagesByTier, orphanPackages, busyId, buy, restore };
}
