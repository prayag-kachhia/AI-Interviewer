import { ResultsScreen } from "./features/feedback";
import { useEffect, useState } from "react";
import { RoleList } from "@interview/contracts";
import { getJson } from "./lib/api";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; roles: RoleList };

// STUB (live-session slice): the role picker moves into features/sessions once
// picking a role starts a session.
export function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    getJson("/roles", RoleList)
      .then((roles) => setState({ status: "ready", roles }))
      .catch((err: unknown) =>
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) }),
      );
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Interview Practice</h1>
      <h2>Pick a role</h2>
      {state.status === "loading" && <p>Loading roles…</p>}
      {state.status === "error" && <p role="alert">Could not load roles: {state.message}</p>}
      {state.status === "ready" && (
        <ul>
          {state.roles.map((role: RoleList[number]) => (
            <li key={role.id}>
              <strong>{role.title}</strong> — {role.description}
            </li>
          ))}
        </ul>
      )}

      <ResultsScreen sessionId="test-123" />
    </main>
  );
}
