import {
  db, collection, doc, getDocs, addDoc, updateDoc, query, where, serverTimestamp,
  watchUser, cachedUser, renderUserBox, loadRooms, loadPeriods, setupTabs, toast, esc, SITE_TITLE,
  WEEKDAY_LABEL, TYPE_LABEL, STATUS_LABEL, pad, today, parseDate, addDays, monthRange,
  occursOn, occurrences, findConflictDate, periodNames, describeSchedule, roomColor, teacherOf, usageText,
  sendMail, managerEmails, reservationMailHtml,
} from "./common.js";
import { startTour, offerTour } from "./tour.js";

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  rooms: [],
  periods: [],
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  monthRes: [],
};

document.title = SITE_TITLE;
$("siteTitle").textContent = SITE_TITLE;

// ===================== 借用狀況（月曆） =====================

async function loadMonth() {
  const { start, end } = monthRange(state.year, state.month);
  $("monthLabel").textContent = `${state.year} 年 ${state.month + 1} 月`;
  try {
    const snap = await getDocs(query(
      collection(db, "reservations"),
      where("status", "==", "approved"),
      where("endDate", ">=", start),
    ));
    state.monthRes = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => r.startDate <= end);
  } catch (e) {
    console.error(e);
    toast("讀取借用資料失敗：" + e.message, true);
    state.monthRes = [];
  }
  renderCalendar();
}

function reservationsOn(ds, roomId = $("roomFilter").value) {
  return state.monthRes.filter((r) => (!roomId || r.roomId === roomId) && occursOn(r, ds));
}

function renderCalendar() {
  const roomId = $("roomFilter").value;
  const first = new Date(state.year, state.month, 1);
  const lead = (first.getDay() + 6) % 7; // 週一為第一欄
  const { end } = monthRange(state.year, state.month);
  const days = parseDate(end).getDate();
  const t = today();

  let html = ["一", "二", "三", "四", "五", "六", "日"]
    .map((w, i) => `<div class="cal-head${i >= 5 ? " weekend" : ""}">${w}</div>`).join("");
  for (let i = 0; i < lead; i++) html += `<div class="cal-cell empty"></div>`;

  for (let d = 1; d <= days; d++) {
    const ds = `${state.year}-${pad(state.month + 1)}-${pad(d)}`;
    const dow = parseDate(ds).getDay();
    const list = reservationsOn(ds, roomId);
    // 每間有借用的教室一列：教室簡稱＋每個節次一個圓點（實心＝已借）
    const byRoom = new Map();
    for (const r of list) {
      if (!byRoom.has(r.roomId)) byRoom.set(r.roomId, new Map());
      r.periodIds.forEach((p) => byRoom.get(r.roomId).set(p, r));
    }
    let chips = [...byRoom.entries()]
      .sort((a, b) => roomIndex(a[0]) - roomIndex(b[0]))
      .map(([rid, booked]) => {
        const room = state.rooms.find((x) => x.id === rid);
        const name = room?.name || [...booked.values()][0].roomName;
        const dots = state.periods.map((p) => {
          const r = booked.get(p.id);
          return `<b class="${r ? "on" : ""}" title="${esc(`${name} ${p.name}${r ? ` ${teacherOf(r)}` : " 空堂"}`)}"></b>`;
        }).join("");
        return `<span class="drow" style="--c:${roomColor(state.rooms, rid)};--n:${state.periods.length}">
          <span class="rn">${esc(shortRoomName(name))}</span><span class="dots">${dots}</span></span>`;
      }).join("");
    if (roomId && list.length) {
      chips += `<span class="who">${esc([...new Set(list.map(teacherOf))].join("、"))}</span>`;
    }
    html += `<button class="cal-cell${dow === 0 || dow === 6 ? " weekend" : ""}${ds === t ? " today" : ""}" data-date="${ds}">
      <span class="day-num">${d}</span>${chips}</button>`;
  }
  $("calendar").innerHTML = html;
  $("calendar").querySelectorAll(".cal-cell[data-date]").forEach((c) => (c.onclick = () => openDay(c.dataset.date)));
}

// 月曆上用的教室簡稱：去掉「教室」，最多 2 個字
function shortRoomName(name) {
  const n = name.replace(/教室$/, "") || name;
  return [...n].slice(0, 2).join("");
}

function renderLegend() {
  $("roomLegend").innerHTML = state.rooms
    .map((r) => `<span><i style="background:${roomColor(state.rooms, r.id)}"></i>${esc(r.name)}</span>`).join("") +
    `<span class="muted">每列圓點由左至右：${esc(state.periods.map((p) => p.name).join("、"))}；實心＝已借用</span>`;
}

function roomIndex(id) {
  const i = state.rooms.findIndex((r) => r.id === id);
  return i < 0 ? 999 : i;
}

function openDay(ds) {
  const roomId = $("roomFilter").value;
  const rooms = roomId ? state.rooms.filter((r) => r.id === roomId) : state.rooms;
  const list = reservationsOn(ds, roomId);
  $("dayTitle").textContent = `${ds}（${WEEKDAY_LABEL[parseDate(ds).getDay()]}）借用情形`;

  // 直列為節次、橫欄為教室
  let html = `<table class="grid"><thead><tr><th>節次</th>${rooms
    .map((room) => `<th>${esc(room.name)}</th>`).join("")}</tr></thead><tbody>`;
  for (const p of state.periods) {
    html += `<tr><th>${esc(p.name)}<small>${esc(p.start)}-${esc(p.end)}</small></th>`;
    for (const room of rooms) {
      const r = list.find((x) => x.roomId === room.id && x.periodIds.includes(p.id));
      html += r
        ? `<td class="busy" style="--c:${roomColor(state.rooms, room.id)}" title="${esc(usageText(r))}">${esc(teacherOf(r))}<small>${esc(usageText(r))}</small></td>`
        : `<td class="free">—</td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  if (!rooms.length) html = `<p class="hint">尚未設定教室。</p>`;
  $("dayBody").innerHTML = html;
  $("dayDialog").showModal();
}

$("dayClose").onclick = () => $("dayDialog").close();
$("dayDialog").addEventListener("click", (e) => { if (e.target === $("dayDialog")) $("dayDialog").close(); });

function shiftMonth(n) {
  const d = new Date(state.year, state.month + n, 1);
  state.year = d.getFullYear();
  state.month = d.getMonth();
  loadMonth();
}
$("prevMonth").onclick = () => shiftMonth(-1);
$("nextMonth").onclick = () => shiftMonth(1);
$("thisMonth").onclick = () => {
  state.year = new Date().getFullYear();
  state.month = new Date().getMonth();
  loadMonth();
};
$("roomFilter").onchange = renderCalendar;

// ===================== 申請借用 =====================

function buildApplyForm() {
  $("fRoom").innerHTML = state.rooms.length
    ? state.rooms.map((r) => `<option value="${r.id}">${esc(r.name)}${r.note ? `（${esc(r.note)}）` : ""}</option>`).join("")
    : `<option value="">（尚未設定教室）</option>`;
  $("fWeekdays").innerHTML = [1, 2, 3, 4, 5, 6, 0]
    .map((d) => `<label class="check"><input type="checkbox" name="weekday" value="${d}"> 週${WEEKDAY_LABEL[d]}</label>`).join("");
  $("fMonthDays").innerHTML = Array.from({ length: 31 }, (_, i) => i + 1)
    .map((d) => `<label class="check"><input type="checkbox" name="monthDay" value="${d}"> ${d}</label>`).join("");
  $("fPeriods").innerHTML = state.periods
    .map((p) => `<label class="check"><input type="checkbox" name="period" value="${p.id}"> ${esc(p.name)}<small>${esc(p.start)}-${esc(p.end)}</small></label>`).join("");
  $("fDate").min = today();
  $("fStart").value ||= today();
}

function currentType() {
  return document.querySelector('input[name="type"]:checked').value;
}

function updateTypeFields() {
  const type = currentType();
  document.querySelectorAll("#applyForm [data-for]").forEach((el) => {
    el.hidden = !el.dataset.for.split(" ").includes(type);
  });
  updatePreview();
}
document.querySelectorAll('input[name="type"]').forEach((el) => (el.onchange = updateTypeFields));

// 節次快速選擇：上午＝12:00 前開始的節次，下午＝13:00 後開始的節次（午休只算在整天）
const QUICK_PERIODS = {
  all: () => true,
  am: (p) => p.start < "12:00",
  pm: (p) => p.start >= "13:00",
  none: () => false,
};
document.querySelectorAll("[data-quick]").forEach((btn) => {
  btn.onclick = () => {
    const pick = QUICK_PERIODS[btn.dataset.quick];
    const ids = new Set(state.periods.filter(pick).map((p) => p.id));
    document.querySelectorAll('input[name="period"]').forEach((el) => (el.checked = ids.has(el.value)));
    updatePreview();
  };
});

const checkedValues = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);

// 讀取表單並檢查，回傳借用資料或丟出錯誤訊息
function readForm() {
  const type = currentType();
  const room = state.rooms.find((r) => r.id === $("fRoom").value);
  if (!room) throw new Error("請選擇教室");
  const periodIds = checkedValues("period");
  if (!periodIds.length) throw new Error("請至少選擇一個節次");
  const teacherName = $("fTeacher").value.trim();
  const className = $("fClass").value.trim();
  const course = $("fCourse").value.trim();
  const purpose = $("fPurpose").value.trim();

  const r = {
    roomId: room.id,
    roomName: room.name,
    type,
    periodIds,
    teacherName,
    className,
    course,
    purpose,
    note: $("fNote").value.trim(),
  };

  if (type === "once") {
    const date = $("fDate").value;
    if (!date) throw new Error("請選擇日期");
    if (date < today()) throw new Error("不能借用過去的日期");
    Object.assign(r, { date, startDate: date, endDate: date });
  } else {
    const startDate = $("fStart").value;
    const endDate = $("fEnd").value;
    if (!startDate || !endDate) throw new Error("請設定開始與結束日期");
    if (endDate < startDate) throw new Error("結束日期不能早於開始日期");
    if (endDate > addDays(startDate, 366)) throw new Error("固定借用期間最長一年");
    Object.assign(r, { startDate, endDate });
    if (type === "weekly") {
      r.weekdays = checkedValues("weekday").map(Number);
      if (!r.weekdays.length) throw new Error("請至少選擇一個星期");
    } else {
      r.monthDays = checkedValues("monthDay").map(Number);
      if (!r.monthDays.length) throw new Error("請至少選擇一個日期");
    }
    if (!occurrences(r).length) throw new Error("此設定在期間內沒有任何借用日期");
  }
  return r;
}

function updatePreview() {
  let text = "";
  try {
    const r = readForm();
    const dates = occurrences(r);
    text = `共 ${dates.length} 天：${dates.slice(0, 8).join("、")}${dates.length > 8 ? " …" : ""}`;
  } catch {
    text = "";
  }
  $("applyPreview").textContent = text;
}
$("applyForm").addEventListener("change", updatePreview);
$("applyForm").addEventListener("input", updatePreview);

$("applyForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!state.user) return toast("請先登入", true);
  let r;
  try {
    r = readForm();
  } catch (err) {
    return toast(err.message, true);
  }

  const btn = $("applySubmit");
  btn.disabled = true;
  try {
    // 衝突檢查
    const snap = await getDocs(query(collection(db, "reservations"), where("roomId", "==", r.roomId)));
    const existing = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    for (const x of existing.filter((x) => x.status === "approved")) {
      const ds = findConflictDate(r, x);
      if (ds) throw new Error(`${ds} ${periodNames(x.periodIds, state.periods).join("、")} 已被 ${teacherOf(x)} 借用`);
    }
    const pendingConflicts = existing.filter((x) => x.status === "pending" && findConflictDate(r, x));
    if (pendingConflicts.length &&
        !confirm(`已有 ${pendingConflicts.length} 筆待審核的申請與此時段重疊（${pendingConflicts.map((x) => teacherOf(x)).join("、")}），仍要送出嗎？`)) {
      return;
    }

    const auto = state.user.isManager && $("fAutoApprove").checked;
    Object.assign(r, {
      applicantEmail: state.user.email,
      applicantName: state.user.name,
      status: auto ? "approved" : "pending",
      createdAt: serverTimestamp(),
      ...(auto ? { reviewedBy: state.user.email, reviewedByName: state.user.name, reviewedAt: serverTimestamp() } : {}),
    });
    await addDoc(collection(db, "reservations"), r);

    if (!auto) {
      // 申請已存好；通知信寄送失敗不影響申請結果
      const adminUrl = new URL("admin.html", location.href).href;
      managerEmails()
        .then((to) => sendMail(
          to,
          `[教室借用申請] ${r.applicantName} 申請借用 ${r.roomName}`,
          `<p>有一筆新的教室借用申請等待審核：</p>${reservationMailHtml(r, state.periods)}
           <p><a href="${adminUrl}">前往管理後台審核</a></p>`,
        ))
        .catch((e) => console.warn("通知主管失敗", e));
    }
    toast(auto ? "已新增並核准" : "申請已送出，等待主管審核");
    ["fClass", "fCourse", "fPurpose"].forEach((id) => ($(id).value = ""));
    $("fNote").value = "";
    loadMonth();
    loadMine();
  } catch (err) {
    console.error(err);
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
};

// ===================== 我的申請 =====================

async function loadMine() {
  if (!state.user) {
    $("mineList").innerHTML = "";
    return;
  }
  const snap = await getDocs(query(collection(db, "reservations"), where("applicantEmail", "==", state.user.email)));
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
  if (!list.length) {
    $("mineList").innerHTML = `<div class="card hint">尚無申請紀錄。</div>`;
    return;
  }
  $("mineList").innerHTML = list.map((r) => `
    <div class="card item">
      <div class="item-main">
        <div class="item-title">${esc(r.roomName)} <span class="badge ${r.status}">${STATUS_LABEL[r.status]}</span></div>
        <div>${TYPE_LABEL[r.type]}｜${esc(describeSchedule(r))}</div>
        <div>節次：${esc(periodNames(r.periodIds, state.periods).join("、"))}</div>
        <div class="muted">${esc([teacherOf(r), usageText(r)].filter(Boolean).join("｜"))}${r.reviewNote ? `｜審核意見：${esc(r.reviewNote)}` : ""}</div>
      </div>
      ${["pending", "approved"].includes(r.status) && r.endDate >= today()
        ? `<button class="btn danger ghost" data-cancel="${r.id}">取消申請</button>` : ""}
    </div>`).join("");
  $("mineList").querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = async () => {
    if (!confirm("確定要取消這筆借用嗎？")) return;
    try {
      await updateDoc(doc(db, "reservations", b.dataset.cancel), {
        status: "cancelled", cancelledAt: serverTimestamp(), cancelledBy: state.user.email,
      });
      toast("已取消");
      loadMine();
      loadMonth();
    } catch (err) {
      toast(err.message, true);
    }
  }));
}

// ===================== 操作導覽 =====================

const showTab = (name) => document.querySelector(`#tabs button[data-tab="${name}"]`)?.click();

// 給第一次使用的老師：5 步、每步一兩句話
const TOUR_STEPS = [
  {
    target: "#userBox",
    title: "1. 登入",
    before: () => showTab("calendar"),
    text: () => (state.user
      ? "您已登入。請記得用 <b>Chrome 或 Safari</b> 開啟本網站。"
      : "先用學校 Google 帳號登入。<br>請用 <b>Chrome 或 Safari</b> 開啟，LINE 裡面無法登入。"),
  },
  {
    target: "#roomLegend",
    title: "2. 看懂圓點",
    text: "顏色＝教室，一排圓點＝晨光到第7節。<br><b>實心</b>＝已被借走。",
  },
  {
    target: "#calendar",
    title: "3. 點日期看詳細",
    text: "點任一天，就能看到誰借了哪間、哪一節。",
  },
  {
    target: '#tabs button[data-tab="apply"]',
    title: "4. 申請借用",
    text: "選教室、日期、節次，按送出即可。",
  },
  {
    target: '#tabs button[data-tab="mine"]',
    title: "5. 查看結果",
    text: "主管同意後才算借到，結果在這裡看。<br>忘記怎麼用，按上方「操作說明」。",
  },
];

$("helpBtn").onclick = () => startTour(TOUR_STEPS, { onEnd: () => showTab("calendar") });

// ===================== 初始化 =====================

setupTabs($("tabs"));

// 教室、節次設定讀完後才顯示「我的申請」，避免節次顯示成代號
let settingsLoaded;
const settingsReady = new Promise((resolve) => (settingsLoaded = resolve));

// 先依上次記住的身分顯示（避免「管理後台」按鈕閃一下），再監聽登入狀態校正
const cached = cachedUser();
renderUserBox($("userBox"), cached);
$("adminLink").hidden = !cached?.isManager;
watchUser((user) => {
  state.user = user;
  renderUserBox($("userBox"), user);
  $("adminLink").hidden = !user?.isManager;
  $("applyForm").hidden = !user;
  if (user && !$("fTeacher").value) $("fTeacher").value = user.name;
  document.querySelectorAll(".need-login").forEach((el) => (el.hidden = !!user));
  document.querySelectorAll(".manager-only").forEach((el) => (el.hidden = !user?.isManager));
  settingsReady.then(loadMine).catch((e) => console.error(e));
});

async function init() {
  [state.rooms, state.periods] = await Promise.all([loadRooms(), loadPeriods()]);
  settingsLoaded();
  $("roomFilter").innerHTML = `<option value="">全部教室</option>` +
    state.rooms.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
  renderLegend();
  buildApplyForm();
  updateTypeFields();
  await loadMonth();
  // 從管理後台按「操作說明」過來時（網址 #tour）直接開始導覽
  if (location.hash === "#tour") startTour(TOUR_STEPS, { onEnd: () => showTab("calendar") });
  else offerTour(TOUR_STEPS, { onEnd: () => showTab("calendar") });
}

init().catch((e) => {
  console.error(e);
  toast("初始化失敗，請確認 js/config.js 的 Firebase 設定：" + e.message, true);
});
