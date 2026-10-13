"use strict";

// ---------------------------------------------------------------- state

const TZ = "Asia/Ho_Chi_Minh";
const PAGE_SIZE = 50;
const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* private mode */ } },
};
const local = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let creds = null; // { user, key } — only kept for this browser tab
let data = null;
let tab = "overview";
const tableState = {}; // per tab: { q, filter, page }

const $ = (sel) => document.querySelector(sel);
const apiUrl = () => window.QL_API_URL || local.get("ql_api") || "";

// ---------------------------------------------------------------- helpers

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const vnd = (n) => (Number(n) || 0).toLocaleString("vi-VN") + "đ";
function shortVnd(n) {
  n = Number(n) || 0;
  if (Math.abs(n) >= 1e9) return (n / 1e9).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) + " tỷ";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 }) + " tr";
  return vnd(n);
}
function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? esc(iso) : d.toLocaleString("vi-VN", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtDate(s) {
  if (!s) return "";
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : fmtDateTime(s);
}
/** "YYYY-MM" in Vietnam time, for an ISO datetime or a YYYY-MM-DD date. */
function monthOf(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);
  const d = new Date(s);
  if (isNaN(d)) return null;
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).formatToParts(d);
  return `${p.find((x) => x.type === "year").value}-${p.find((x) => x.type === "month").value}`;
}
function dayOf(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? null : d.toLocaleDateString("en-CA", { timeZone: TZ });
}
function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
function pct(cur, prev) {
  if (!prev) return "";
  const p = Math.round(((cur - prev) / prev) * 100);
  return `<span class="${p >= 0 ? "up" : "down"}">${p >= 0 ? "▲" : "▼"} ${Math.abs(p)}%</span> so với tháng trước`;
}

const STATUS = {
  paid: ["Đã thanh toán", "ok"],
  pending: ["Chờ thanh toán", "warn"],
  expired: ["Hết hạn QR", ""],
  void: ["Đã huỷ", "bad"],
  active: ["Đang học", "ok"],
  paused: ["Tạm dừng", "warn"],
  completed: ["Hoàn thành", ""],
  canceled: ["Đã huỷ", "bad"],
  new: ["Mới", "warn"],
  contacted: ["Đã liên hệ", ""],
  enrolled: ["Đã đăng ký", "ok"],
  lost: ["Không theo", "bad"],
};
function badge(s) {
  const [label, cls] = STATUS[s] || [s || "", ""];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}
const METHOD = { transfer: "Chuyển khoản", cash: "Tiền mặt", other: "Khác" };

// ---------------------------------------------------------------- API

async function call(action) {
  const url = apiUrl();
  if (!url) throw new Error("Chưa có địa chỉ Apps Script.");
  const res = await fetch(url, {
    method: "POST",
    // text/plain keeps this a "simple" request — Apps Script can't answer a CORS preflight.
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, user: creds.user, key: creds.key }),
  });
  if (!res.ok) throw new Error("Máy chủ lỗi " + res.status);
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || "Lỗi không rõ");
  return body.data;
}

// ---------------------------------------------------------------- login

function showLogin(msg) {
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#api-field").hidden = Boolean(apiUrl());
  $("#login-error").textContent = msg || "";
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("button");
  if (!apiUrl()) {
    const api = f.api.value.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(api)) {
      $("#login-error").textContent = "Địa chỉ Apps Script phải có dạng https://script.google.com/macros/s/…/exec";
      return;
    }
    local.set("ql_api", api);
  }
  creds = { user: f.user.value.trim(), key: f.key.value };
  btn.disabled = true;
  $("#login-error").textContent = "";
  try {
    data = await call("data");
    store.set("ql_creds", JSON.stringify(creds));
    f.key.value = "";
    showApp();
  } catch (err) {
    creds = null;
    $("#login-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$("#btn-logout").addEventListener("click", () => {
  creds = null;
  data = null;
  store.del("ql_creds");
  showLogin();
});

$("#btn-sync").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "Đang đồng bộ…";
  try {
    data = await call("sync");
    render();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Đồng bộ ngay";
  }
});

$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  tab = b.dataset.tab;
  document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
  render();
});

function showApp() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  render();
}

// ---------------------------------------------------------------- views

function render() {
  const msg = data.syncMessage && data.syncMessage !== "OK" ? ` · ${data.syncMessage}` : "";
  $("#sync-info").textContent = data.syncedAt ? `Cập nhật ${fmtDateTime(data.syncedAt)}${msg}` : "Chưa đồng bộ";
  const view = $("#view");
  if (tab === "overview") view.innerHTML = overview();
  else view.innerHTML = tableView(tab);
  bindTable();
}

function overview() {
  const thisM = monthOf(new Date().toISOString());
  const lastM = shiftMonth(thisM, -1);
  const today = dayOf(new Date().toISOString());

  const dfPaid = data.dfOrders.filter((o) => o.status === "paid");
  const dfIn = (m) => dfPaid.filter((o) => monthOf(o.paid_at) === m);
  const dfThis = sum(dfIn(thisM), "amount_vnd");
  const dfLast = sum(dfIn(lastM), "amount_vnd");
  const dfToday = dfPaid.filter((o) => dayOf(o.paid_at) === today);
  const dfPending = data.dfOrders.filter((o) => o.status === "pending");
  const dfActive = data.dfMembers.filter((m) => Number(m.active_subscriptions) > 0).length;
  const dfNewMembers = data.dfMembers.filter((m) => monthOf(m.created_at) === thisM).length;

  const hm = data.hmPayments;
  const hmIn = (m) => hm.filter((p) => monthOf(p.paid_on) === m);
  const hmThis = sum(hmIn(thisM), "amount_vnd");
  const hmLast = sum(hmIn(lastM), "amount_vnd");
  const hmDebt = data.hmEnrollments
    .filter((e) => e.status !== "canceled")
    .reduce((a, e) => a + Math.max((Number(e.fee_vnd) || 0) - (Number(e.paid_vnd) || 0), 0), 0);
  const hmActive = data.hmEnrollments.filter((e) => e.status === "active").length;
  const hmNewLeads = data.hmLeads.filter((l) => l.status === "new").length;

  const kpi = (label, value, sub = "") =>
    `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;

  // Last 12 months chart
  const months = [];
  for (let i = 11; i >= 0; i--) months.push(shiftMonth(thisM, -i));
  const series = months.map((m) => ({ m, df: sum(dfIn(m), "amount_vnd"), hm: sum(hmIn(m), "amount_vnd") }));
  const max = Math.max(1, ...series.map((s) => Math.max(s.df, s.hm)));
  const chart = series
    .map(
      (s) => `<div class="col" title="${s.m}: DF ${vnd(s.df)} · Hmind ${vnd(s.hm)}">
        <div class="bars">
          <div class="bar" style="height:${(s.df / max) * 100}%;background:var(--df)"></div>
          <div class="bar" style="height:${(s.hm / max) * 100}%;background:var(--hm)"></div>
        </div>
        <div class="m">${s.m.slice(5)}/${s.m.slice(2, 4)}</div>
      </div>`
    )
    .join("");

  // DF revenue by program this month
  const byProgram = {};
  dfIn(thisM).forEach((o) => {
    const k = `${o.program} · ${o.plan}`;
    byProgram[k] = byProgram[k] || { n: 0, v: 0 };
    byProgram[k].n++;
    byProgram[k].v += Number(o.amount_vnd) || 0;
  });
  const progRows = Object.entries(byProgram).sort((a, b) => b[1].v - a[1].v);
  const progTable = progRows.length
    ? `<table><thead><tr><th>Gói</th><th class="num">Đơn</th><th class="num">Doanh thu</th></tr></thead><tbody>${progRows
        .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.n}</td><td class="num">${vnd(v.v)}</td></tr>`)
        .join("")}</tbody></table>`
    : `<div class="empty">Chưa có đơn tháng này</div>`;

  const recent = dfPaid
    .slice()
    .sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)))
    .slice(0, 8);
  const recentTable = recent.length
    ? `<table><thead><tr><th>Lúc</th><th>Khách</th><th>Gói</th><th class="num">Số tiền</th></tr></thead><tbody>${recent
        .map(
          (o) =>
            `<tr><td>${fmtDateTime(o.paid_at)}</td><td>${esc(o.name || o.bank_transfer_name || o.email)}</td><td>${esc(o.plan)}</td><td class="num">${vnd(o.amount_vnd)}</td></tr>`
        )
        .join("")}</tbody></table>`
    : `<div class="empty">Chưa có đơn</div>`;

  return `
    <div class="kpi-group">
      <h2>Tổng 2 web</h2>
      <div class="kpis">
        ${kpi("Doanh thu tháng này", vnd(dfThis + hmThis), pct(dfThis + hmThis, dfLast + hmLast))}
        ${kpi("Tháng trước", vnd(dfLast + hmLast))}
        ${kpi("Tổng doanh thu", shortVnd(sum(dfPaid, "amount_vnd") + sum(hm, "amount_vnd")))}
      </div>
    </div>
    <div class="kpi-group">
      <h2><span class="dot" style="background:var(--df)"></span>Dark Feminine</h2>
      <div class="kpis">
        ${kpi("Doanh thu tháng này", vnd(dfThis), pct(dfThis, dfLast))}
        ${kpi("Hôm nay", vnd(sum(dfToday, "amount_vnd")), `${dfToday.length} đơn`)}
        ${kpi("Đơn đã thanh toán tháng này", dfIn(thisM).length)}
        ${kpi("Đơn chờ thanh toán", dfPending.length)}
        ${kpi("Thành viên đang hoạt động", dfActive, `${data.dfMembers.length} tổng · +${dfNewMembers} tháng này`)}
      </div>
    </div>
    <div class="kpi-group">
      <h2><span class="dot" style="background:var(--hm)"></span>Hmind English</h2>
      <div class="kpis">
        ${kpi("Thu tháng này", vnd(hmThis), pct(hmThis, hmLast))}
        ${kpi("Học phí còn nợ", vnd(hmDebt))}
        ${kpi("Khoá đang học", hmActive)}
        ${kpi("Khách tư vấn mới", hmNewLeads, `${data.hmLeads.length} tổng`)}
      </div>
    </div>
    <div class="panel">
      <h3>Doanh thu 12 tháng</h3>
      <div class="chart">${chart}</div>
      <div class="legend"><span><i class="dot" style="background:var(--df)"></i>Dark Feminine</span><span><i class="dot" style="background:var(--hm)"></i>Hmind</span></div>
    </div>
    <div class="grid-2">
      <div class="panel"><h3>Dark Feminine · doanh thu theo gói tháng này</h3><div class="table-wrap">${progTable}</div></div>
      <div class="panel"><h3>Dark Feminine · đơn mới nhất</h3><div class="table-wrap">${recentTable}</div></div>
    </div>`;
}

// ---------------------------------------------------------------- tables

const TABLES = {
  dfOrders: {
    sortKey: "created_at",
    filters: [["", "Tất cả trạng thái"], ["paid", "Đã thanh toán"], ["pending", "Chờ thanh toán"], ["expired", "Hết hạn QR"], ["void", "Đã huỷ"]],
    filterKey: "status",
    sumKey: "amount_vnd",
    sumOnly: (r) => r.status === "paid",
    search: ["id", "name", "email", "phone", "bank_transfer_name", "program", "plan", "member_number"],
    cols: [
      ["Tạo lúc", (r) => fmtDateTime(r.created_at)],
      ["Trạng thái", (r) => badge(r.status)],
      ["Khách", (r) => esc(r.name || r.bank_transfer_name || "")],
      ["Mã TV", (r) => esc(r.member_number ?? "")],
      ["Email", (r) => esc(r.email)],
      ["SĐT", (r) => esc(r.phone)],
      ["Chương trình", (r) => esc(r.program)],
      ["Gói", (r) => esc(r.plan)],
      ["Số tiền", (r) => vnd(r.amount_vnd), "num"],
      ["Thanh toán lúc", (r) => fmtDateTime(r.paid_at)],
    ],
  },
  dfMembers: {
    sortKey: "created_at",
    filters: [["", "Tất cả"], ["active", "Đang có gói"], ["inactive", "Không có gói"]],
    filterFn: (r, f) => (f === "active" ? Number(r.active_subscriptions) > 0 : Number(r.active_subscriptions) === 0),
    sumKey: "lifetime_paid_vnd",
    search: ["member_number", "name", "email", "phone", "bank_transfer_name"],
    cols: [
      ["Mã TV", (r) => esc(r.member_number ?? "")],
      ["Tên", (r) => esc(r.name || r.bank_transfer_name || "")],
      ["Email", (r) => esc(r.email)],
      ["SĐT", (r) => esc(r.phone)],
      ["Tham gia", (r) => fmtDateTime(r.created_at)],
      ["Gói hoạt động", (r) => esc(r.active_subscriptions ?? 0), "num"],
      ["Hết hạn", (r) => fmtDateTime(r.active_until)],
      ["Tổng đã trả", (r) => vnd(r.lifetime_paid_vnd), "num"],
    ],
  },
  hmPayments: {
    sortKey: "paid_on",
    filters: [["", "Mọi hình thức"], ["transfer", "Chuyển khoản"], ["cash", "Tiền mặt"], ["other", "Khác"]],
    filterKey: "method",
    sumKey: "amount_vnd",
    search: ["student_name", "student_phone", "student_email", "course", "package", "note"],
    cols: [
      ["Ngày thu", (r) => fmtDate(r.paid_on)],
      ["Học viên", (r) => esc(r.student_name)],
      ["SĐT", (r) => esc(r.student_phone)],
      ["Khoá học", (r) => esc(r.course)],
      ["Gói", (r) => esc(r.package)],
      ["Hình thức", (r) => esc(METHOD[r.method] || r.method)],
      ["Số tiền", (r) => vnd(r.amount_vnd), "num"],
      ["Ghi chú", (r) => esc(r.note), "wrap"],
    ],
  },
  hmEnrollments: {
    sortKey: "created_at",
    filters: [["", "Tất cả trạng thái"], ["active", "Đang học"], ["paused", "Tạm dừng"], ["completed", "Hoàn thành"], ["canceled", "Đã huỷ"]],
    filterKey: "status",
    sumKey: "fee_vnd",
    search: ["student_name", "student_phone", "course", "package", "format"],
    cols: [
      ["Tạo lúc", (r) => fmtDateTime(r.created_at)],
      ["Học viên", (r) => esc(r.student_name)],
      ["SĐT", (r) => esc(r.student_phone)],
      ["Khoá học", (r) => esc(r.course)],
      ["Gói", (r) => esc(r.package)],
      ["Hình thức", (r) => esc(r.format)],
      ["Trạng thái", (r) => badge(r.status)],
      ["Học phí", (r) => vnd(r.fee_vnd), "num"],
      ["Đã đóng", (r) => vnd(r.paid_vnd), "num"],
      ["Còn nợ", (r) => vnd(Math.max((Number(r.fee_vnd) || 0) - (Number(r.paid_vnd) || 0), 0)), "num"],
      ["Bắt đầu", (r) => fmtDate(r.start_date)],
      ["Kết thúc", (r) => fmtDate(r.end_date)],
    ],
  },
  hmLeads: {
    sortKey: "created_at",
    filters: [["", "Tất cả trạng thái"], ["new", "Mới"], ["contacted", "Đã liên hệ"], ["enrolled", "Đã đăng ký"], ["lost", "Không theo"]],
    filterKey: "status",
    search: ["name", "phone", "email", "course_interest", "message"],
    cols: [
      ["Gửi lúc", (r) => fmtDateTime(r.created_at)],
      ["Trạng thái", (r) => badge(r.status)],
      ["Tên", (r) => esc(r.name)],
      ["SĐT", (r) => esc(r.phone)],
      ["Email", (r) => esc(r.email)],
      ["Quan tâm", (r) => esc(r.course_interest)],
      ["Lời nhắn", (r) => esc(r.message), "wrap"],
      ["Nguồn", (r) => esc(r.source === "manual" ? "Nhập tay" : "Website")],
    ],
  },
};

function rowsFor(name) {
  const def = TABLES[name];
  const st = (tableState[name] = tableState[name] || { q: "", filter: "", page: 1 });
  const q = st.q.trim().toLowerCase();
  let rows = data[name] || [];
  if (st.filter) rows = rows.filter((r) => (def.filterFn ? def.filterFn(r, st.filter) : r[def.filterKey] === st.filter));
  if (q) rows = rows.filter((r) => def.search.some((k) => String(r[k] ?? "").toLowerCase().includes(q)));
  rows = rows.slice().sort((a, b) => String(b[def.sortKey] ?? "").localeCompare(String(a[def.sortKey] ?? "")));
  return { def, st, rows };
}

function tableView(name) {
  const { def, st, rows } = rowsFor(name);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  st.page = Math.min(st.page, pages);
  const pageRows = rows.slice((st.page - 1) * PAGE_SIZE, st.page * PAGE_SIZE);
  const total = def.sumKey ? sum(def.sumOnly ? rows.filter(def.sumOnly) : rows, def.sumKey) : null;

  const body = pageRows.length
    ? pageRows.map((r) => `<tr>${def.cols.map((c) => `<td class="${c[2] || ""}">${c[1](r)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${def.cols.length}" class="empty">Không có dữ liệu</td></tr>`;

  return `
    <div class="toolbar">
      <input type="search" id="t-q" placeholder="Tìm tên, email, SĐT…" value="${esc(st.q)}" aria-label="Tìm kiếm">
      <select id="t-filter" aria-label="Lọc">${def.filters
        .map(([v, l]) => `<option value="${v}" ${v === st.filter ? "selected" : ""}>${l}</option>`)
        .join("")}</select>
      <button class="ghost" id="t-csv">Tải CSV</button>
      <span class="sum">${rows.length} dòng${total !== null ? ` · <b>${vnd(total)}</b>${def.sumOnly ? " (đã thanh toán)" : ""}` : ""}</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>${def.cols.map((c) => `<th class="${c[2] || ""}">${c[0]}</th>`).join("")}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <div class="pager">
      <button class="ghost" id="t-prev" ${st.page <= 1 ? "disabled" : ""}>‹ Trước</button>
      <span>Trang ${st.page}/${pages}</span>
      <button class="ghost" id="t-next" ${st.page >= pages ? "disabled" : ""}>Sau ›</button>
    </div>`;
}

function bindTable() {
  if (tab === "overview") return;
  const st = tableState[tab];
  const rerender = () => {
    $("#view").innerHTML = tableView(tab);
    bindTable();
  };
  const q = $("#t-q");
  q.addEventListener("input", () => {
    st.q = q.value;
    st.page = 1;
    const pos = q.selectionStart;
    rerender();
    const nq = $("#t-q");
    nq.focus();
    nq.setSelectionRange(pos, pos);
  });
  $("#t-filter").addEventListener("change", (e) => {
    st.filter = e.target.value;
    st.page = 1;
    rerender();
  });
  $("#t-prev").addEventListener("click", () => { st.page--; rerender(); });
  $("#t-next").addEventListener("click", () => { st.page++; rerender(); });
  $("#t-csv").addEventListener("click", () => downloadCsv(tab));
}

function downloadCsv(name) {
  const { def, rows } = rowsFor(name);
  const strip = (html) => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d.textContent;
  };
  const cell = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = [def.cols.map((c) => cell(c[0])).join(",")].concat(
    rows.map((r) => def.cols.map((c) => cell(strip(c[1](r)))).join(","))
  );
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${dayOf(new Date().toISOString())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- boot

(async function boot() {
  const saved = store.get("ql_creds");
  if (!saved || !apiUrl()) return showLogin();
  try {
    creds = JSON.parse(saved);
    data = await call("data");
    showApp();
  } catch (err) {
    store.del("ql_creds");
    creds = null;
    showLogin(err.message);
  }
})();
