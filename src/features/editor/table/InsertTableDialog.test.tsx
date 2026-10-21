import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../test/render";
import { InsertTableDialog } from "./InsertTableDialog";
import { DEFAULT_SETUP, PAPER } from "./options";

function renderDialog() {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  const { unmount } = renderWithProviders(
    <InsertTableDialog paper="#ffffff" onInsert={onInsert} onClose={onClose} />,
  );
  return { onInsert, onClose, unmount };
}

const group = (name: string) => within(screen.getByRole("group", { name }));

describe("InsertTableDialog", () => {
  beforeEach(() => localStorage.clear());

  it("inserts a to-do style table by default", async () => {
    const { onInsert, onClose } = renderDialog();
    expect(screen.getByRole("dialog", { name: "Insert a table" })).toBeInTheDocument();
    expect(screen.getByLabelText("Rows")).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Insert table" }));
    expect(onInsert).toHaveBeenCalledWith(DEFAULT_SETUP);
    expect(DEFAULT_SETUP.look.cellFill).toBe(PAPER);
    expect(onClose).toHaveBeenCalled();
  });

  it("uses the size, options and style I pick, and remembers them next time", async () => {
    const { onInsert, unmount } = renderDialog();
    await userEvent.clear(screen.getByLabelText("Rows"));
    await userEvent.type(screen.getByLabelText("Rows"), "5");
    await userEvent.clear(screen.getByLabelText("Columns"));
    await userEvent.type(screen.getByLabelText("Columns"), "4");
    await userEvent.click(screen.getByLabelText("Checkbox at the start of each row"));
    await userEvent.click(group("Header color").getByText("Light blue"));
    await userEvent.click(group("Cell color").getByText("Light yellow"));
    await userEvent.click(group("Border color").getByText("Blue"));
    await userEvent.click(group("Border width").getByText("Bold"));
    await userEvent.click(group("Text").getByText("Align left"));
    await userEvent.keyboard("{Enter}");
    const picked = {
      rows: 5,
      cols: 4,
      header: true,
      checkboxes: false,
      look: {
        headerFill: "#a5d8ff",
        cellFill: "#ffec99",
        border: "#1971c2",
        borderWidth: 2,
        align: "left",
        dimDone: true,
      },
    };
    expect(onInsert).toHaveBeenCalledWith(picked);

    unmount();
    renderDialog();
    expect(screen.getByLabelText("Rows")).toHaveValue(5);
    expect(screen.getByLabelText("Columns")).toHaveValue(4);
    expect(screen.getByLabelText("Checkbox at the start of each row")).not.toBeChecked();
    expect(group("Header color").getByRole("radio", { name: "Light blue" })).toBeChecked();
    expect(group("Text").getByRole("radio", { name: "Align left" })).toBeChecked();
  });

  it("takes a custom color", async () => {
    const { onInsert } = renderDialog();
    const picker = screen.getByLabelText("Custom cell color");
    // Native color inputs can't be typed into; fire the change the picker would.
    picker.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(picker, "#123456");
    picker.dispatchEvent(new Event("input", { bubbles: true }));
    await userEvent.click(screen.getByRole("button", { name: "Insert table" }));
    expect(onInsert.mock.calls[0]![0].look.cellFill).toBe("#123456");
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
