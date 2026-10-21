import { restoreLibraryItems } from "@excalidraw/excalidraw";
import type { LibraryItems } from "@excalidraw/excalidraw/types";
import { z } from "zod";
import type { Json } from "../../lib/database.types";
import { elementSchema } from "../../lib/schemas";
import { supabase } from "../../lib/supabase";

/**
 * My Excalidraw library, one row per user in `user_libraries` (LIB-1). It
 * holds what I add to the library sidebar and the templates I save (EDIT-8).
 * RLS limits the row to its owner.
 */

/** Shape check before Excalidraw's own restore (tech §6.7). */
const itemsSchema = z.array(
  z.looseObject({
    id: z.string().min(1),
    status: z.enum(["published", "unpublished"]).optional(),
    elements: z.array(elementSchema),
    created: z.number().optional(),
    name: z.string().max(200).optional(),
  }),
);

export async function loadLibrary(userId: string): Promise<LibraryItems> {
  const { data, error } = await supabase
    .from("user_libraries")
    .select("items")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const parsed = itemsSchema.safeParse(data?.items ?? []);
  return parsed.success ? restoreLibraryItems(parsed.data as unknown as LibraryItems, "unpublished") : [];
}

export async function saveLibrary(userId: string, items: LibraryItems): Promise<void> {
  const { error } = await supabase
    .from("user_libraries")
    .upsert({ user_id: userId, items: items as unknown as NonNullable<Json> }, { onConflict: "user_id" });
  if (error) throw error;
}
