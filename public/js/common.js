import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  firebaseConfig, ALLOWED_DOMAINS, BOOTSTRAP_ADMINS, SITE_TITLE, MAIL_ENABLED, DEFAULT_PERIODS,
} from "./config.js";

export * from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
export { SITE_TITLE };

// 註冊 sw.js：每次載入都向伺服器確認檔案是否有更新，不必再手動強制重新整理。
// 第一次安裝時，頁面可能是用舊的暫存檔案開的，所以自動重新整理一次換成最新版。
if ("serviceWorker" in navigator) {
  const firstInstall = !navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (firstInstall && !reloaded) {
      reloaded = true;
      location.reload();
    }
  });
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("sw 註冊失敗", e));
}

// config.js 尚未填入 Firebase 設定時，在頁面最上方顯示提醒
export const CONFIG_MISSING = !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("YOUR_");
if (CONFIG_MISSING) {
  const bar = document.createElement("div");
  bar.className = "config-warning";
  bar.innerHTML = "⚠ 尚未設定 Firebase：請編輯 <code>public/js/config.js</code>，把 <code>firebaseConfig</code> 換成 Firebase 主控台提供的設定（詳見 README「修改設定」）。";
  document.body.prepend(bar);
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ---------- 登入 / 身分 ----------

export const ROLE_LABEL = { admin: "管理員", supervisor: "主管", teacher: "教師" };

export const DOMAIN_TEXT = ALLOWED_DOMAINS.map((d) => "@" + d).join(" 或 ");

export function isAllowedEmail(email) {
  return !!email && ALLOWED_DOMAINS.some((d) => email.toLowerCase().endsWith("@" + d));
}

// 頁面上標記 class="domain-text" 的地方顯示允許的網域
document.querySelectorAll(".domain-text").forEach((el) => (el.textContent = DOMAIN_TEXT));

// ---------- App 內建瀏覽器 ----------
// LINE、Facebook、Instagram 等 App 內建的瀏覽器會擋住 Google 登入，需改用 Chrome / Safari
const UA = navigator.userAgent;
const IN_LINE = /\bLine\//i.test(UA);
export const IN_APP_BROWSER = IN_LINE || /FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|; wv\)/i.test(UA);
const IN_APP_MSG = "LINE、Facebook 等 App 內建的瀏覽器無法使用 Google 登入，請改用 Chrome 或 Safari 開啟本網站";

// 在 LINE 開啟時，網址加上 openExternalBrowser=1 會自動改用手機預設瀏覽器開啟
if (IN_LINE && !new URLSearchParams(location.search).has("openExternalBrowser")) {
  const url = new URL(location.href);
  url.searchParams.set("openExternalBrowser", "1");
  location.replace(url.href);
}

if (IN_APP_BROWSER) {
  const bar = document.createElement("div");
  bar.className = "config-warning";
  bar.innerHTML = `⚠ ${IN_APP_MSG}。<button type="button" class="btn small ghost">複製網址</button>`;
  bar.querySelector("button").onclick = () => {
    const url = location.href.replace(/[?&]openExternalBrowser=1/, "");
    navigator.clipboard?.writeText(url).then(
      () => toast("已複製網址，請貼到 Chrome 或 Safari 開啟"),
      () => prompt("請複製以下網址，貼到 Chrome 或 Safari 開啟：", url),
    ) ?? prompt("請複製以下網址，貼到 Chrome 或 Safari 開啟：", url);
  };
  document.body.prepend(bar);
}

export async function login() {
  if (IN_APP_BROWSER) throw new Error(IN_APP_MSG);
  const provider = new GoogleAuthProvider();
  // hd 只能指定單一網域，多個網域時改由登入後檢查
  provider.setCustomParameters(ALLOWED_DOMAINS.length === 1
    ? { hd: ALLOWED_DOMAINS[0], prompt: "select_account" }
    : { prompt: "select_account" });
  const cred = await signInWithPopup(auth, provider);
  if (!isAllowedEmail(cred.user.email)) {
    await signOut(auth);
    throw new Error(`請使用 ${DOMAIN_TEXT} 帳號登入`);
  }
}

// 把 Firebase 登入錯誤轉成中文；使用者自己關掉登入視窗則不顯示
function loginErrorText(e) {
  switch (e.code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
    case "auth/user-cancelled":
      return "";
    case "auth/popup-blocked":
      return "登入視窗被瀏覽器封鎖，請允許此網站開啟彈出式視窗後再試一次";
    case "auth/unauthorized-domain":
      return "此網址尚未加入 Firebase 已授權網域，請通知管理員";
    case "auth/network-request-failed":
      return "網路連線失敗，請稍後再試";
    case "auth/web-storage-unsupported":
    case "auth/operation-not-supported-in-this-environment":
      return "此瀏覽器不支援 Google 登入，請改用 Chrome 或 Safari 開啟本網站";
    default:
      return e.code ? `登入失敗（${e.code}），請重新整理後再試；若仍失敗請改用 Chrome 或 Safari` : e.message;
  }
}

export function logout() {
  return signOut(auth);
}

async function getRole(email) {
  if (BOOTSTRAP_ADMINS.map((e) => e.toLowerCase()).includes(email)) return "admin";
  try {
    const snap = await getDoc(doc(db, "roles", email));
    return snap.exists() ? snap.data().role : "teacher";
  } catch {
    return "teacher";
  }
}

// cb(user|null)；user = { uid, email, name, role, isAdmin, isManager }
export function watchUser(cb) {
  return onAuthStateChanged(auth, async (u) => {
    if (!u) return cb(null);
    if (!isAllowedEmail(u.email)) {
      await signOut(auth);
      toast(`請使用 ${DOMAIN_TEXT} 帳號登入`, true);
      return cb(null);
    }
    const email = u.email.toLowerCase();
    const role = await getRole(email);
    cb({
      uid: u.uid,
      email,
      name: u.displayName || email.split("@")[0],
      role,
      isAdmin: role === "admin",
      isManager: role === "admin" || role === "supervisor",
    });
  });
}

export function renderUserBox(el, user) {
  if (!user) {
    el.innerHTML = `<button class="btn" id="loginBtn">以學校帳號登入</button>`;
    el.querySelector("#loginBtn").onclick = () => login().catch((e) => {
      const msg = loginErrorText(e);
      if (msg) toast(msg, true);
    });
  } else {
    el.innerHTML = `<span class="who">${esc(user.name)}<small>${ROLE_LABEL[user.role] || ""}</small></span>
      <button class="btn ghost" id="logoutBtn">登出</button>`;
    el.querySelector("#logoutBtn").onclick = () => logout();
  }
}

// ---------- 設定 ----------

export async function loadRooms(includeInactive = false) {
  const snap = await getDocs(collection(db, "rooms"));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => includeInactive || r.active !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, "zh-Hant"));
}

export async function loadPeriods() {
  const snap = await getDoc(doc(db, "settings", "periods"));
  const list = snap.exists() ? snap.data().list : null;
  return list && list.length ? list : DEFAULT_PERIODS;
}

// ---------- 日期工具（一律使用 YYYY-MM-DD 字串，當地時間） ----------

export const WEEKDAY_LABEL = ["日", "一", "二", "三", "四", "五", "六"];

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

export function today() {
  return fmtDate(new Date());
}

export function monthRange(year, month) {
  const last = new Date(year, month + 1, 0).getDate();
  return { start: `${year}-${pad(month + 1)}-01`, end: `${year}-${pad(month + 1)}-${pad(last)}` };
}

// ---------- 借用規則 ----------

export const TYPE_LABEL = { once: "單次", weekly: "每週固定", monthly: "每月固定" };
export const STATUS_LABEL = { pending: "待審核", approved: "已核准", rejected: "未核准", cancelled: "已取消" };

// 某筆借用在某日期是否有借用
export function occursOn(r, ds) {
  if (ds < r.startDate || ds > r.endDate) return false;
  if (r.type === "once") return ds === r.date;
  const d = parseDate(ds);
  if (r.type === "weekly") return (r.weekdays || []).includes(d.getDay());
  if (r.type === "monthly") return (r.monthDays || []).includes(d.getDate());
  return false;
}

// 列出某筆借用在區間內的所有日期
export function occurrences(r, from = r.startDate, to = r.endDate) {
  const out = [];
  const start = from > r.startDate ? from : r.startDate;
  const end = to < r.endDate ? to : r.endDate;
  for (let ds = start; ds <= end; ds = addDays(ds, 1)) {
    if (occursOn(r, ds)) out.push(ds);
  }
  return out;
}

// 兩筆借用是否衝突；有衝突回傳第一個衝突日期，否則回傳 null
export function findConflictDate(a, b) {
  if (a.roomId !== b.roomId) return null;
  if (!a.periodIds.some((p) => b.periodIds.includes(p))) return null;
  const start = a.startDate > b.startDate ? a.startDate : b.startDate;
  const end = a.endDate < b.endDate ? a.endDate : b.endDate;
  for (let ds = start; ds <= end; ds = addDays(ds, 1)) {
    if (occursOn(a, ds) && occursOn(b, ds)) return ds;
  }
  return null;
}

// 使用教師（未填時為申請人）
export function teacherOf(r) {
  return r.teacherName || r.applicantName;
}

// 班級｜課程｜用途 合併顯示
export function usageText(r) {
  return [r.className, r.course, r.purpose].filter(Boolean).join("｜");
}

export function periodNames(ids, periods) {
  const order = periods.map((p) => p.id);
  return [...ids]
    .sort((x, y) => order.indexOf(x) - order.indexOf(y))
    .map((id) => periods.find((p) => p.id === id)?.name || id);
}

export function describeSchedule(r) {
  if (r.type === "once") return `${r.date}（${WEEKDAY_LABEL[parseDate(r.date).getDay()]}）`;
  const range = `${r.startDate} ~ ${r.endDate}`;
  if (r.type === "weekly") {
    const days = [...r.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    return `每週${days.map((d) => WEEKDAY_LABEL[d]).join("、")}（${range}）`;
  }
  return `每月 ${[...r.monthDays].sort((a, b) => a - b).join("、")} 日（${range}）`;
}

// ---------- 郵件 ----------

export async function sendMail(to, subject, html) {
  const list = [...new Set(to.filter(Boolean))];
  if (!MAIL_ENABLED || !list.length) return;
  try {
    await addDoc(collection(db, "mail"), { to: list, message: { subject, html }, createdAt: serverTimestamp() });
  } catch (e) {
    console.warn("寄信失敗", e);
  }
}

// 主管信箱；沒有設定主管時改寄給管理員
export async function managerEmails() {
  const snap = await getDocs(query(collection(db, "roles"), where("role", "in", ["admin", "supervisor"])));
  const roles = snap.docs.map((d) => ({ email: d.id, ...d.data() }));
  const sup = roles.filter((r) => r.role === "supervisor").map((r) => r.email);
  if (sup.length) return sup;
  return [...roles.filter((r) => r.role === "admin").map((r) => r.email), ...BOOTSTRAP_ADMINS];
}

export function reservationMailHtml(r, periods, extra = "") {
  return `<table style="border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 12px 4px 0;color:#666">申請人</td><td>${esc(r.applicantName)}（${esc(r.applicantEmail)}）</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666">教室</td><td>${esc(r.roomName)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666">借用方式</td><td>${TYPE_LABEL[r.type]}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666">日期</td><td>${esc(describeSchedule(r))}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#666">節次</td><td>${esc(periodNames(r.periodIds, periods).join("、"))}</td></tr>
    ${r.teacherName ? `<tr><td style="padding:4px 12px 4px 0;color:#666">教師</td><td>${esc(r.teacherName)}</td></tr>` : ""}
    ${r.className ? `<tr><td style="padding:4px 12px 4px 0;color:#666">班級</td><td>${esc(r.className)}</td></tr>` : ""}
    ${r.course ? `<tr><td style="padding:4px 12px 4px 0;color:#666">課程</td><td>${esc(r.course)}</td></tr>` : ""}
    ${r.purpose ? `<tr><td style="padding:4px 12px 4px 0;color:#666">用途</td><td>${esc(r.purpose)}</td></tr>` : ""}
    ${r.note ? `<tr><td style="padding:4px 12px 4px 0;color:#666">備註</td><td>${esc(r.note)}</td></tr>` : ""}
  </table>${extra}`;
}

// ---------- UI 小工具 ----------

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

let toastTimer;
export function toast(msg, isError = false) {
  const el = document.getElementById("toast");
  if (!el) return alert(msg);
  el.textContent = msg;
  el.className = "show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 3500);
}

const ROOM_COLORS = ["#2563eb", "#16a34a", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#dc2626", "#4d7c0f", "#c026d3", "#0f766e"];
export function roomColor(rooms, roomId) {
  const i = rooms.findIndex((r) => r.id === roomId);
  return ROOM_COLORS[(i < 0 ? 0 : i) % ROOM_COLORS.length];
}

export function setupTabs(nav, onChange) {
  nav.querySelectorAll("button[data-tab]").forEach((btn) => {
    btn.onclick = () => {
      nav.querySelectorAll("button[data-tab]").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + btn.dataset.tab));
      history.replaceState(null, "", "#" + btn.dataset.tab);
      onChange?.(btn.dataset.tab);
    };
  });
  // 網址帶 #分頁 時（例如從管理後台連回 index.html#apply）直接切到該分頁
  const initial = nav.querySelector(`button[data-tab="${location.hash.slice(1)}"]`);
  if (initial) initial.click();
}
