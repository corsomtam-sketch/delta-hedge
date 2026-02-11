import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  getAllPositionsWithHedges,
  simulatePosition,
  getAvailablePairs,
} from "./orca.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Auth middleware ──────────────────────────────────────────────────

const APP_PASSWORD = process.env.APP_PASSWORD;

function requireAuth(req, res, next) {
  if (!APP_PASSWORD) return next(); // no password set = open access

  // Check session cookie
  if (req.cookies?.dh_auth === APP_PASSWORD) return next();

  // Check query param (for initial login)
  if (req.query.pw === APP_PASSWORD) {
    res.cookie("dh_auth", APP_PASSWORD, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    return res.redirect(req.path);
  }

  // Check POST body (login form)
  if (req.body?.password === APP_PASSWORD) {
    res.cookie("dh_auth", APP_PASSWORD, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    return res.redirect("/");
  }

  // Show login page
  res.status(401).send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Delta Hedge - Login</title>
<style>
  body{background:#0d1117;color:#e6edf3;font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
  .login{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:32px;width:300px;text-align:center}
  h1{color:#fff;font-size:1.2rem;letter-spacing:.1em;margin:0 0 20px}
  input{background:#0d1117;border:1px solid #30363d;color:#e6edf3;padding:10px;border-radius:6px;width:100%;font-size:1rem;margin-bottom:12px;box-sizing:border-box}
  input:focus{outline:none;border-color:#58a6ff}
  button{background:#58a6ff;color:#fff;border:none;padding:10px;border-radius:8px;width:100%;font-size:1rem;font-weight:600;cursor:pointer}
  button:hover{opacity:.85}
  .err{color:#f85149;font-size:.85rem;margin-top:8px}
</style></head>
<body><div class="login"><h1>DELTA HEDGE</h1>
<form method="POST" action="/login"><input type="password" name="password" placeholder="Password" autofocus>
<button type="submit">Enter</button></form></div></body></html>`);
}

// Cookie parser (lightweight, no dependency)
app.use((req, _res, next) => {
  req.cookies = {};
  const cookie = req.headers.cookie;
  if (cookie) {
    cookie.split(";").forEach((c) => {
      const [k, v] = c.trim().split("=");
      if (k && v) req.cookies[k] = decodeURIComponent(v);
    });
  }
  next();
});

// Login POST endpoint
app.post("/login", requireAuth);

// Health check is public (for Render)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Everything else requires auth
app.use(requireAuth);
app.use(express.static(path.join(__dirname, "..", "public")));

// ── Live positions + hedge calculations ─────────────────────────────

app.get("/api/positions", async (_req, res) => {
  try {
    const positions = await getAllPositionsWithHedges();
    res.json(positions);
  } catch (error) {
    console.error("Error fetching positions:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── Simulate a hypothetical position ────────────────────────────────

app.post("/api/simulate", (req, res) => {
  try {
    const { pair, rangeLow, rangeHigh, amount, entryToken } = req.body;

    if (!pair || !rangeLow || !rangeHigh || !amount || !entryToken) {
      return res.status(400).json({ error: "Missing required fields: pair, rangeLow, rangeHigh, amount, entryToken" });
    }

    const result = simulatePosition({
      pair,
      rangeLow: parseFloat(rangeLow),
      rangeHigh: parseFloat(rangeHigh),
      amount: parseFloat(amount),
      entryToken,
    });

    res.json(result);
  } catch (error) {
    console.error("Simulation error:", error.message);
    res.status(400).json({ error: error.message });
  }
});

// ── Available pools for dropdown ────────────────────────────────────

app.get("/api/pools", (_req, res) => {
  res.json(getAvailablePairs());
});

// ── Start ───────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Delta Hedge running at http://localhost:${PORT}`);
  console.log(`Wallet: ${process.env.WALLET_ADDRESS}`);
});
