require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const cron = require("node-cron");
const db = require("./db");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const JWT_SECRET = process.env.JWT_SECRET || "CHANGE-ME-BEFORE-DEPLOYING";
const ADMIN_CODE = process.env.ADMIN_CODE || "CHANGE-ME-ADMIN-CODE";
const TICKET_COST = parseInt(process.env.TICKET_COST || "10", 10);
const START_BALANCE = parseInt(process.env.START_BALANCE || "500", 10);
const DRAW_HOUR_UTC = parseInt(process.env.DRAW_HOUR_UTC || "20", 10);
const JACKPOT_BASE = parseInt(process.env.JACKPOT_BASE || "1000", 10);
const JACKPOT_CONTRIB = parseInt(process.env.JACKPOT_CONTRIB || "5", 10);

if (JWT_SECRET === "CHANGE-ME-BEFORE-DEPLOYING") {
  console.warn("WARNING: JWT_SECRET is not set. Set it in your .env before deploying publicly.");
}

/* ---------------------------- crypto helpers ---------------------------- */
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash);
  const b = Buffer.from(check);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 24 * 3600 * 1000 })).toString(
    "base64url"
  );
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(body).digest("base64url");
  return body + "." + sig;
}
function verifyToken(token) {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(body).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Not authenticated" });
  req.username = payload.username;
  next();
}
function adminOnly(req, res, next) {
  const u = db.getUser(req.username);
  if (!u || u.role !== "admin") return res.status(403).json({ error: "Admins only" });
  next();
}
function publicUser(u) {
  return { username: u.username, balance: u.balance, role: u.role };
}

/* ---------------------------- draw engine ---------------------------- */
function activeDrawDate(now = new Date()) {
  const d = new Date(now);
  if (d.getUTCHours() >= DRAW_HOUR_UTC) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function drawSixNumbers() {
  const pool = Array.from({ length: 49 }, (_, i) => i + 1);
  const picked = [];
  for (let i = 0; i < 6; i++) {
    const idx = crypto.randomInt(0, pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked.sort((a, b) => a - b);
}
function prizeForMatches(n) {
  if (n === 6) return { tier: "jackpot", amount: null };
  if (n === 5) return { tier: "5", amount: 200 };
  if (n === 4) return { tier: "4", amount: 50 };
  if (n === 3) return { tier: "3", amount: 10 };
  return { tier: null, amount: 0 };
}
function processDraw(dateStr) {
  const winning = drawSixNumbers();
  const tickets = db.getTicketsForDate(dateStr);
  const jackpot = db.getJackpot();
  const winners = [];
  for (const t of tickets) {
    const matches = t.numbers.filter((n) => winning.includes(n)).length;
    const p = prizeForMatches(matches);
    let amount = p.amount;
    if (p.tier === "jackpot") amount = jackpot;
    t.matches = matches;
    t.prize = amount || 0;
    if (amount > 0) {
      const u = db.getUser(t.username);
      if (u) {
        u.balance += amount;
        db.saveUser(u);
      }
      winners.push({ username: t.username, matches, amount });
    }
    db.updateTicket(t);
  }
  const jackpotWon = winners.some((w) => w.matches === 6);
  const newJackpot = JACKPOT_BASE;
  db.setJackpot(newJackpot);
  db.saveDraw({
    date: dateStr,
    winningNumbers: winning,
    ticketCount: tickets.length,
    winners,
    jackpotWon,
    jackpotAmount: jackpotWon ? jackpot : null,
  });
  console.log(
    "Draw processed for " + dateStr + ":",
    winning,
    "(" + tickets.length + " tickets, " + winners.length + " winners)"
  );
}
function processDueDraws() {
  const openDate = activeDrawDate();
  for (const d of db.getSalesDates()) {
    if (d >= openDate) continue;
    if (db.getDraw(d)) continue;
    processDraw(d);
  }
}

/* ---------------------------- auth routes ---------------------------- */
app.post("/api/register", (req, res) => {
  const { username, password, adminCode } = req.body || {};
  const uname = (username || "").trim().toLowerCase();
  if (uname.length < 3) return res.status(400).json({ error: "Username needs at least 3 characters." });
  if (!password || password.length < 4) return res.status(400).json({ error: "Password needs at least 4 characters." });
  if (db.getUser(uname)) return res.status(400).json({ error: "That username is taken." });
  let role = "pending";
  if (adminCode) {
    if (adminCode !== ADMIN_CODE) return res.status(400).json({ error: "Invalid admin code." });
    role = "admin";
  }
  const user = {
    username: uname,
    passHash: hashPassword(password),
    balance: START_BALANCE,
    role,
    createdAt: Date.now(),
  };
  db.saveUser(user);
  res.json({ token: signToken({ username: uname }), user: publicUser(user) });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const uname = (username || "").trim().toLowerCase();
  const user = db.getUser(uname);
  if (!user || !verifyPassword(password || "", user.passHash)) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }
  res.json({ token: signToken({ username: uname }), user: publicUser(user) });
});

app.get("/api/me", auth, (req, res) => {
  const user = db.getUser(req.username);
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json({ user: publicUser(user) });
});

/* ---------------------------- public data ---------------------------- */
app.get("/api/jackpot", (req, res) => res.json({ amount: db.getJackpot() }));
app.get("/api/draws", (req, res) => res.json({ draws: db.getRecentDraws(14) }));
app.get("/api/state", (req, res) =>
  res.json({ openDate: activeDrawDate(), drawHourUtc: DRAW_HOUR_UTC, ticketCost: TICKET_COST })
);

/* ---------------------------- tickets ---------------------------- */
app.get("/api/tickets/mine", auth, (req, res) => {
  res.json({ tickets: db.getUserTickets(req.username) });
});

app.post("/api/tickets", auth, (req, res) => {
  const user = db.getUser(req.username);
  if (!user) return res.status(404).json({ error: "Not found" });
  if (user.role === "pending") return res.status(403).json({ error: "Your account is awaiting admin approval." });
  const { numbers } = req.body || {};
  if (
    !Array.isArray(numbers) ||
    numbers.length !== 6 ||
    new Set(numbers).size !== 6 ||
    numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 49)
  ) {
    return res.status(400).json({ error: "Pick 6 unique numbers between 1 and 49." });
  }
  if (user.balance < TICKET_COST) return res.status(400).json({ error: "Not enough coins." });

  const drawDate = activeDrawDate();
  user.balance -= TICKET_COST;
  db.saveUser(user);

  const ticket = {
    id: user.username + "-" + Date.now() + "-" + crypto.randomInt(0, 9999),
    username: user.username,
    numbers: [...numbers].sort((a, b) => a - b),
    date: drawDate,
    boughtAt: Date.now(),
  };
  db.addTicket(ticket);
  // db.addJackpot(JACKPOT_CONTRIB); // jackpot is fixed now, not increased by ticket sales

  res.json({ ticket, user: publicUser(user) });
});

/* ---------------------------- top-up requests ---------------------------- */
app.post("/api/topup/request", auth, (req, res) => {
  const user = db.getUser(req.username);
  if (!user) return res.status(404).json({ error: "Not found" });
  const amount = parseInt((req.body || {}).amount, 10);
  if (!amount || amount <= 0) return res.status(400).json({ error: "Enter a valid amount." });
  const request = {
    id: user.username + "-" + Date.now() + "-" + crypto.randomInt(0, 9999),
    username: user.username,
    amount,
    status: "pending",
    createdAt: Date.now(),
  };
  db.addTopupRequest(request);
  res.json({ request });
});

app.get("/api/topup/mine", auth, (req, res) => {
  res.json({ requests: db.getUserTopupRequests(req.username) });
});

app.get("/api/admin/topup-requests", auth, adminOnly, (req, res) => {
  res.json({ requests: db.getPendingTopupRequests() });
});

app.post("/api/admin/topup/:id/approve", auth, adminOnly, (req, res) => {
  const request = db.getTopupRequest(req.params.id);
  if (!request) return res.status(404).json({ error: "Request not found" });
  if (request.status !== "pending") return res.status(400).json({ error: "Request already handled" });
  const targetUser = db.getUser(request.username);
  if (!targetUser) return res.status(404).json({ error: "User not found" });
  targetUser.balance += request.amount;
  db.saveUser(targetUser);
  const updated = db.updateTopupRequest(request.id, {
    status: "approved",
    resolvedAt: Date.now(),
    resolvedBy: req.username,
  });
  res.json({ request: updated });
});

app.post("/api/admin/topup/:id/reject", auth, adminOnly, (req, res) => {
  const request = db.getTopupRequest(req.params.id);
  if (!request) return res.status(404).json({ error: "Request not found" });
  if (request.status !== "pending") return res.status(400).json({ error: "Request already handled" });
  const updated = db.updateTopupRequest(request.id, {
    status: "rejected",
    resolvedAt: Date.now(),
    resolvedBy: req.username,
  });
  res.json({ request: updated });
});

/* ---------------------------- admin: users ---------------------------- */
app.get("/api/admin/pending", auth, adminOnly, (req, res) => {
  res.json({ users: db.getAllUsers().filter((u) => u.role === "pending").map(publicUser) });
});
app.get("/api/admin/users", auth, adminOnly, (req, res) => {
  res.json({ users: db.getAllUsers().map(publicUser) });
});
app.post("/api/admin/approve/:username", auth, adminOnly, (req, res) => {
  const u = db.getUser(req.params.username.toLowerCase());
  if (!u) return res.status(404).json({ error: "Not found" });
  u.role = "approved";
  db.saveUser(u);
  res.json({ user: publicUser(u) });
});
app.post("/api/admin/balance/:username", auth, adminOnly, (req, res) => {
  const amt = parseInt((req.body || {}).amount, 10);
  if (!amt || amt <= 0) return res.status(400).json({ error: "Invalid amount" });
  const u = db.getUser(req.params.username.toLowerCase());
  if (!u) return res.status(404).json({ error: "Not found" });
  u.balance += amt;
  db.saveUser(u);
  res.json({ user: publicUser(u) });
});
app.post("/api/admin/balance/:username/deduct", auth, adminOnly, (req, res) => {
  const amt = parseInt((req.body || {}).amount, 10);
  if (!amt || amt <= 0) return res.status(400).json({ error: "Invalid amount" });
  const u = db.getUser(req.params.username.toLowerCase());
  if (!u) return res.status(404).json({ error: "Not found" });
  u.balance = Math.max(0, u.balance - amt);
  db.saveUser(u);
  res.json({ user: publicUser(u) });
});

/* ---------------------------- draw scheduling ---------------------------- */
cron.schedule("*/5 * * * *", processDueDraws);
processDueDraws();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Global Draw server running on port " + PORT));
