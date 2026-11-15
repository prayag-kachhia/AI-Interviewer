import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Alert, AlertDescription, AlertTitle } from "./alert";
import { Badge } from "./badge";
import { Button } from "./button";
import { ChartContainer, type ChartConfig } from "./chart";

describe("Button", () => {
  it("disables itself and reports busy while loading", () => {
    render(<Button loading>Analyze resume</Button>);
    const button = screen.getByRole("button", { name: "Analyze resume" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("styles its child instead of rendering a <button> with asChild", () => {
    render(
      <Button asChild variant="outline">
        <a href="/history">History</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "History" });
    expect(link).toHaveAttribute("data-variant", "outline");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Badge", () => {
  it("marks status variants so the state isn't colour-only", () => {
    render(<Badge variant="live">Live</Badge>);
    const badge = screen.getByText("Live");
    expect(badge).toHaveAttribute("data-variant", "live");
    expect(badge.className).toContain("before:rounded-full");
  });
});

describe("Alert", () => {
  it("interrupts screen readers only for errors", () => {
    render(
      <>
        <Alert variant="error">
          <AlertTitle>Please select a PDF file.</AlertTitle>
        </Alert>
        <Alert>
          <AlertTitle>Reading your resume</AlertTitle>
          <AlertDescription>Extracting information...</AlertDescription>
        </Alert>
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Please select a PDF file.");
    expect(screen.getByRole("status")).toHaveTextContent("Extracting information...");
  });
});

describe("ChartContainer", () => {
  it("renders with data-slot and data-chart attributes", () => {
    const config: ChartConfig = {
      score: {
        label: "Score",
        color: "#805600",
      },
    };
    render(
      <ChartContainer config={config} id="test-radar">
        <div>Chart Content</div>
      </ChartContainer>,
    );
    const container = screen.getByText("Chart Content").closest("[data-slot='chart']");
    expect(container).toBeInTheDocument();
    expect(container).toHaveAttribute("data-chart", "chart-test-radar");
  });
});
