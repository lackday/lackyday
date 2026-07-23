const API = "";
let state = {
  token: localStorage.getItem("gd_token") || null,
  user: null,
  authMode: "login",
  picks: [],
  openDate: null,
  drawHourUtc: 20,
  ticketCost: 10,
};

function showToast(msg, kind) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (kind ? " " + kind : "");
  setTimeout(() => (el.className = "toast hidden"), 3200);
}

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers.Authorization = "Bearer " + state.token;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/* ---------------------------- auth screen ---------------------------- */
document.getElementById("tabLogin").onclick = () => setAuthMode("login");
document.getElementById("tabRegister").onclick = () => setAuthMode("register");
document.getElementById("showAdminCodeLink").onclick = () => {
  document.getElementById("adminCodeWrap").classList.remove("hidden");
  document.getElementById("showAdminCodeLink").classList.add("hidden");
};

function setAuthMode(mode) {
  state.authMode = mode;
  document.getElementById("tabLogin").className = mode === "login" ? "tab-active" : "tab";
  document.getElementById("tabRegister").className = mode === "register" ? "tab-active" : "tab";
  document.getElementById("authSubmit").textContent = mode === "login" ? "Log in" : "Create account";
  document.getElementById("registerNote").classList.toggle("hidden", mode !== "register");
  document.getElementById("showAdminCodeLink").classList.toggle("hidden", mode !== "register");
  document.getElementById("adminCodeWrap").classList.add("hidden");
  document.getElementById("authError").classList.add("hidden");
}

document.getElementById("authForm").onsubmit = async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  const adminCode = document.getElementById("adminCode").value;
  const errEl = document.getElementById("authError");
  errEl.classList.add("hidden");
  try {
    const body = state.authMode === "login" ? { username, password } : { username, password, adminCode };
    const data = await api(state.authMode === "login" ? "/api/login" : "/api/register", {
      method: "POST",
      body: JSON.stringify(body),
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("gd_token", data.token);
    if (state.authMode === "register") {
      showToast(data.user.role === "admin" ? "Admin account created." : "Account created — waiting on approval.", "success");
    }
    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
};

document.getElementById("logoutBtn").onclick = () => {
  state.token = null;
  state.user = null;
  localStorage.removeItem("gd_token");
  document.getElementById("appScreen").classList.add("hidden");
  document.getElementById("authScreen").classList.remove("hidden");
};

/* ---------------------------- app screen ---------------------------- */
async function enterApp() {
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("appScreen").classList.remove("hidden");
  await refreshMe();
  await loadServerState();
  buildNumberGrid();
  renderPicks();
  document.getElementById("adminTabBtn").classList.toggle("hidden", state.user.role !== "admin");

  if (state.user.role === "pending") {
    document.getElementById("pendingNotice").classList.remove("hidden");
    document.getElementById("mainNav").classList.add("hidden");
    document.getElementById("mainContent").classList.add("hidden");
  } else {
    document.getElementById("pendingNotice").classList.add("hidden");
    document.getElementById("mainNav").classList.remove("hidden");
    document.getElementById("mainContent").classList.remove("hidden");
    switchTab("play");
    loadTickets();
    loadDraws();
  }
}

async function refreshMe() {
  const data = await api("/api/me");
  state.user = data.user;
  document.getElementById("balanceText").textContent = data.user.balance.toLocaleString() + " coins";
  document.getElementById("userTag").textContent = "@" + data.user.username;
}

async function loadServerState() {
  const [s, j] = await Promise.all([api("/api/state"), api("/api/jackpot")]);
  state.openDate = s.openDate;
  state.drawHourUtc = s.drawHourUtc;
  state.ticketCost = s.ticketCost;
  document.getElementById("drawTitle").textContent = "Draw for " + s.openDate;
  document.getElementById("buyBtn").textContent = "Buy ticket · " + s.ticketCost + " coins";
  document.getElementById("jackpotAmountAuth").textContent = j.amount.toLocaleString() + " coins";
  document.getElementById("jackpotAmountApp").textContent = j.amount.toLocaleString();
}

/* countdown */
setInterval(() => {
  if (!state.user || state.user.role === "pending") return;
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), state.drawHourUtc, 0, 0));
  if (now.getTime() >= next.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  const diff = next - now;
  const hh = String(Math.floor(diff / 3600000)).padStart(2, "0");
  const mm = String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0");
  const ss = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");
  const el = document.getElementById("countdown");
  if (el) el.textContent = `${hh}:${mm}:${ss}`;
}, 1000);

/* tabs */
document.querySelectorAll(".tab-item").forEach((btn) => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});
function switchTab(tab) {
  document.querySelectorAll(".tab-item").forEach((b) => b.classList.toggle("tab-active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("hidden", p.id !== "tab-" + tab));
  if (tab === "tickets") loadTickets();
  if (tab === "results") loadDraws();
  if (tab === "wallet") loadMyTopups();
  if (tab === "admin") loadAdmin();
}

/* number grid + picks */
function buildNumberGrid() {
  const grid = document.getElementById("numberGrid");
  grid.innerHTML = "";
  for (let n = 1; n <= 49; n++) {
    const btn = document.createElement("button");
    btn.textContent = n;
    btn.className = "num-btn";
    btn.onclick = () => togglePick(n);
    btn.dataset.n = n;
    grid.appendChild(btn);
  }
}
function togglePick(n) {
  const idx = state.picks.indexOf(n);
  if (idx >= 0) state.picks.splice(idx, 1);
  else if (state.picks.length < 6) state.picks.push(n);
  state.picks.sort((a, b) => a - b);
  renderPicks();
}
function renderPicks() {
  document.querySelectorAll(".num-btn, .num-btn-active").forEach((btn) => {
    const n = parseInt(btn.dataset.n, 10);
    btn.className = state.picks.includes(n) ? "num-btn-active" : "num-btn";
  });
  const row = document.getElementById("picksRow");
  row.innerHTML = "";
  for (let i = 0; i < 6; i++) {
    const d = document.createElement("div");
    d.className = state.picks[i] ? "pick-ball-filled" : "pick-ball-empty";
    d.textContent = state.picks[i] || "";
    row.appendChild(d);
  }
  document.getElementById("buyBtn").disabled = state.picks.length !== 6;
}
document.getElementById("quickPickBtn").onclick = () => {
  const pool = Array.from({ length: 49 }, (_, i) => i + 1);
  const chosen = [];
  for (let i = 0; i < 6; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    chosen.push(pool[idx]);
    pool.splice(idx, 1);
  }
  state.picks = chosen.sort((a, b) => a - b);
  renderPicks();
};
document.getElementById("clearBtn").onclick = () => {
  state.picks = [];
  renderPicks();
};
document.getElementById("buyBtn").onclick = async () => {
  try {
    const data = await api("/api/tickets", { method: "POST", body: JSON.stringify({ numbers: state.picks }) });
    state.user = data.user;
    document.getElementById("balanceText").textContent = data.user.balance.toLocaleString() + " coins";
    state.picks = [];
    renderPicks();
    showToast("Ticket entered for the " + data.ticket.date + " draw.", "success");
    await loadServerState();
  } catch (err) {
    showToast(err.message, "error");
  }
};

/* tickets tab */
async function loadTickets() {
  const data = await api("/api/tickets/mine");
  const list = document.getElementById("ticketList");
  list.innerHTML = "";
  if (data.tickets.length === 0) {
    list.innerHTML = '<p class="empty-state">No tickets yet — head to Play to enter today\'s draw.</p>';
    return;
  }
  [...data.tickets].reverse().forEach((t) => {
    const row = document.createElement("div");
    row.className = "row";
    const nums = t.numbers.map((n) => `<span class="mini-ball">${n}</span>`).join("");
    let status;
    if (t.matches === undefined) status = '<span class="pending-txt">Pending</span>';
    else if (t.prize > 0) status = `<span class="won">+${t.prize} coins (${t.matches} matches)</span>`;
    else status = `<span class="lost">${t.matches} matches</span>`;
    row.innerHTML = `<div class="date">${t.date}</div><div class="nums">${nums}</div><div>${status}</div>`;
    list.appendChild(row);
  });
}

/* wallet tab */
document.getElementById("topupRequestBtn").onclick = async () => {
  const input = document.getElementById("topupAmountInput");
  const amount = parseInt(input.value, 10);
  if (!amount || amount <= 0) return showToast("Enter a valid amount first.", "error");
  try {
    await api("/api/topup/request", { method: "POST", body: JSON.stringify({ amount }) });
    input.value = "";
    showToast("Top-up request sent. Waiting on admin approval.", "success");
    loadMyTopups();
  } catch (err) {
    showToast(err.message, "error");
  }
};
async function loadMyTopups() {
  const data = await api("/api/topup/mine");
  const list = document.getElementById("myTopupList");
  list.innerHTML = "";
  if (data.requests.length === 0) {
    list.innerHTML = '<p class="empty-state">No top-up requests yet.</p>';
    return;
  }
  data.requests.forEach((r) => {
    const row = document.createElement("div");
    row.className = "row";
    let statusHtml;
    if (r.status === "pending") statusHtml = '<span class="pending-txt">Pending</span>';
    else if (r.status === "approved") statusHtml = '<span class="won">Approved</span>';
    else statusHtml = '<span class="lost">Rejected</span>';
    const date = new Date(r.createdAt).toLocaleString();
    row.innerHTML = `<div class="date">${date}</div><div class="empty-state">${r.amount.toLocaleString()} coins</div><div>${statusHtml}</div>`;
    list.appendChild(row);
  });
}

/* results tab */
async function loadDraws() {
  const data = await api("/api/draws");
  const list = document.getElementById("drawList");
  list.innerHTML = "";
  if (data.draws.length === 0) {
    list.innerHTML = '<p class="empty-state">No draws have completed yet.</p>';
    return;
  }
  data.draws.forEach((d) => {
    const row = document.createElement("div");
    row.className = "row";
    const nums = d.winningNumbers.map((n) => `<span class="mini-ball-gold">${n}</span>`).join("");
    const meta = `${d.ticketCount} ticket${d.ticketCount === 1 ? "" : "s"} · ${
      d.jackpotWon ? `Jackpot won (${d.jackpotAmount.toLocaleString()} coins)` : "No jackpot winner"
    }`;
    row.innerHTML = `<div class="date">${d.date}</div><div class="nums">${nums}</div><div class="empty-state">${meta}</div>`;
    list.appendChild(row);
  });
}

/* admin tab */
async function loadAdmin() {
  const [topups, pending, all] = await Promise.all([
    api("/api/admin/topup-requests"),
    api("/api/admin/pending"),
    api("/api/admin/users"),
  ]);

  const topupList = document.getElementById("topupRequestList");
  topupList.innerHTML = "";
  if (topups.requests.length === 0) {
    topupList.innerHTML = '<p class="empty-state">No pending top-up requests.</p>';
  } else {
    topups.requests.forEach((r) => {
      const row = document.createElement("div");
      row.className = "row";
      const date = new Date(r.createdAt).toLocaleString();
      row.innerHTML = `<div class="date">@${r.username}</div><div class="empty-state">${r.amount.toLocaleString()} coins · ${date}</div>`;
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.gap = "8px";
      const approveBtn = document.createElement("button");
      approveBtn.className = "secondary-btn";
      approveBtn.textContent = "Approve";
      approveBtn.onclick = async () => {
        await api(`/api/admin/topup/${r.id}/approve`, { method: "POST" });
        showToast("Approved +" + r.amount + " coins for @" + r.username, "success");
        loadAdmin();
      };
      const rejectBtn = document.createElement("button");
      rejectBtn.className = "secondary-btn";
      rejectBtn.textContent = "Reject";
      rejectBtn.onclick = async () => {
        await api(`/api/admin/topup/${r.id}/reject`, { method: "POST" });
        showToast("Rejected request from @" + r.username, "success");
        loadAdmin();
      };
      wrap.appendChild(approveBtn);
      wrap.appendChild(rejectBtn);
      row.appendChild(wrap);
      topupList.appendChild(row);
    });
  }

  const pendingList = document.getElementById("pendingList");
  pendingList.innerHTML = "";
  if (pending.users.length === 0) {
    pendingList.innerHTML = '<p class="empty-state">No accounts waiting on approval.</p>';
  } else {
    pending.users.forEach((u) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<div class="date">@${u.username}</div><div class="empty-state">${u.balance.toLocaleString()} coins</div>`;
      const btn = document.createElement("button");
      btn.className = "secondary-btn";
      btn.textContent = "Approve";
      btn.onclick = async () => {
        await api("/api/admin/approve/" + u.username, { method: "POST" });
        showToast("@" + u.username + " approved.", "success");
        loadAdmin();
      };
      row.appendChild(btn);
      pendingList.appendChild(row);
    });
  }

  const userList = document.getElementById("userList");
  userList.innerHTML = "";
  all.users.forEach((u) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<div class="date">@${u.username} <span class="empty-state">· ${u.role}</span></div><div class="empty-state">${u.balance.toLocaleString()} coins</div>`;
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.gap = "8px";
    const input = document.createElement("input");
    input.className = "admin-input";
    input.placeholder = "amount";
    const addBtn = document.createElement("button");
    addBtn.className = "secondary-btn";
    addBtn.textContent = "Add";
    addBtn.onclick = async () => {
      const amount = parseInt(input.value, 10);
      if (!amount || amount <= 0) return showToast("Enter a valid amount first.", "error");
      await api("/api/admin/balance/" + u.username, { method: "POST", body: JSON.stringify({ amount }) });
      showToast(amount + " coins added to @" + u.username + ".", "success");
      input.value = "";
      loadAdmin();
      if (u.username === state.user.username) refreshMe();
    };
    const deductBtn = document.createElement("button");
    deductBtn.className = "secondary-btn";
    deductBtn.textContent = "Deduct";
    deductBtn.onclick = async () => {
      const amount = parseInt(input.value, 10);
      if (!amount || amount <= 0) return showToast("Enter a valid amount first.", "error");
      await api("/api/admin/balance/" + u.username + "/deduct", { method: "POST", body: JSON.stringify({ amount }) });
      showToast(amount + " coins deducted from @" + u.username + ".", "success");
      input.value = "";
      loadAdmin();
      if (u.username === state.user.username) refreshMe();
    };
    wrap.appendChild(input);
    wrap.appendChild(addBtn);
    wrap.appendChild(deductBtn);
    row.appendChild(wrap);
    userList.appendChild(row);
  });
}

/* ---------------------------- boot ---------------------------- */
(async function boot() {
  if (state.token) {
    try {
      await enterApp();
      return;
    } catch {
      localStorage.removeItem("gd_token");
      state.token = null;
    }
  }
  document.getElementById("authScreen").classList.remove("hidden");
  try {
    const j = await api("/api/jackpot");
    document.getElementById("jackpotAmountAuth").textContent = j.amount.toLocaleString() + " coins";
  } catch {}
})();
