import { describe, expect, test } from "bun:test";
import { RoleList } from "@interview/contracts";
import { createApp } from "./app";

const app = createApp("http://localhost:5173");

describe("api shell", () => {
  test("GET /health reports ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("GET /roles returns roles matching the shared contract", async () => {
    const res = await app.request("/roles");
    expect(res.status).toBe(200);
    const roles = RoleList.parse(await res.json());
    expect(roles.length).toBeGreaterThan(0);
  });

  test("CORS allows the web origin", async () => {
    const res = await app.request("/roles", {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});
