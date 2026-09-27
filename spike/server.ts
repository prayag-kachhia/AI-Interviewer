import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load GEMINI_API_KEY from apps/api/.env if not already in process.env
const envPath = resolve(import.meta.dir, "../apps/api/.env");
let geminiApiKey = process.env.GEMINI_API_KEY;

if (!geminiApiKey && existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$/);
    if (match) {
      geminiApiKey = match[1].replace(/^["']|["']$/g, "");
      break;
    }
  }
}

if (!geminiApiKey) {
  console.error("❌ ERROR: GEMINI_API_KEY not found in process.env or apps/api/.env");
  process.exit(1);
}

const PORT = 4000;

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // API to mint an ephemeral token
    if (url.pathname === "/api/token" && req.method === "POST") {
      try {
        const now = Date.now();
        const response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
          {
            method: "POST",
            headers: {
              "x-goog-api-key": geminiApiKey!,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              uses: 1, // Single-use session
              expireTime: new Date(now + 30 * 60 * 1000).toISOString(), // 30 min duration
              newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(), // Must start within 2 min
            }),
          }
        );

        if (!response.ok) {
          const errText = await response.text();
          console.error("Google Auth Token error:", errText);
          return new Response(JSON.stringify({ error: errText }), {
            status: response.status,
            headers: { "Content-Type": "application/json" },
          });
        }

        const data = await response.json();
        console.log(" Minted ephemeral token:", data.name);
        return new Response(JSON.stringify({ token: data.name }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Serve the test HTML interface
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const htmlFile = Bun.file(resolve(import.meta.dir, "index.html"));
      return new Response(htmlFile, {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`\n Voice Spike Server running at: http://localhost:${PORT}`);
console.log(` Ready to test Gemini Multimodal Live API!\n`);
