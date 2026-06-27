import { TripItemType } from '../api';

// Trip booking type metadata, ported from TripDetailView TYPE_META / TYPES.
// Icons are MaterialCommunityIcons names (no mdi- prefix needed here).
export interface TripTypeMeta {
  value: TripItemType;
  label: string;
  icon: string;
  color: string;
}

export const TRIP_TYPES: TripTypeMeta[] = [
  { value: 'flight', label: 'Flight', icon: 'airplane', color: '#1565C0' },
  { value: 'hotel', label: 'Hotel', icon: 'bed', color: '#6A1B9A' },
  { value: 'car-rental', label: 'Car', icon: 'car', color: '#2E7D32' },
  { value: 'restaurant', label: 'Restaurant', icon: 'silverware-fork-knife', color: '#C62828' },
  { value: 'activity', label: 'Activity', icon: 'ticket-outline', color: '#EF6C00' },
  { value: 'transit', label: 'Transit', icon: 'train-car', color: '#00838F' },
  { value: 'other', label: 'Other', icon: 'map-marker-outline', color: '#546E7A' },
];

export function tripTypeMeta(t?: string): TripTypeMeta {
  return TRIP_TYPES.find((x) => x.value === t) || TRIP_TYPES[TRIP_TYPES.length - 1];
}

export const TRIP_PURPLE = '#5E35B1';

export function tripStatusLabel(s: string): string {
  return { considering: 'Considering', booked: 'Booked', completed: 'Past' }[s] ?? s;
}
export function tripStatusColor(s: string): string {
  return { considering: '#FB8C00', booked: '#5E35B1', completed: '#757575' }[s] ?? '#757575';
}
