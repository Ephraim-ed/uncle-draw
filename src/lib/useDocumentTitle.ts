import { useEffect } from "react";

/** Sets the browser tab title; `null` keeps the plain app name. */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · Uncle Draw` : "Uncle Draw";
  }, [title]);
}
