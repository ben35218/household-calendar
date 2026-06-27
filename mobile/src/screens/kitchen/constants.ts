import { colors } from '../../theme';

export const INVENTORY_CATEGORIES = [
  { label: 'Produce', value: 'produce' },
  { label: 'Dairy', value: 'dairy' },
  { label: 'Meat', value: 'meat' },
  { label: 'Seafood', value: 'seafood' },
  { label: 'Deli', value: 'deli' },
  { label: 'Bakery', value: 'bakery' },
  { label: 'Frozen', value: 'frozen' },
  { label: 'Pantry', value: 'pantry' },
  { label: 'Beverages', value: 'beverages' },
  { label: 'Other', value: 'other' },
];

export function daysUntilExpiry(date?: string): number | null {
  if (!date) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exp = new Date(date);
  exp.setHours(0, 0, 0, 0);
  return Math.round((exp.getTime() - now.getTime()) / 86400000);
}

export function expiryColor(days: number | null): string {
  if (days === null) return colors.textMuted;
  if (days < 0) return colors.error;
  if (days <= 2) return '#FF7043';
  if (days <= 7) return colors.warning;
  return colors.success;
}

export function expiryLabel(days: number | null): string {
  if (days === null) return 'No expiry';
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Tomorrow';
  return `${days}d left`;
}
