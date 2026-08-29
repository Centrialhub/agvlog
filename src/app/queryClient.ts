import { QueryClient } from "@tanstack/react-query";

const MINUTE_IN_MS = 60_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * MINUTE_IN_MS,
      gcTime: 10 * MINUTE_IN_MS,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
