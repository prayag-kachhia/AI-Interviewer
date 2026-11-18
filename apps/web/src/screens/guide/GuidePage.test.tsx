import "@testing-library/jest-dom/vitest";
import { test, expect, vi, afterEach } from "vitest";
import { axe } from "vitest-axe";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { GuidePage } from "./GuidePage";
import { getInsights, updateRoadmapProgress } from "../../lib/api";
import type { ImprovementPlan } from "../../types";

vi.mock("../../lib/api", () => ({
  getInsights: vi.fn(),
  updateRoadmapProgress: vi.fn(),
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

test("given roadmap items, renders checkboxes for each action item", async () => {
  vi.mocked(getInsights).mockResolvedValue(MOCK_PLAN);

  render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>
  );

  const checkbox = await screen.findByRole("checkbox", {
    name: /Mark Study GeeksforGeeks: ACID Properties in DBMS as completed/i,
  });
  expect(checkbox).toBeInTheDocument();
  expect(checkbox).not.toBeChecked();
});

test("ticking a roadmap checkbox calls updateRoadmapProgress and updates badge to Completed", async () => {
  vi.mocked(getInsights).mockResolvedValue(MOCK_PLAN);
  const updatedPlan: ImprovementPlan = {
    ...MOCK_PLAN,
    plan: [
      {
        ...MOCK_PLAN.plan[0],
        actions: [{ ...MOCK_PLAN.plan[0].actions[0], completed: true }],
      },
    ],
  };
  vi.mocked(updateRoadmapProgress).mockResolvedValue(updatedPlan);

  render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>
  );

  const checkbox = await screen.findByRole("checkbox", {
    name: /Mark Study GeeksforGeeks: ACID Properties in DBMS as completed/i,
  });
  expect(checkbox).not.toBeChecked();
  expect(screen.getByText("To do")).toBeInTheDocument();

  fireEvent.click(checkbox);

  expect(updateRoadmapProgress).toHaveBeenCalledWith("act-1", true);
  expect(await screen.findByText("Completed")).toBeInTheDocument();
  expect(checkbox).toBeChecked();
});

test("unticking a completed roadmap checkbox calls updateRoadmapProgress with completed: false", async () => {
  const completedInitialPlan: ImprovementPlan = {
    ...MOCK_PLAN,
    plan: [
      {
        ...MOCK_PLAN.plan[0],
        actions: [{ ...MOCK_PLAN.plan[0].actions[0], completed: true }],
      },
    ],
  };
  vi.mocked(getInsights).mockResolvedValue(completedInitialPlan);
  const uncompletedPlan: ImprovementPlan = {
    ...MOCK_PLAN,
    plan: [
      {
        ...MOCK_PLAN.plan[0],
        actions: [{ ...MOCK_PLAN.plan[0].actions[0], completed: false }],
      },
    ],
  };
  vi.mocked(updateRoadmapProgress).mockResolvedValue(uncompletedPlan);

  render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>
  );

  const checkbox = await screen.findByRole("checkbox", {
    name: /Mark Study GeeksforGeeks: ACID Properties in DBMS as completed/i,
  });
  expect(checkbox).toBeChecked();
  expect(screen.getByText("Completed")).toBeInTheDocument();

  fireEvent.click(checkbox);

  expect(updateRoadmapProgress).toHaveBeenCalledWith("act-1", false);
  expect(await screen.findByText("To do")).toBeInTheDocument();
  expect(checkbox).not.toBeChecked();
});

test("when updateRoadmapProgress fails, reverts the optimistic checkbox change and shows error alert", async () => {
  vi.mocked(getInsights).mockResolvedValue(MOCK_PLAN);
  vi.mocked(updateRoadmapProgress).mockRejectedValue(new Error("Network timeout saving progress"));

  render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>
  );

  const checkbox = await screen.findByRole("checkbox", {
    name: /Mark Study GeeksforGeeks: ACID Properties in DBMS as completed/i,
  });
  expect(checkbox).not.toBeChecked();

  fireEvent.click(checkbox);

  expect(await screen.findByText("Network timeout saving progress")).toBeInTheDocument();
  expect(checkbox).not.toBeChecked();
  expect(screen.getByText("To do")).toBeInTheDocument();
});

test("ticked items stay ticked after a page reload (re-fetch)", async () => {
  const completedPlan: ImprovementPlan = {
    ...MOCK_PLAN,
    plan: [
      {
        ...MOCK_PLAN.plan[0],
        actions: [{ ...MOCK_PLAN.plan[0].actions[0], completed: true }],
      },
    ],
  };
  // Initial fetch returns the completed plan (as stored in DB after reload)
  vi.mocked(getInsights).mockResolvedValue(completedPlan);

  const { unmount } = render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>
  );

  let checkbox = await screen.findByRole("checkbox", {
    name: /Mark Study GeeksforGeeks: ACID Properties in DBMS as completed/i,
  });
  expect(checkbox).toBeChecked();
  expect(screen.getByText("Completed")).toBeInTheDocument();

  // Simulate page reload
  unmount();

  render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>
  );

  checkbox = await screen.findByRole("checkbox", {
    name: /Mark Study GeeksforGeeks: ACID Properties in DBMS as completed/i,
  });
  expect(checkbox).toBeChecked();
  expect(screen.getByText("Completed")).toBeInTheDocument();
});

test("does not let a stale response from a quick toggle overwrite the latest state", async () => {
  vi.mocked(getInsights).mockResolvedValue(MOCK_PLAN);

  let resolveFirstCall!: (value: any) => void;
  const firstPromise = new Promise((resolve) => {
    resolveFirstCall = resolve;
  });

  const updatedTrue: ImprovementPlan = {
    ...MOCK_PLAN,
    plan: [
      {
        ...MOCK_PLAN.plan[0],
        actions: [{ ...MOCK_PLAN.plan[0].actions[0], completed: true }],
      },
    ],
  };
  const updatedFalse: ImprovementPlan = {
    ...MOCK_PLAN,
    plan: [
      {
        ...MOCK_PLAN.plan[0],
        actions: [{ ...MOCK_PLAN.plan[0].actions[0], completed: false }],
      },
    ],
  };

  vi.mocked(updateRoadmapProgress)
    .mockReturnValueOnce(firstPromise as any)
    .mockResolvedValueOnce(updatedFalse);

  render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>
  );

  const checkbox = await screen.findByRole("checkbox", {
    name: /Mark Study GeeksforGeeks: ACID Properties in DBMS as completed/i,
  });
  expect(checkbox).not.toBeChecked();

  // First click: mark as completed (pending promise)
  fireEvent.click(checkbox);
  expect(checkbox).toBeChecked();

  // Second quick click: unmark as completed (resolves immediately)
  fireEvent.click(checkbox);
  expect(checkbox).not.toBeChecked();

  // Now the stale first promise resolves with completed: true
  resolveFirstCall(updatedTrue);

  // Checkbox should stay unchecked because the second click was completed: false
  expect(checkbox).not.toBeChecked();
  expect(screen.getByText("To do")).toBeInTheDocument();
});

test("has no accessibility violations with populated improvement plan", async () => {
  vi.mocked(getInsights).mockResolvedValue(MOCK_PLAN);

  const { container } = render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>
  );

  await screen.findByRole("heading", { name: "Improvement Guide" });
  expect(await axe(container)).toHaveNoViolations();
});

test("has no accessibility violations in empty/not-found state", async () => {
  vi.mocked(getInsights).mockRejectedValue({ response: { status: 404 } });

  const { container } = render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>
  );

  await screen.findByText("No Improvement Guide Yet");
  expect(await axe(container)).toHaveNoViolations();
});
