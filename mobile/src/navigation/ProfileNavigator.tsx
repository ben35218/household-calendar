// Navigation was flattened into a single root stack (see AppNavigator + types.ts).
// This file is kept only as a type-alias so existing screen imports of
// `ProfileStackParamList` keep resolving against the unified route map.
import type { RootStackParamList } from './types';

export type ProfileStackParamList = RootStackParamList;
