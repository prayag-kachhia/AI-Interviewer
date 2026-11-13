// P-6 primitives. Kept apart from ui.test.tsx, which RH-4 also edits.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";
import { Avatar, AvatarFallback } from "./avatar";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog";
import { Input } from "./input";
import { Progress } from "./progress";
import { RadioGroup, RadioGroupItem } from "./radio-group";

describe("AlertDialog", () => {
  function renderDeleteConfirm(onDelete = vi.fn()) {
    render(
      <AlertDialog>
        <AlertDialogTrigger>Delete interview</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this interview?</AlertDialogTitle>
            <AlertDialogDescription>Its transcript and feedback are removed for good.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Delete interview</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete interview" }));
    return onDelete;
  }

  it("opens as a named alertdialog with a destructive confirm", () => {
    renderDeleteConfirm();
    expect(screen.getByRole("alertdialog", { name: "Delete this interview?" })).toBeInTheDocument();
    const confirm = screen.getAllByRole("button", { name: "Delete interview" }).at(-1);
    expect(confirm).toHaveAttribute("data-variant", "destructive");
  });

  it("calls the action and closes", () => {
    const onDelete = renderDeleteConfirm();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete interview" }).at(-1)!);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("closes without acting on Cancel", () => {
    const onDelete = renderDeleteConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("Dialog", () => {
  it("has a labelled Close button", () => {
    render(
      <Dialog>
        <DialogTrigger>Choose microphone</DialogTrigger>
        <DialogContent>
          <DialogTitle>Microphone</DialogTitle>
          <DialogDescription>Pick the device to use.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose microphone" }));
    expect(screen.getByRole("dialog", { name: "Microphone" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("RadioGroup", () => {
  it("checks the clicked item and reports the value", () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup aria-label="Mode" defaultValue="voice" onValueChange={onValueChange}>
        <RadioGroupItem value="voice" aria-label="Voice" />
        <RadioGroupItem value="typed" aria-label="Typed" />
      </RadioGroup>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Typed" }));
    expect(onValueChange).toHaveBeenCalledWith("typed");
    expect(screen.getByRole("radio", { name: "Typed" })).toBeChecked();
  });
});

describe("Progress", () => {
  it("exposes its value and clamps the bar", () => {
    render(<Progress aria-label="Time left" value={150} max={100} />);
    const bar = screen.getByRole("progressbar", { name: "Time left" });
    expect(bar.firstElementChild).toHaveStyle({ width: "100%" });
  });
});

describe("Avatar and Input", () => {
  it("shows initials when there is no image, and marks invalid input", () => {
    render(
      <>
        <Avatar>
          <AvatarFallback>PK</AvatarFallback>
        </Avatar>
        <Input aria-label="Company" aria-invalid />
      </>,
    );
    expect(screen.getByText("PK")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Company" })).toHaveClass("aria-invalid:border-destructive");
  });
});
