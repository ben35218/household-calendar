import { QueryClient } from '@tanstack/react-query';

// Server-state cache for the app. Conservative defaults: data is fresh for 30s,
// retries once. Screens use useQuery/useMutation against the api/ groups.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
