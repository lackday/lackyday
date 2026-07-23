const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "db.json");

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      users: {},
      ticketsByDate: {},
      draws: {},
      jackpot: 1000,
      salesDates: [],
      topupRequests: [],
    };
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  const state = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  if (!state.topupRequests) state.topupRequests = [];
  return state;
}

let state = load();

function save() {
  fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
}

module.exports = {
  getUser(username) {
    return state.users[username] || null;
  },
  saveUser(user) {
    state.users[user.username] = user;
    save();
  },
  getAllUsers() {
    return Object.values(state.users);
  },

  addTicket(ticket) {
    if (!state.ticketsByDate[ticket.date]) state.ticketsByDate[ticket.date] = [];
    state.ticketsByDate[ticket.date].push(ticket);
    if (!state.salesDates.includes(ticket.date)) state.salesDates.push(ticket.date);
    save();
  },
  updateTicket(ticket) {
    const arr = state.ticketsByDate[ticket.date] || [];
    const idx = arr.findIndex((t) => t.id === ticket.id);
    if (idx >= 0) arr[idx] = ticket;
    save();
  },
  getTicketsForDate(date) {
    return state.ticketsByDate[date] || [];
  },
  getUserTickets(username) {
    const all = [];
    for (const date of Object.keys(state.ticketsByDate)) {
      for (const t of state.ticketsByDate[date]) {
        if (t.username === username) all.push(t);
      }
    }
    return all.sort((a, b) => a.boughtAt - b.boughtAt);
  },
  getSalesDates() {
    return state.salesDates;
  },

  saveDraw(draw) {
    state.draws[draw.date] = draw;
    save();
  },
  getDraw(date) {
    return state.draws[date] || null;
  },
  getRecentDraws(n) {
    return Object.values(state.draws)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, n);
  },

  getJackpot() {
    return state.jackpot;
  },
  setJackpot(v) {
    state.jackpot = v;
    save();
  },
  addJackpot(delta) {
    state.jackpot += delta;
    save();
  },

  addTopupRequest(reqObj) {
    state.topupRequests.push(reqObj);
    save();
  },
  getUserTopupRequests(username) {
    return state.topupRequests
      .filter((r) => r.username === username)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
  getPendingTopupRequests() {
    return state.topupRequests
      .filter((r) => r.status === "pending")
      .sort((a, b) => a.createdAt - b.createdAt);
  },
  getTopupRequest(id) {
    return state.topupRequests.find((r) => r.id === id) || null;
  },
  updateTopupRequest(id, updates) {
    const idx = state.topupRequests.findIndex((r) => r.id === id);
    if (idx >= 0) {
      state.topupRequests[idx] = { ...state.topupRequests[idx], ...updates };
      save();
      return state.topupRequests[idx];
    }
    return null;
  },
};
