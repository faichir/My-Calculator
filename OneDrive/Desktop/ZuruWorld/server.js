require("dotenv").config();
const express = require("express");
const Database = require("better-sqlite3");
const fs = require("fs"),
  path = require("path");

const dbPath = process.env.DB_PATH || "./data/zuru.db";
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// ---- Data storage: all company data lives in this SQLite file ----
db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, sector TEXT, country TEXT,
  contact_name TEXT, contact_email TEXT, website TEXT,
  status TEXT DEFAULT 'not_reached', -- not_reached | contacted | replied | meeting | won | lost
  last_contacted TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY, company_id INTEGER, direction TEXT DEFAULT 'out', -- out | in
  subject TEXT, body TEXT, status TEXT DEFAULT 'draft', -- draft | approved | sent | received
  needs_attention INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY, company_id INTEGER, title TEXT NOT NULL,
  starts_at TEXT NOT NULL, location TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, due TEXT, done INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
if (!db.prepare("SELECT COUNT(*) c FROM tasks").get().c) {
  const t = db.prepare("INSERT INTO tasks (title) VALUES (?)");
  [
    "Build target list: insurance companies",
    "Build target list: real estate agencies",
    "Draft first pitch email",
    "Set up Gmail connection",
  ].forEach((x) => t.run(x));
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json());

// ---- Login: one shared password, set in .env (APP_PASSWORD) ----
const crypto = require("crypto");
const PASS = process.env.APP_PASSWORD,
  SECRET = process.env.SESSION_SECRET || "change-this-secret";
const sign = (v) => crypto.createHmac("sha256", SECRET).update(v).digest("hex");
const same = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a)).digest(),
    y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
const getCookie = (req, n) =>
  (req.headers.cookie || "")
    .split("; ")
    .map((c) => c.split("="))
    .find((c) => c[0] === n)?.[1];
const validSession = (req) => {
  const t = getCookie(req, "zs");
  if (!t) return false;
  const [exp, sig] = t.split(".");
  return Number(exp) > Date.now() && sig && same(sig, sign(exp));
};
const fails = {};
app.post("/api/login", (req, res) => {
  const ip = req.ip,
    f = fails[ip] || { n: 0, t: Date.now() };
  if (Date.now() - f.t > 15 * 60e3) {
    f.n = 0;
    f.t = Date.now();
  }
  if (f.n >= 5)
    return res
      .status(429)
      .json({ error: "Too many attempts. Try again in 15 minutes." });
  if (!PASS || !same(req.body.password || "", PASS)) {
    f.n++;
    fails[ip] = f;
    return res.status(401).json({ error: "Wrong password." });
  }
  const exp = String(Date.now() + 7 * 864e5);
  res.setHeader(
    "Set-Cookie",
    `zs=${exp}.${sign(exp)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${req.secure ? "; Secure" : ""}`,
  );
  res.json({ ok: true });
});
app.get("/logout", (req, res) => {
  res.setHeader("Set-Cookie", "zs=; Path=/; Max-Age=0");
  res.redirect("/login.html");
});
app.use((req, res, next) => {
  if (!PASS) return next(); // no password set = open (local testing only)
  if (req.path === "/login.html" || req.path === "/api/login") return next();
  if (validSession(req)) return next();
  return req.path.startsWith("/api")
    ? res.status(401).json({ error: "Not logged in" })
    : res.redirect("/login.html");
});
app.use(express.static(path.join(__dirname, "public")));

const wrap = (fn) => (req, res) => {
  try {
    res.json(fn(req));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

app.get(
  "/api/summary",
  wrap(() => {
    const c = (s) => db.prepare(s).get().c;
    const today = new Date().toISOString().slice(0, 10);
    return {
      companiesTotal: c("SELECT COUNT(*) c FROM companies"),
      reached: c(
        "SELECT COUNT(*) c FROM companies WHERE status!='not_reached'",
      ),
      notReached: c(
        "SELECT COUNT(*) c FROM companies WHERE status='not_reached'",
      ),
      emailsAttention: c(
        "SELECT COUNT(*) c FROM emails WHERE needs_attention=1",
      ),
      drafts: c("SELECT COUNT(*) c FROM emails WHERE status='draft'"),
      eventsToday: c(
        `SELECT COUNT(*) c FROM appointments WHERE date(starts_at)='${today}'`,
      ),
      tasksPending: c("SELECT COUNT(*) c FROM tasks WHERE done=0"),
      tasksDone: c("SELECT COUNT(*) c FROM tasks WHERE done=1"),
      replies: c("SELECT COUNT(*) c FROM companies WHERE status='replied'"),
    };
  }),
);

app.get(
  "/api/companies",
  wrap((r) =>
    r.query.status
      ? db
          .prepare("SELECT * FROM companies WHERE status=? ORDER BY id DESC")
          .all(r.query.status)
      : db.prepare("SELECT * FROM companies ORDER BY id DESC").all(),
  ),
);
app.post(
  "/api/companies",
  wrap((r) => {
    const b = r.body;
    if (!b.name) throw new Error("name required");
    const i = db
      .prepare(
        "INSERT INTO companies (name,sector,country,contact_name,contact_email,website) VALUES (?,?,?,?,?,?)",
      )
      .run(
        b.name,
        b.sector,
        b.country,
        b.contact_name,
        b.contact_email,
        b.website,
      );
    return db
      .prepare("SELECT * FROM companies WHERE id=?")
      .get(i.lastInsertRowid);
  }),
);
app.patch(
  "/api/companies/:id",
  wrap((r) => {
    const ok = [
      "status",
      "notes",
      "contact_email",
      "contact_name",
      "last_contacted",
    ];
    for (const k of Object.keys(r.body))
      if (ok.includes(k))
        db.prepare(`UPDATE companies SET ${k}=? WHERE id=?`).run(
          r.body[k],
          r.params.id,
        );
    return db.prepare("SELECT * FROM companies WHERE id=?").get(r.params.id);
  }),
);

app.get(
  "/api/emails",
  wrap(() =>
    db
      .prepare(
        `SELECT e.*, c.name company FROM emails e
  LEFT JOIN companies c ON c.id=e.company_id ORDER BY e.id DESC LIMIT 20`,
      )
      .all(),
  ),
);
app.get(
  "/api/appointments",
  wrap(() =>
    db
      .prepare(
        "SELECT * FROM appointments WHERE date(starts_at)>=date('now') ORDER BY starts_at LIMIT 10",
      )
      .all(),
  ),
);
app.post(
  "/api/appointments",
  wrap((r) => {
    const b = r.body;
    if (!b.title || !b.starts_at)
      throw new Error("title and starts_at required");
    db.prepare(
      "INSERT INTO appointments (company_id,title,starts_at,location) VALUES (?,?,?,?)",
    ).run(b.company_id || null, b.title, b.starts_at, b.location);
    return { ok: true };
  }),
);
app.get(
  "/api/tasks",
  wrap(() => db.prepare("SELECT * FROM tasks ORDER BY done, id DESC").all()),
);
app.post(
  "/api/tasks",
  wrap((r) => {
    if (!r.body.title) throw new Error("title required");
    db.prepare("INSERT INTO tasks (title,due) VALUES (?,?)").run(
      r.body.title,
      r.body.due,
    );
    return { ok: true };
  }),
);
app.patch(
  "/api/tasks/:id",
  wrap((r) => {
    db.prepare("UPDATE tasks SET done=? WHERE id=?").run(
      r.body.done ? 1 : 0,
      r.params.id,
    );
    return { ok: true };
  }),
);

require("./agent")(app, db);
app.listen(process.env.PORT || 3000, () =>
  console.log("Zuru agent running on port " + (process.env.PORT || 3000)),
);
