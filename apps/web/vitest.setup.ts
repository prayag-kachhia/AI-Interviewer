import "@testing-library/jest-dom/vitest";
import * as matchers from "vitest-axe/matchers.js";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";

expect.extend(matchers);

// Testing Library only cleans up automatically when vitest globals are on; they are off here.
afterEach(cleanup);

type DialogElementLike = {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  dispatchEvent(event: Event): boolean;
};

type DialogCtor = {
  prototype: {
    showModal?: (this: DialogElementLike) => void;
    close?: (this: DialogElementLike) => void;
  };
};

const DialogElement = (globalThis as { HTMLDialogElement?: DialogCtor }).HTMLDialogElement;
if (DialogElement) {
  DialogElement.prototype.showModal ??= function (this: DialogElementLike) {
    this.setAttribute("open", "");
  };
  DialogElement.prototype.close ??= function (this: DialogElementLike) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

