import { MaterialCommunityIcons } from '@expo/vector-icons';

type MdiName = keyof typeof MaterialCommunityIcons.glyphMap;

// Canonical maintenance categories (mirrors the server seed in seed.js). Templates
// always tag themselves with one of these names, so the rail/badges can rely on
// this fixed meta. `short` keeps the side-rail labels compact.
export interface CategoryMeta {
  name: string;
  short: string;
  icon: MdiName;
  color: string;
}

export const CATEGORY_META: CategoryMeta[] = [
  { name: 'HVAC & Heating',        short: 'HVAC',       icon: 'air-filter',      color: '#FF5722' },
  { name: 'Water, Well & Septic',  short: 'Water',      icon: 'water-pump',      color: '#2196F3' },
  { name: 'Vehicles',              short: 'Vehicles',   icon: 'car',             color: '#607D8B' },
  { name: 'Equipment',             short: 'Equipment',  icon: 'engine',          color: '#FF9800' },
  { name: 'Exterior & Structure',  short: 'Exterior',   icon: 'home-roof',       color: '#795548' },
  { name: 'Land & Grounds',        short: 'Grounds',    icon: 'tree',            color: '#4CAF50' },
  { name: 'Plumbing',              short: 'Plumbing',   icon: 'pipe',            color: '#00BCD4' },
  { name: 'Electrical & Safety',   short: 'Electrical', icon: 'lightning-bolt',  color: '#FFC107' },
  { name: 'Appliances',            short: 'Appliances', icon: 'washing-machine', color: '#9C27B0' },
  { name: 'Pest & Seasonal',       short: 'Pest',       icon: 'bug',             color: '#8BC34A' },
];

const FALLBACK: Omit<CategoryMeta, 'name' | 'short'> = { icon: 'wrench', color: '#9BA1A6' };

// Curated shortlist shown (before searching) when picking a maintenance-task
// icon — the glyphs used across the seed templates plus common repair icons.
export const SUGGESTED_TASK_ICONS: MdiName[] = [
  // General repair
  'wrench', 'tools', 'hammer', 'screwdriver', 'ladder', 'cog',
  // HVAC & heating
  'air-filter', 'hvac', 'air-conditioner', 'fan', 'fireplace', 'radiator',
  'thermometer', 'air-purifier',
  // Water, well & plumbing
  'water-pump', 'water-boiler', 'water-well', 'pipe', 'valve', 'filter', 'water',
  'shower', 'toilet', 'gauge', 'gas-cylinder',
  // Vehicles
  'car', 'oil', 'tire', 'car-brake-abs', 'car-battery', 'car-cog', 'engine', 'fuel',
  // Exterior & structure
  'home-roof', 'wall', 'door', 'garage', 'format-paint', 'window-closed-variant',
  'spray-bottle',
  // Land & grounds
  'mower', 'pine-tree', 'grass', 'flower', 'fence', 'sprinkler-variant', 'axe',
  'shovel', 'grill', 'pool', 'hot-tub', 'saw-blade', 'leaf', 'snowflake',
  // Electrical & safety
  'lightning-bolt', 'power-plug', 'lightbulb', 'battery', 'smoke-detector',
  'fire-extinguisher', 'solar-panel', 'ev-station', 'cctv', 'flash', 'radioactive',
  // Appliances
  'fridge', 'stove', 'dishwasher', 'washing-machine', 'tumble-dryer', 'microwave',
  'kettle', 'coffee-maker',
  // Pest & seasonal
  'bug', 'bee', 'rodent', 'sprout', 'home', 'flashlight',
];

const BY_NAME = new Map(CATEGORY_META.map((c) => [c.name, c]));

export function categoryMeta(name: string): CategoryMeta {
  return BY_NAME.get(name) ?? { name, short: name, ...FALLBACK };
}

// Resolve the glyph to show for a task/template: its own `icon` when present and
// valid, else the icon of its category, else the generic fallback. Guards against
// stale/unknown glyph names so a bad value can never crash a row.
export function resolveTaskIcon(icon?: string | null, categoryName?: string | null): MdiName {
  if (icon && icon in MaterialCommunityIcons.glyphMap) return icon as MdiName;
  return categoryName ? categoryMeta(categoryName).icon : FALLBACK.icon;
}

// Order a set of present category names by the canonical order above, with any
// unknown names appended alphabetically.
export function orderCategories(names: string[]): string[] {
  const order = new Map(CATEGORY_META.map((c, i) => [c.name, i]));
  return [...names].sort((a, b) => {
    const ai = order.has(a) ? order.get(a)! : CATEGORY_META.length;
    const bi = order.has(b) ? order.get(b)! : CATEGORY_META.length;
    return ai - bi || a.localeCompare(b);
  });
}
