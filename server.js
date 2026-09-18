import "dotenv/config";
import express from "express";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import pg from "pg";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 7700);
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-this-secret";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL || "";
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false, max: 5 }) : null;

const dataDir = path.join(__dirname, "data");
const dbFile = path.join(dataDir, "db.json");
fs.mkdirSync(dataDir, { recursive: true });

const starterSubjects = [
  { name: "Data Structures", color: "#8b5cf6" },
  { name: "Python", color: "#3b82f6" },
  { name: "DBMS", color: "#14b8a6" },
  { name: "Machine Learning", color: "#f59e0b" }
];

const starterFlashcards = [
  ["What is an array?", "A contiguous collection of elements accessed by index."],
  ["What is a stack?", "A LIFO data structure where the last inserted item is removed first."],
  ["What is a queue?", "A FIFO data structure where the first inserted item is removed first."],
  ["What is a linked list?", "A sequence of nodes where each node stores data and a link to another node."],
  ["What is Big-O notation?", "A way to describe the asymptotic growth of an algorithm's time or space usage."],
  ["What is a Python list?", "A mutable ordered collection that can contain values of different types."],
  ["What is a Python tuple?", "An ordered, immutable collection."],
  ["What is a Python dictionary?", "A mutable mapping of keys to values."],
  ["What is a function?", "A reusable block of code that performs a defined task."],
  ["What is normalization in DBMS?", "Organizing relational data to reduce redundancy and update anomalies."],
  ["What is a primary key?", "A column or set of columns that uniquely identifies each row."],
  ["What is a foreign key?", "A field that references a key in another table to represent a relationship."],
  ["What is SQL?", "Structured Query Language used to manage and query relational databases."],
  ["What is a JOIN?", "An SQL operation used to combine rows from related tables."],
  ["What is supervised learning?", "Machine learning using labeled examples to learn a mapping from inputs to outputs."],
  ["What is unsupervised learning?", "Learning patterns from data without labeled target values."],
  ["What is overfitting?", "When a model learns training data too closely and performs poorly on unseen data."],
  ["What is a feature?", "An input variable used by a machine-learning model."],
  ["What is an algorithm?", "A finite sequence of steps for solving a problem."],
  ["What is recursion?", "A technique where a function solves a problem by calling itself on smaller instances."],
  ["What is a class in Python?", "A blueprint for creating objects with attributes and methods."],
  ["What is an API?", "An interface that lets software systems communicate through defined operations."],
  ["What is Git?", "A distributed version-control system used to track code changes."],
  ["What is a database index?", "A data structure that speeds up data retrieval at the cost of storage and write overhead."]
];

const quizBank = [
  ["Which structure follows LIFO?", ["Queue", "Stack", "Graph", "Heap"], 1],
  ["Which Python type is immutable?", ["List", "Dictionary", "Tuple", "Set"], 2],
  ["Which key uniquely identifies a row?", ["Foreign key", "Primary key", "Candidate value", "Index only"], 1],
  ["Which SQL command retrieves rows?", ["SELECT", "PUSH", "FETCHROW", "SHOWROW"], 0],
  ["What does overfitting mean?", ["Model is too simple", "Model memorizes training patterns too closely", "Data has no labels", "Training never starts"], 1],
  ["Which is supervised learning?", ["Classification with labeled data", "Clustering", "Association mining", "Dimensionality-free search"], 0],
  ["What is Big-O mainly used for?", ["UI design", "Algorithm growth analysis", "Password hashing", "Database backup"], 1],
  ["Which Python structure maps keys to values?", ["Tuple", "Dictionary", "String", "Array"], 1],
  ["What does a foreign key usually represent?", ["A password", "A relationship to another table", "A CSS class", "A loop"], 1],
  ["What is normalization intended to reduce?", ["Screen size", "Data redundancy", "Network speed", "Source code"], 1]
];

function now() { return new Date().toISOString(); }

function emptyDB() {
  return { users: [], subjects: [], tasks: [], flashcards: [], quizAttempts: [], sessions: [] };
}

function readDB() {
  if (!fs.existsSync(dbFile)) {
    const db = emptyDB();
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
    return db;
  }
  try {
    return JSON.parse(fs.readFileSync(dbFile, "utf8"));
  } catch {
    const db = emptyDB();
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
    return db;
  }
}

let db = readDB();
let dbSaveQueue = Promise.resolve();

function saveDB() {
  const tmp = dbFile + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, dbFile);

  if (pool) {
    const snapshot = JSON.parse(JSON.stringify(db));
    dbSaveQueue = dbSaveQueue
      .then(() => pool.query(
        `INSERT INTO app_state (id, data, updated_at) VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        ["main", JSON.stringify(snapshot)]
      ))
      .catch(error => console.error("Database save failed:", error.message));
  }
}

async function initDatabase() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const result = await pool.query("SELECT data FROM app_state WHERE id = $1", ["main"]);
  if (result.rows[0]?.data) {
    db = result.rows[0].data;
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
  } else {
    await pool.query(
      `INSERT INTO app_state (id, data, updated_at) VALUES ($1, $2::jsonb, NOW())`,
      ["main", JSON.stringify(db)]
    );
  }
}

function id(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, original] = String(stored).split(":");
  if (!salt || !original) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(original, "hex"));
}

function tokenFor(user) {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: "7d" });
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find(u => u.id === payload.sub);
    if (!user) throw new Error("User not found");
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Please log in again." });
  }
}

function cleanText(v, max = 500) {
  return String(v ?? "").trim().slice(0, max);
}

app.use(express.json({ limit: "1mb" }));
app.get("/health", (req, res) => res.json({ ok: true, database: Boolean(pool), ai: Boolean(OPENAI_API_KEY) }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/auth/register", (req, res) => {
  const name = cleanText(req.body.name, 80);
  const email = cleanText(req.body.email, 160).toLowerCase();
  const password = String(req.body.password || "");

  if (name.length < 2) return res.status(400).json({ error: "Enter your name." });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  if (db.users.some(u => u.email === email)) return res.status(409).json({ error: "An account with that email already exists." });

  const user = { id: id("usr"), name, email, passwordHash: hashPassword(password), createdAt: now() };
  db.users.push(user);

  starterSubjects.forEach((s, i) => {
    db.subjects.push({ id: id("sub"), userId: user.id, name: s.name, color: s.color, createdAt: now(), order: i });
  });

  starterFlashcards.forEach(([front, back], i) => {
    db.flashcards.push({ id: id("fc"), userId: user.id, subject: starterSubjects[i % starterSubjects.length].name, front, back, createdAt: now() });
  });

  saveDB();
  res.json({ token: tokenFor(user), user: publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const email = cleanText(req.body.email, 160).toLowerCase();
  const password = String(req.body.password || "");
  const user = db.users.find(u => u.email === email);
  if (!user || !verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: "Invalid email or password." });
  res.json({ token: tokenFor(user), user: publicUser(user) });
});

app.get("/api/me", auth, (req, res) => res.json({ user: publicUser(req.user) }));

app.get("/api/dashboard", auth, (req, res) => {
  const userId = req.user.id;
  const subjects = db.subjects.filter(x => x.userId === userId);
  const tasks = db.tasks.filter(x => x.userId === userId);
  const flashcards = db.flashcards.filter(x => x.userId === userId);
  const attempts = db.quizAttempts.filter(x => x.userId === userId);
  const sessions = db.sessions.filter(x => x.userId === userId);
  const completed = tasks.filter(x => x.completed).length;
  const studyMinutes = sessions.reduce((sum, x) => sum + Number(x.minutes || 0), 0);
  const averageQuiz = attempts.length ? Math.round(attempts.reduce((s, x) => s + x.score, 0) / attempts.length) : 0;
  const bySubject = subjects.map(s => {
    const st = tasks.filter(t => t.subjectId === s.id);
    return { ...s, totalTasks: st.length, completedTasks: st.filter(t => t.completed).length };
  });
  res.json({
    subjects: bySubject,
    tasks,
    flashcards,
    attempts: attempts.slice(-10).reverse(),
    sessions: sessions.slice(-14).reverse(),
    stats: {
      taskCompletion: tasks.length ? Math.round(completed / tasks.length * 100) : 0,
      studyMinutes,
      studyHours: Math.floor(studyMinutes / 60),
      studyRemainder: studyMinutes % 60,
      averageQuiz,
      streak: calculateStreak(sessions)
    }
  });
});

function calculateStreak(sessions) {
  const days = new Set(sessions.map(s => s.date.slice(0, 10)));
  let count = 0;
  const d = new Date();
  while (days.has(d.toISOString().slice(0, 10))) {
    count++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return count;
}

app.post("/api/subjects", auth, (req, res) => {
  const name = cleanText(req.body.name, 80);
  const color = cleanText(req.body.color, 30) || "#8b5cf6";
  if (!name) return res.status(400).json({ error: "Subject name is required." });
  if (db.subjects.some(s => s.userId === req.user.id && s.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: "That subject already exists." });
  }
  const subject = { id: id("sub"), userId: req.user.id, name, color, createdAt: now() };
  db.subjects.push(subject);
  saveDB();
  res.json(subject);
});

app.delete("/api/subjects/:id", auth, (req, res) => {
  const subject = db.subjects.find(s => s.id === req.params.id && s.userId === req.user.id);
  if (!subject) return res.status(404).json({ error: "Subject not found." });
  db.subjects = db.subjects.filter(s => s.id !== subject.id);
  db.tasks = db.tasks.filter(t => !(t.userId === req.user.id && t.subjectId === subject.id));
  saveDB();
  res.json({ ok: true });
});

app.post("/api/tasks", auth, (req, res) => {
  const title = cleanText(req.body.title, 120);
  const subjectId = cleanText(req.body.subjectId, 80);
  const minutes = Math.max(5, Math.min(600, Number(req.body.minutes || 30)));
  const priority = ["low", "medium", "high"].includes(req.body.priority) ? req.body.priority : "medium";
  const dueDate = cleanText(req.body.dueDate, 20);
  if (!title) return res.status(400).json({ error: "Task title is required." });
  if (subjectId && !db.subjects.some(s => s.id === subjectId && s.userId === req.user.id)) return res.status(400).json({ error: "Invalid subject." });
  const task = { id: id("task"), userId: req.user.id, title, subjectId, minutes, priority, dueDate, completed: false, createdAt: now(), completedAt: null };
  db.tasks.push(task);
  saveDB();
  res.json(task);
});

app.patch("/api/tasks/:id", auth, (req, res) => {
  const task = db.tasks.find(t => t.id === req.params.id && t.userId === req.user.id);
  if (!task) return res.status(404).json({ error: "Task not found." });
  if (typeof req.body.completed === "boolean") {
    task.completed = req.body.completed;
    task.completedAt = task.completed ? now() : null;
  }
  if (req.body.title !== undefined) task.title = cleanText(req.body.title, 120);
  if (req.body.minutes !== undefined) task.minutes = Math.max(5, Math.min(600, Number(req.body.minutes)));
  if (req.body.priority !== undefined && ["low", "medium", "high"].includes(req.body.priority)) task.priority = req.body.priority;
  if (req.body.dueDate !== undefined) task.dueDate = cleanText(req.body.dueDate, 20);
  saveDB();
  res.json(task);
});

app.delete("/api/tasks/:id", auth, (req, res) => {
  const before = db.tasks.length;
  db.tasks = db.tasks.filter(t => !(t.id === req.params.id && t.userId === req.user.id));
  if (db.tasks.length === before) return res.status(404).json({ error: "Task not found." });
  saveDB();
  res.json({ ok: true });
});

app.post("/api/flashcards", auth, (req, res) => {
  const front = cleanText(req.body.front, 500);
  const back = cleanText(req.body.back, 1000);
  const subject = cleanText(req.body.subject, 80) || "General";
  if (!front || !back) return res.status(400).json({ error: "Both question and answer are required." });
  const card = { id: id("fc"), userId: req.user.id, subject, front, back, createdAt: now() };
  db.flashcards.push(card);
  saveDB();
  res.json(card);
});

app.delete("/api/flashcards/:id", auth, (req, res) => {
  db.flashcards = db.flashcards.filter(f => !(f.id === req.params.id && f.userId === req.user.id));
  saveDB();
  res.json({ ok: true });
});

app.post("/api/sessions", auth, (req, res) => {
  const minutes = Math.max(1, Math.min(600, Number(req.body.minutes || 1)));
  const session = { id: id("ses"), userId: req.user.id, minutes, date: now(), subjectId: cleanText(req.body.subjectId, 80) };
  db.sessions.push(session);
  saveDB();
  res.json(session);
});

app.post("/api/quiz/submit", auth, (req, res) => {
  const score = Math.max(0, Math.min(100, Number(req.body.score || 0)));
  const total = Math.max(1, Number(req.body.total || 10));
  const subject = cleanText(req.body.subject, 80) || "General";
  const attempt = { id: id("quiz"), userId: req.user.id, score, total, subject, date: now() };
  db.quizAttempts.push(attempt);
  saveDB();
  res.json(attempt);
});

app.get("/api/quiz", auth, (req, res) => {
  const shuffled = [...quizBank].sort(() => Math.random() - 0.5).slice(0, 10);
  res.json(shuffled.map((q, i) => ({ id: i + 1, question: q[0], options: q[1], answer: q[2] })));
});

app.get("/api/ai/status", auth, (req, res) => {
  res.json({ configured: Boolean(OPENAI_API_KEY), model: OPENAI_MODEL });
});

app.post("/api/ai/chat", auth, async (req, res) => {
  const message = cleanText(req.body.message, 4000);
  const history = Array.isArray(req.body.history) ? req.body.history.slice(-12) : [];
  if (!message) return res.status(400).json({ error: "Ask a question first." });

  if (!OPENAI_API_KEY) {
    return res.status(503).json({ error: "Live AI is not configured yet. Add your OPENAI_API_KEY to the .env file, restart AI StudyMate, and ask again." });
  }

  try {
    const input = [
      {
        role: "system",
        content: [{
          type: "input_text",
          text: "You are AI StudyMate, an expert academic tutor. Answer the user's actual question directly and accurately. Do not give generic advice when a concrete answer is possible. For technical questions, reason carefully, define terms, show the correct formula/algorithm/code when relevant, and verify calculations before answering. For ambiguous questions, ask one concise clarification only when necessary. Match the user's requested level and format. For B.Tech CSE/Data Science topics, prefer clear step-by-step explanations and concrete examples. If the user asks for code, provide runnable code and explain the important parts. Never claim to have checked a source unless you actually did. Do not mention being in demo mode when live AI is configured."
        }]
      },
      ...history.filter(m => m && (m.role === "user" || m.role === "assistant")).map(m => ({
        role: m.role,
        content: [{ type: "input_text", text: cleanText(m.content, 3000) }]
      })),
      { role: "user", content: [{ type: "input_text", text: message }] }
    ];

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({ model: OPENAI_MODEL, input })
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("OpenAI error:", detail);
      return res.status(502).json({ error: "The AI service could not answer right now. Check your API key/model and try again." });
    }

    const data = await response.json();
    const answer = data.output_text || data.output?.flatMap(x => x.content || []).map(x => x.text || "").join("\n").trim();
    res.json({ mode: "live", answer: answer || "I received an empty AI response. Please try again." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "AI connection failed. Please try again." });
  }
});

app.post("/api/ai/insights", auth, async (req, res) => {
  const userId = req.user.id;
  const tasks = db.tasks.filter(t => t.userId === userId);
  const subjects = db.subjects.filter(s => s.userId === userId);
  const attempts = db.quizAttempts.filter(a => a.userId === userId);
  const sessions = db.sessions.filter(s => s.userId === userId);
  const summary = {
    subjects: subjects.map(s => s.name),
    pendingTasks: tasks.filter(t => !t.completed).slice(0, 8).map(t => t.title),
    completedTasks: tasks.filter(t => t.completed).length,
    totalTasks: tasks.length,
    quizScores: attempts.slice(-8).map(a => a.score),
    studyMinutes: sessions.reduce((a, b) => a + b.minutes, 0)
  };

  if (!OPENAI_API_KEY) {
    const weakest = subjects.find(s => tasks.some(t => t.subjectId === s.id && !t.completed))?.name || "your next priority";
    return res.json({ mode: "demo", insight: `Focus next on ${weakest}. You have ${summary.pendingTasks.length} visible pending task(s). Keep one focused session short and finish it before switching topics.` });
  }

  try {
    const prompt = `Create 3 concise, personalized study insights from this JSON. Mention one strength, one improvement area, and one next action. Data: ${JSON.stringify(summary)}`;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }]
      })
    });
    if (!response.ok) return res.status(502).json({ error: "AI insight generation failed." });
    const data = await response.json();
    res.json({ mode: "live", insight: data.output_text || "Keep building consistent study sessions." });
  } catch {
    res.status(500).json({ error: "Could not generate insights." });
  }
});

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initDatabase()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => console.log(`AI StudyMate running on port ${PORT}`));
  })
  .catch(error => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
