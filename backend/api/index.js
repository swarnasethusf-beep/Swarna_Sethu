/**
 * ▲ Vercel serverless entry — every request (see vercel.json rewrites) is handled by the Express app.
 * Configuration comes from the Vercel project's Environment Variables (see ../.env.example).
 */
const { createRuntime } = require("../lib/runtime");

let handler;
try {
  handler = createRuntime().app;
} catch (err) {
  // Keep the real reason in the function logs; don't expose configuration details to visitors
  console.error("❌ Startup failed:", err.message);
  handler = (req, res) => {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "The server is not configured correctly. Check the Environment Variables in Vercel (see backend/.env.example)." }));
  };
}

module.exports = handler;
