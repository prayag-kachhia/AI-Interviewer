import { Hono } from "hono";
import { cors } from "hono/cors";
import { RoleList } from "@interview/contracts";
import { createSessionsRouter } from "./modules/sessions";

// STUB (content & research slice): hardcoded until roles and briefings are stored.
const ROLES: RoleList = [
  {
    id: "frontend-engineer",
    title: "Frontend Engineer",
    description: "React, browser fundamentals, and UI architecture.",
  },
  {
    id: "backend-engineer",
    title: "Backend Engineer",
    description: "APIs, databases, and distributed-systems basics.",
  },
  {
    id: "data-analyst",
    title: "Data Analyst",
    description: "SQL, statistics, and communicating findings.",
  },
];

export function createApp(webOrigin: string) {
  const app = new Hono();

  app.use("*", cors({ origin: webOrigin }));

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/roles", (c) => c.json(RoleList.parse(ROLES)));

  app.route("/sessions", createSessionsRouter());

  return app;
}
