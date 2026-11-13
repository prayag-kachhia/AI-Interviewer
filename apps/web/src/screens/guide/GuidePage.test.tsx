import "@testing-library/jest-dom/vitest";
import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { GuidePage } from "./GuidePage";
import { getInsights } from "../../lib/api";
import type { ImprovementPlan } from "../../types";

vi.mock("../../lib/api", () => ({
  getInsights: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  mockNavigate.mockReset();
});

const MOCK_PLAN: ImprovementPlan = {
  id: "plan-1",
  userId: "user-1",
  topics: [
    { topic: "DBMS", score: 2, summary: "Struggled with transaction isolation levels." },
    { topic: "OS", score: 3, summary: "Needs review on virtual memory and paging." },
    { topic: "DSA", score: 5, summary: "Excellent understanding of data structures." },
  ],
  plan: [
    {
      id: "plan-dbms",
      topic: "DBMS",
      score: 2,
      summary: "Struggled with transaction isolation levels.",
      action: "Study ACID properties in DBMS",
      resourceId: "dbms-acid-transactions",
      actions: [
        {
          id: "act-1",
          action: "Study GeeksforGeeks: ACID Properties in DBMS",
          resourceId: "dbms-acid-transactions",
          completed: false,
          resource: {
            id: "dbms-acid-transactions",
            topic: "DBMS",
            title: "GeeksforGeeks: ACID Properties in DBMS",
            url: "https://www.geeksforgeeks.org/acid-properties-in-dbms/",
            description: "Foundational guide explaining atomicity, consistency, isolation, and durability.",
            type: "guide",
          },
        },
      ],
    },
  ],
  resources: [
    {
      id: "dbms-acid-transactions",
      topic: "DBMS",
      title: "GeeksforGeeks: ACID Properties in DBMS",
      url: "https://www.geeksforgeeks.org/acid-properties-in-dbms/",
      description: "Foundational guide explaining atomicity, consistency, isolation, and durability.",
      type: "guide",
    },
  ],
};

test("given guide is loading, shows loading indicator", async () => {
  vi.mocked(getInsights).mockReturnValue(new Promise(() => {})); // never resolves

  render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>
  );

  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.getByText("Loading improvement guide…")).toBeInTheDocument();
});

test("given user has no plan (404), renders empty state with start interview button", async () => {
  const notFoundError = new Error("Not found") as any;
  notFoundError.response = { status: 404 };
  notFoundError.status = 404;
  vi.mocked(getInsights).mockRejectedValue(notFoundError);

  render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>
  );

  expect(await screen.findByText("No Improvement Guide Yet")).toBeInTheDocument();
  expect(
    screen.getByText(
      /You don't have an improvement plan yet. Complete mock interviews to evaluate your strengths/i
    )
  ).toBeInTheDocument();

  const startBtn = screen.getByRole("button", { name: /Start an Interview/i });
  expect(startBtn).toBeInTheDocument();

  fireEvent.click(startBtn);
  expect(mockNavigate).toHaveBeenCalledWith("/new-interview");
});

test("given user has an improvement plan, renders weaknesses, roadmap, and resources", async () => {
  vi.mocked(getInsights).mockResolvedValue(MOCK_PLAN);

  render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>
  );

  // Header
  expect(await screen.findByText("Improvement Guide")).toBeInTheDocument();

  // Section 1: Weaknesses
  expect(screen.getByRole("heading", { name: /Topic Weaknesses/i })).toBeInTheDocument();
  expect(screen.getAllByText("DBMS").length).toBeGreaterThan(0);
  expect(screen.getByText("Score: 2 / 5")).toBeInTheDocument();
  expect(screen.getByText("Struggled with transaction isolation levels.")).toBeInTheDocument();

  // Progress bar
  const progressBars = screen.getAllByRole("progressbar");
  expect(progressBars.length).toBeGreaterThan(0);

  // Section 2: Roadmap
  expect(screen.getByRole("heading", { name: /Improvement Roadmap/i })).toBeInTheDocument();
  expect(screen.getByText("Study GeeksforGeeks: ACID Properties in DBMS")).toBeInTheDocument();
  expect(screen.getByText("To do")).toBeInTheDocument();

  // Section 3: Curated Resources
  expect(screen.getByRole("heading", { name: /Curated Learning Resources/i })).toBeInTheDocument();
  expect(screen.getAllByText("GeeksforGeeks: ACID Properties in DBMS").length).toBeGreaterThan(0);
  expect(
    screen.getByText("Foundational guide explaining atomicity, consistency, isolation, and durability.")
  ).toBeInTheDocument();

  const links = screen.getAllByRole("link", { name: /Study Resource|Open Resource/i });
  expect(links.length).toBeGreaterThan(0);
  expect(links[0]).toHaveAttribute("href", "https://www.geeksforgeeks.org/acid-properties-in-dbms/");
  expect(links[0]).toHaveAttribute("target", "_blank");
});

test("given API returns unexpected error, renders error alert", async () => {
  const genericError = new Error("Network error") as any;
  genericError.response = { status: 500, data: { message: "Internal server error" } };
  vi.mocked(getInsights).mockRejectedValue(genericError);

  render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>
  );

  expect(await screen.findByText("Internal server error")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
});
