import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../test/render";
import { InsertTableDialog } from "./InsertTableDialog";

function renderDialog() {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  const { unmount } = renderWithProviders(<InsertTableDialog onInsert={onInsert} onClose={onClose} />);
  return { onInsert, onClose, unmount };
}

describe("InsertTableDialog", () => {
  beforeEach(() => localStorage.clear());

  it("inserts a to-do style table by default", async () => {
    const { onInsert, onClose } = renderDialog();
    expect(screen.getByRole("dialog", { name: "Insert a table" })).toBeInTheDocument();
    expect(screen.getByLabelText("Rows")).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Insert table" }));
    expect(onInsert).toHaveBeenCalledWith({ rows: 3, cols: 2, header: true, checkboxes: true });
    expect(onClose).toHaveBeenCalled();
  });

  it("uses the size and options I pick, and remembers them next time", async () => {
    const { onInsert, unmount } = renderDialog();
    await userEvent.clear(screen.getByLabelText("Rows"));
    await userEvent.type(screen.getByLabelText("Rows"), "5");
    await userEvent.clear(screen.getByLabelText("Columns"));
    await userEvent.type(screen.getByLabelText("Columns"), "4");
    await userEvent.click(screen.getByLabelText("Header row on top"));
    await userEvent.click(screen.getByLabelText("Checkbox at the start of each row"));
    await userEvent.keyboard("{Enter}");
    expect(onInsert).toHaveBeenCalledWith({ rows: 5, cols: 4, header: false, checkboxes: false });

    unmount();
    renderDialog();
    expect(screen.getByLabelText("Rows")).toHaveValue(5);
    expect(screen.getByLabelText("Columns")).toHaveValue(4);
    expect(screen.getByLabelText("Header row on top")).not.toBeChecked();
  });

  it("explains out-of-range sizes instead of inserting", async () => {
    const { onInsert } = renderDialog();
    await userEvent.clear(screen.getByLabelText("Rows"));
    await userEvent.type(screen.getByLabelText("Rows"), "99");
    await userEvent.clear(screen.getByLabelText("Columns"));
    await userEvent.click(screen.getByRole("button", { name: "Insert table" }));
    expect(onInsert).not.toHaveBeenCalled();
    expect(screen.getByText("Pick 1 to 30 rows.")).toBeInTheDocument();
    expect(screen.getByText("Pick 1 to 12 columns.")).toBeInTheDocument();
  });

  it("cancels without inserting", async () => {
    const { onInsert, onClose } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onInsert).not.toHaveBeenCalled();
  });
});
