import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { removePerson } from "../share/collab.api";
import {
  PAGE_SIZE,
  createBoard,
  listBoards,
  renameBoard,
  restoreBoard,
  signThumbnails,
  trashBoard,
  type BoardSummary,
} from "./boards.api";

type Pages = InfiniteData<BoardSummary[], number>;

export const boardsKey = (userId: string) => ["boards", userId] as const;

export function useBoardsList() {
  const { user } = useAuth();
  return useInfiniteQuery({
    queryKey: boardsKey(user?.id ?? "none"),
    enabled: !!user,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listBoards(pageParam),
    getNextPageParam: (last, _all, lastParam) => (last.length === PAGE_SIZE ? lastParam + 1 : undefined),
  });
}

function mapBoards(
  data: Pages | undefined,
  fn: (pages: BoardSummary[][]) => BoardSummary[][],
): Pages | undefined {
  return data ? { ...data, pages: fn(data.pages) } : data;
}

export function useCreateBoard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createBoard,
    onSuccess: (board) => {
      qc.setQueryData<Pages>(boardsKey(user?.id ?? "none"), (data) =>
        mapBoards(data, (pages) => [[board, ...(pages[0] ?? [])], ...pages.slice(1)]),
      );
    },
  });
}

export function useRenameBoard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = boardsKey(user?.id ?? "none");
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameBoard(id, title),
    onMutate: async ({ id, title }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Pages>(key);
      qc.setQueryData<Pages>(key, (data) =>
        mapBoards(data, (pages) => pages.map((p) => p.map((b) => (b.id === id ? { ...b, title } : b)))),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useTrashBoard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = boardsKey(user?.id ?? "none");
  return useMutation({
    mutationFn: (id: string) => trashBoard(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Pages>(key);
      qc.setQueryData<Pages>(key, (data) =>
        mapBoards(data, (pages) => pages.map((p) => p.filter((b) => b.id !== id))),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

/** An editor leaves a board shared with them (COLLAB-1). */
export function useLeaveBoard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = boardsKey(user?.id ?? "none");
  return useMutation({
    mutationFn: (id: string) => removePerson(id, user!.id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Pages>(key);
      qc.setQueryData<Pages>(key, (data) =>
        mapBoards(data, (pages) => pages.map((p) => p.filter((b) => b.id !== id))),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useRestoreBoard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => restoreBoard(id),
    onSettled: () => qc.invalidateQueries({ queryKey: boardsKey(user?.id ?? "none") }),
  });
}

/**
 * Signed thumbnail URLs for one page of boards, cached 50 min and keyed on
 * `updated_at` so a new thumbnail breaks the cache (tech §7.5).
 */
export function useThumbnailUrls(boards: BoardSummary[]) {
  const withThumbs = boards.filter((b) => b.thumbnail_path);
  return useQuery({
    queryKey: ["thumbs", withThumbs.map((b) => `${b.id}:${b.updated_at}`)],
    enabled: withThumbs.length > 0,
    staleTime: 50 * 60_000,
    gcTime: 55 * 60_000,
    queryFn: () => signThumbnails(withThumbs.map((b) => b.thumbnail_path!)),
  });
}
