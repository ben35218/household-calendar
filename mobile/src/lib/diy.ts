import { colors } from '../theme';

export type DiyLevel = 'diy' | 'pro' | 'depends';

// Presentation for a template's "who does the work" tag. Returns null for an
// unset value so callers can skip rendering.
export function diyBadge(diy?: DiyLevel | null): { label: string; color: string } | null {
  switch (diy) {
    case 'diy':     return { label: 'DIY',     color: colors.success };
    case 'pro':     return { label: 'Pro',     color: colors.warning };
    case 'depends': return { label: 'DIY/Pro', color: colors.textMuted };
    default:        return null;
  }
}
