require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 24) {
  console.error("Set JWT_SECRET in .env to a random string at least 24 characters long.");
  process.exit(1);
}

const dataDir = path.join(__dirname, "data");
require("fs").mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "dvozon.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id)
  );
`);

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "200kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: true, legacyHeaders: false }));

const secureCookie = String(process.env.COOKIE_SECURE || "false").toLowerCase() === "true";
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanText(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}
function createToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}
function setAuthCookie(res, token) {
  res.cookie("dvozon_session", token, {
    httpOnly: true, secure: secureCookie, sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, path: "/"
  });
}
function auth(req, res, next) {
  const token = req.cookies.dvozon_session;
  if (!token) return res.status(401).json({ error: "Please log in first." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare("SELECT id,name,email,created_at FROM users WHERE id=?").get(payload.sub);
    if (!user) return res.status(401).json({ error: "Account not found." });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
}
function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email, created_at: user.created_at };
}

app.get("/api/health", (_req, res) => res.json({ ok: true, app: "DVOZON", aiConfigured: Boolean(process.env.AI_API_KEY) }));

app.post("/api/auth/signup", authLimiter, async (req, res) => {
  const name = cleanText(req.body.name, 70);
  const email = cleanText(req.body.email, 190).toLowerCase();
  const password = String(req.body.password || "");
  if (name.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters." });
  if (!emailPattern.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (password.length > 200) return res.status(400).json({ error: "Password is too long." });
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(name, email, hash);
    const user = db.prepare("SELECT id,name,email,created_at FROM users WHERE id=?").get(result.lastInsertRowid);
    setAuthCookie(res, createToken(user));
    res.status(201).json({ user: safeUser(user) });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) return res.status(409).json({ error: "This email is already registered." });
    console.error(err);
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const email = cleanText(req.body.email, 190).toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  setAuthCookie(res, createToken(user));
  res.json({ user: safeUser(user) });
});

app.get("/api/auth/me", auth, (req, res) => res.json({ user: safeUser(req.user) }));
app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("dvozon_session", { httpOnly: true, secure: secureCookie, sameSite: "lax", path: "/" });
  res.json({ ok: true });
});

app.get("/api/conversations", auth, (req, res) => {
  const rows = db.prepare("SELECT id,title,created_at FROM conversations WHERE user_id=? ORDER BY id DESC LIMIT 50").all(req.user.id);
  res.json({ conversations: rows });
});

app.post("/api/conversations", auth, (req, res) => {
  const title = cleanText(req.body.title || "New coding session", 100) || "New coding session";
  const result = db.prepare("INSERT INTO conversations(user_id,title) VALUES(?,?)").run(req.user.id, title);
  res.status(201).json({ conversation: db.prepare("SELECT id,title,created_at FROM conversations WHERE id=?").get(result.lastInsertRowid) });
});

app.get("/api/conversations/:id/messages", auth, (req, res) => {
  const id = Number(req.params.id);
  const conversation = db.prepare("SELECT id FROM conversations WHERE id=? AND user_id=?").get(id, req.user.id);
  if (!conversation) return res.status(404).json({ error: "Session not found." });
  const messages = db.prepare("SELECT id,role,content,created_at FROM messages WHERE conversation_id=? ORDER BY id ASC LIMIT 100").all(id);
  res.json({ messages });
});

app.post("/api/agent/chat", auth, async (req, res) => {
  const prompt = cleanText(req.body.prompt, 12000);
  const mode = cleanText(req.body.mode || "build", 30);
  let conversationId = Number(req.body.conversationId || 0);
  if (prompt.length < 1) return res.status(400).json({ error: "Write a message first." });
  if (prompt.length > 12000) return res.status(400).json({ error: "Message is too long." });

  if (conversationId) {
    const owned = db.prepare("SELECT id FROM conversations WHERE id=? AND user_id=?").get(conversationId, req.user.id);
    if (!owned) return res.status(404).json({ error: "Session not found." });
  } else {
    const title = prompt.replace(/\s+/g, " ").slice(0, 70) || "Coding session";
    const result = db.prepare("INSERT INTO conversations(user_id,title) VALUES(?,?)").run(req.user.id, title);
    conversationId = Number(result.lastInsertRowid);
  }
  db.prepare("INSERT INTO messages(conversation_id,role,content) VALUES(?,?,?)").run(conversationId, "user", prompt);

  if (!process.env.AI_API_KEY) {
    const demo = "DVOZON demo mode: AI provider API key abhi configure nahi hai.\n\n" +
      "Aapka request save ho gaya hai. Real AI jawab ke liye server ke .env file mein AI_API_KEY, AI_BASE_URL aur AI_MODEL set karein.\n\n" +
      "Safe next steps:\n1. Apne AI provider ka API account banayein.\n2. API key server ki .env file mein rakhein — HTML/JavaScript mein kabhi nahi.\n3. Server restart karein: npm start.\n\n" +
      "Mode: " + mode;
    db.prepare("INSERT INTO messages(conversation_id,role,content) VALUES(?,?,?)").run(conversationId, "assistant", demo);
    return res.json({ conversationId, reply: demo, demo: true });
  }

  try {
    const base = String(process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const response = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + process.env.AI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are DVOZON, a careful AI coding assistant. Help users build, debug, and understand code. Explain risky commands before suggesting them. Never claim code was executed unless it was. Do not request secrets. Current mode: " + mode },
          ...db.prepare("SELECT role,content FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 12").all(conversationId).reverse().map(m => ({ role: m.role, content: m.content }))
        ],
        temperature: 0.3
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("AI provider error:", response.status, data?.error?.message || "Unknown error");
      return res.status(502).json({ error: "AI provider request failed. Check API key, model and provider quota." });
    }
    const reply = cleanText(data?.choices?.[0]?.message?.content || "No response returned.", 30000);
    db.prepare("INSERT INTO messages(conversation_id,role,content) VALUES(?,?,?)").run(conversationId, "assistant", reply);
    res.json({ conversationId, reply, demo: false });
  } catch (err) {
    console.error("AI request error:", err.message);
    res.status(502).json({ error: "Could not reach AI provider. Try again later." });
  }
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => console.log(`DVOZON running on http://0.0.0.0:${PORT}`));
