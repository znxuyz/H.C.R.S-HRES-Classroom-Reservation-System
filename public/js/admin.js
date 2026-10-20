import {
  db, collection, doc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, serverTimestamp,
  watchUser, renderUserBox, loadRooms, loadPeriods, setupTabs, toast, esc, SITE_TITLE, ROLE_LABEL,
  TYPE_LABEL, STATUS_LABEL, today, monthRange, occurrences, findConflictDate, periodNames,
  describeSchedule, sendMail, reservationMailHtml, teacherOf, usageText, DOMAIN_TEXT, isAllowedEmail,
} from "./common.js";
import { BOOTSTRAP_ADMINS } from "./config.js";

const $ = (id) => document.getElementById(id);

const state = { user: null, rooms: [], periods: [], all: [] };

document.title = `管理後台｜${SITE_TITLE}`;
$("siteTitle").textContent = SITE_TITLE;

const tsText = (ts) => (ts?.toDate ? ts.toDate().toLocaleString("zh-TW", { hour12: false }) : "");

async function fetchReservations(status) {
  const base = collection(db, "reservations");
  const snap = await getDocs(status ? query(base, where("status", "==", status)) : base);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
}

// ===================== 待審核 =====================

async function loadPending() {
  const list = await fetchReservations("pending");
  $("pendingCount").textContent = list.length || "";
  if (!list.length) {
    $("pendingList").innerHTML = `<div class="card hint">目前沒有待審核的申請。</div>`;
    return;
  }
  $("pendingList").innerHTML = list.map((r) => {
    const n = occurrences(r).length;
    return `<div class="card item">
      <div class="item-main">
        <div class="item-title">${esc(r.roomName)}｜${esc(r.applicantName)} <span class="muted">${esc(r.applicantEmail)}</span></div>
        <div>${TYPE_LABEL[r.type]}｜${esc(describeSchedule(r))}${r.type !== "once" ? `（共 ${n} 天）` : ""}</div>
        <div>節次：${esc(periodNames(r.periodIds, state.periods).join("、"))}</div>
        <div>教師：${esc(teacherOf(r))}${usageText(r) ? `｜${esc(usageText(r))}` : ""}${r.note ? `｜備註：${esc(r.note)}` : ""}</div>
        <div class="muted">申請時間：${tsText(r.createdAt)}</div>
      </div>
      <div class="item-actions">
        <button class="btn" data-approve="${r.id}">同意</button>
        <button class="btn danger ghost" data-reject="${r.id}">不同意</button>
      </div>
    </div>`;
  }).join("");

  const byId = Object.fromEntries(list.map((r) => [r.id, r]));
  $("pendingList").querySelectorAll("[data-approve]").forEach((b) => (b.onclick = () => review(byId[b.dataset.approve], true)));
  $("pendingList").querySelectorAll("[data-reject]").forEach((b) => (b.onclick = () => review(byId[b.dataset.reject], false)));
}

async function review(r, approve) {
  let reviewNote = "";
  if (approve) {
    // 與已核准的借用比對衝突
    const snap = await getDocs(query(collection(db, "reservations"), where("roomId", "==", r.roomId)));
    for (const d of snap.docs) {
      const x = { id: d.id, ...d.data() };
      if (x.id === r.id || x.status !== "approved") continue;
      const ds = findConflictDate(r, x);
      if (ds) {
        return toast(`無法核准：${ds} ${periodNames(x.periodIds, state.periods).join("、")} 已被 ${teacherOf(x)} 借用`, true);
      }
    }
    if (!confirm(`同意 ${r.applicantName} 借用 ${r.roomName}？`)) return;
  } else {
    const reason = prompt("不同意的原因（會寄給申請人，可留空）：", "");
    if (reason === null) return;
    reviewNote = reason.trim();
  }

  try {
    const status = approve ? "approved" : "rejected";
    await updateDoc(doc(db, "reservations", r.id), {
      status,
      reviewNote,
      reviewedBy: state.user.email,
      reviewedByName: state.user.name,
      reviewedAt: serverTimestamp(),
    });
    sendMail(
      [r.applicantEmail],
      `[教室借用] 您的 ${r.roomName} 借用申請${approve ? "已核准" : "未獲核准"}`,
      `<p>${esc(r.applicantName)} 老師您好，您的教室借用申請<strong>${approve ? "已核准" : "未獲核准"}</strong>。</p>
       ${reservationMailHtml(r, state.periods, reviewNote ? `<p>審核意見：${esc(reviewNote)}</p>` : "")}
       <p>審核人：${esc(state.user.name)}</p>`,
    );
    toast(approve ? "已核准" : "已退回");
    loadPending();
    if (!$("tab-all").hidden) loadAll();
  } catch (e) {
    toast(e.message, true);
  }
}

// ===================== 所有借用 =====================

async function loadAll() {
  state.all = await fetchReservations($("aStatus").value);
  renderAll();
}

function filteredAll() {
  const roomId = $("aRoom").value;
  const ym = $("aMonth").value;
  let range = null;
  if (ym) {
    const [y, m] = ym.split("-").map(Number);
    range = monthRange(y, m - 1);
  }
  return state.all.filter((r) =>
    (!roomId || r.roomId === roomId) &&
    (!range || occurrences(r, range.start, range.end).length > 0));
}

function renderAll() {
  const list = filteredAll();
  const head = `<thead><tr><th>教室</th><th>申請人</th><th>使用教師</th><th>方式</th><th>日期</th><th>節次</th><th>班級｜課程｜用途</th><th>狀態</th><th>申請時間</th><th></th></tr></thead>`;
  if (!list.length) {
    $("allTable").innerHTML = head + `<tbody><tr><td colspan="10" class="hint">沒有符合的資料</td></tr></tbody>`;
    return;
  }
  $("allTable").innerHTML = head + "<tbody>" + list.map((r) => `
    <tr>
      <td>${esc(r.roomName)}</td>
      <td>${esc(r.applicantName)}</td>
      <td>${esc(teacherOf(r))}</td>
      <td>${TYPE_LABEL[r.type]}</td>
      <td>${esc(describeSchedule(r))}</td>
      <td>${esc(periodNames(r.periodIds, state.periods).join("、"))}</td>
      <td>${esc(usageText(r))}${r.reviewNote ? `<small>審核意見：${esc(r.reviewNote)}</small>` : ""}</td>
      <td><span class="badge ${r.status}">${STATUS_LABEL[r.status]}</span>${r.reviewedByName ? `<small>${esc(r.reviewedByName)}</small>` : ""}</td>
      <td class="nowrap">${tsText(r.createdAt)}</td>
      <td class="nowrap">
        ${["pending", "approved"].includes(r.status) ? `<button class="btn small ghost" data-cancel="${r.id}">取消</button>` : ""}
        ${state.user.isAdmin ? `<button class="btn small danger ghost" data-del="${r.id}">刪除</button>` : ""}
      </td>
    </tr>`).join("") + "</tbody>";

  $("allTable").querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = async () => {
    const r = state.all.find((x) => x.id === b.dataset.cancel);
    const reason = prompt(`取消 ${r.applicantName} 的 ${r.roomName} 借用，原因（會通知申請人）：`, "");
    if (reason === null) return;
    try {
      await updateDoc(doc(db, "reservations", r.id), {
        status: "cancelled", reviewNote: reason.trim(), cancelledAt: serverTimestamp(), cancelledBy: state.user.email,
      });
      sendMail([r.applicantEmail], `[教室借用] 您的 ${r.roomName} 借用已被取消`,
        `<p>${esc(r.applicantName)} 老師您好，以下借用已由 ${esc(state.user.name)} 取消。</p>
         ${reservationMailHtml(r, state.periods, reason.trim() ? `<p>原因：${esc(reason.trim())}</p>` : "")}`);
      toast("已取消");
      loadAll();
      loadPending();
    } catch (e) {
      toast(e.message, true);
    }
  }));
  $("allTable").querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("確定永久刪除這筆紀錄？（建議改用「取消」保留紀錄）")) return;
    try {
      await deleteDoc(doc(db, "reservations", b.dataset.del));
      toast("已刪除");
      loadAll();
      loadPending();
    } catch (e) {
      toast(e.message, true);
    }
  }));
}

function exportCsv() {
  const rows = [["教室", "申請人", "Email", "使用教師", "班級", "課程", "方式", "日期", "節次", "用途", "備註", "狀態", "審核人", "審核意見", "申請時間"]];
  for (const r of filteredAll()) {
    rows.push([r.roomName, r.applicantName, r.applicantEmail, teacherOf(r), r.className || "", r.course || "", TYPE_LABEL[r.type], describeSchedule(r),
      periodNames(r.periodIds, state.periods).join("、"), r.purpose || "", r.note || "", STATUS_LABEL[r.status],
      r.reviewedByName || "", r.reviewNote || "", tsText(r.createdAt)]);
  }
  const csv = rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `教室借用_${$("aMonth").value || "全部"}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

$("aStatus").onchange = loadAll;
$("aRoom").onchange = renderAll;
$("aMonth").onchange = renderAll;
$("aClearMonth").onclick = () => {
  $("aMonth").value = "";
  renderAll();
};
$("aExport").onclick = exportCsv;

// ===================== 教室設定 =====================

async function loadRoomsTab() {
  state.rooms = await loadRooms(true);
  $("aRoom").innerHTML = `<option value="">全部教室</option>` +
    state.rooms.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
  $("roomTable").innerHTML = `<thead><tr><th>順序</th><th>教室名稱</th><th>說明</th><th>開放借用</th><th></th></tr></thead><tbody>` +
    state.rooms.map((r, i) => `<tr>
      <td class="nowrap">
        <button class="btn small ghost" data-up="${i}" ${i === 0 ? "disabled" : ""}>▲</button>
        <button class="btn small ghost" data-down="${i}" ${i === state.rooms.length - 1 ? "disabled" : ""}>▼</button>
      </td>
      <td><input value="${esc(r.name)}" data-name="${r.id}" maxlength="50"></td>
      <td><input value="${esc(r.note || "")}" data-note="${r.id}" maxlength="100"></td>
      <td><input type="checkbox" data-active="${r.id}" ${r.active !== false ? "checked" : ""}></td>
      <td><button class="btn small danger ghost" data-delroom="${r.id}">刪除</button></td>
    </tr>`).join("") + "</tbody>";

  const t = $("roomTable");
  const save = (id, data) => updateDoc(doc(db, "rooms", id), data).then(() => toast("已儲存")).catch((e) => toast(e.message, true));
  t.querySelectorAll("[data-name]").forEach((el) => (el.onchange = () => el.value.trim() && save(el.dataset.name, { name: el.value.trim() }).then(loadRoomsTab)));
  t.querySelectorAll("[data-note]").forEach((el) => (el.onchange = () => save(el.dataset.note, { note: el.value.trim() })));
  t.querySelectorAll("[data-active]").forEach((el) => (el.onchange = () => save(el.dataset.active, { active: el.checked })));
  const swap = async (i, j) => {
    const arr = [...state.rooms];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    await Promise.all(arr.map((r, k) => (r.order !== k ? updateDoc(doc(db, "rooms", r.id), { order: k }) : null)))
      .catch((e) => toast(e.message, true));
    loadRoomsTab();
  };
  t.querySelectorAll("[data-up]").forEach((el) => (el.onclick = () => swap(+el.dataset.up, +el.dataset.up - 1)));
  t.querySelectorAll("[data-down]").forEach((el) => (el.onclick = () => swap(+el.dataset.down, +el.dataset.down + 1)));
  t.querySelectorAll("[data-delroom]").forEach((el) => (el.onclick = async () => {
    if (!confirm("確定刪除此教室？既有借用紀錄會保留。若只是暫停開放，請取消勾選「開放借用」。")) return;
    await deleteDoc(doc(db, "rooms", el.dataset.delroom)).catch((e) => toast(e.message, true));
    loadRoomsTab();
  }));
}

$("roomForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await addDoc(collection(db, "rooms"), {
      name: $("rName").value.trim(), note: $("rNote").value.trim(), active: true, order: state.rooms.length,
    });
    $("rName").value = "";
    $("rNote").value = "";
    toast("已新增教室");
    loadRoomsTab();
  } catch (err) {
    toast(err.message, true);
  }
};

// ===================== 節次設定 =====================

let periodDraft = [];

function renderPeriods() {
  $("periodTable").innerHTML = `<thead><tr><th>順序</th><th>名稱</th><th>開始</th><th>結束</th><th></th></tr></thead><tbody>` +
    periodDraft.map((p, i) => `<tr>
      <td class="nowrap">
        <button class="btn small ghost" data-pup="${i}" ${i === 0 ? "disabled" : ""}>▲</button>
        <button class="btn small ghost" data-pdown="${i}" ${i === periodDraft.length - 1 ? "disabled" : ""}>▼</button>
      </td>
      <td><input data-i="${i}" data-k="name" value="${esc(p.name)}" maxlength="20"></td>
      <td><input type="time" data-i="${i}" data-k="start" value="${esc(p.start)}"></td>
      <td><input type="time" data-i="${i}" data-k="end" value="${esc(p.end)}"></td>
      <td><button class="btn small danger ghost" data-pdel="${i}">刪除</button></td>
    </tr>`).join("") + "</tbody>";
  const t = $("periodTable");
  t.querySelectorAll("input[data-k]").forEach((el) => (el.oninput = () => (periodDraft[+el.dataset.i][el.dataset.k] = el.value)));
  const move = (i, j) => {
    [periodDraft[i], periodDraft[j]] = [periodDraft[j], periodDraft[i]];
    renderPeriods();
  };
  t.querySelectorAll("[data-pup]").forEach((el) => (el.onclick = () => move(+el.dataset.pup, +el.dataset.pup - 1)));
  t.querySelectorAll("[data-pdown]").forEach((el) => (el.onclick = () => move(+el.dataset.pdown, +el.dataset.pdown + 1)));
  t.querySelectorAll("[data-pdel]").forEach((el) => (el.onclick = () => {
    periodDraft.splice(+el.dataset.pdel, 1);
    renderPeriods();
  }));
}

$("addPeriod").onclick = () => {
  periodDraft.push({ id: "p" + Date.now().toString(36), name: `第${periodDraft.length}節`, start: "", end: "" });
  renderPeriods();
};

$("savePeriods").onclick = async () => {
  const list = periodDraft.map((p) => ({ id: p.id, name: p.name.trim(), start: p.start, end: p.end }));
  if (list.some((p) => !p.name || !p.start || !p.end)) return toast("每個節次都需要名稱、開始與結束時間", true);
  if (list.some((p) => p.end <= p.start)) return toast("結束時間必須晚於開始時間", true);
  try {
    await setDoc(doc(db, "settings", "periods"), { list, updatedAt: serverTimestamp(), updatedBy: state.user.email });
    state.periods = list;
    toast("節次設定已儲存");
  } catch (e) {
    toast(e.message, true);
  }
};

// ===================== 帳號權限 =====================

async function loadRoles() {
  const snap = await getDocs(collection(db, "roles"));
  const roles = snap.docs.map((d) => ({ email: d.id, ...d.data() }))
    .sort((a, b) => a.role.localeCompare(b.role) || a.email.localeCompare(b.email));
  const fixed = BOOTSTRAP_ADMINS.map((email) => `<tr><td>${esc(email)}</td><td>系統預設</td><td>${ROLE_LABEL.admin}</td><td class="muted">設定檔指定</td></tr>`).join("");
  $("roleTable").innerHTML = `<thead><tr><th>Email</th><th>姓名／職稱</th><th>身分</th><th></th></tr></thead><tbody>${fixed}` +
    roles.map((r) => `<tr>
      <td>${esc(r.email)}</td><td>${esc(r.name || "")}</td><td>${ROLE_LABEL[r.role] || esc(r.role)}</td>
      <td><button class="btn small danger ghost" data-delrole="${esc(r.email)}">移除</button></td>
    </tr>`).join("") + "</tbody>";
  $("roleTable").querySelectorAll("[data-delrole]").forEach((el) => (el.onclick = async () => {
    if (el.dataset.delrole === state.user.email && !confirm("您正在移除自己的權限，確定嗎？")) return;
    if (!confirm(`移除 ${el.dataset.delrole} 的權限（改為一般教師）？`)) return;
    await deleteDoc(doc(db, "roles", el.dataset.delrole)).catch((e) => toast(e.message, true));
    loadRoles();
  }));
}

$("roleForm").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("roleEmail").value.trim().toLowerCase();
  if (!isAllowedEmail(email)) return toast(`只能設定 ${DOMAIN_TEXT} 帳號`, true);
  try {
    await setDoc(doc(db, "roles", email), {
      role: $("roleRole").value, name: $("roleName").value.trim(), updatedAt: serverTimestamp(), updatedBy: state.user.email,
    });
    $("roleEmail").value = "";
    $("roleName").value = "";
    toast("已更新權限");
    loadRoles();
  } catch (err) {
    toast(err.message, true);
  }
};

// ===================== 初始化 =====================

setupTabs($("tabs"), (tab) => {
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== "tab-" + tab));
  if (tab === "pending") loadPending();
  if (tab === "all") loadAll();
  if (tab === "rooms") loadRoomsTab();
  if (tab === "periods") renderPeriods();
  if (tab === "roles") loadRoles();
});

renderUserBox($("userBox"), null);
watchUser(async (user) => {
  state.user = user;
  renderUserBox($("userBox"), user);
  const ok = !!user?.isManager;
  $("denied").hidden = ok;
  $("denied").textContent = user ? "您的帳號沒有管理權限。" : "請以管理員或主管帳號登入。";
  $("tabs").hidden = !ok;
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = !ok || !t.classList.contains("active")));
  document.querySelectorAll(".admin-only").forEach((el) => (el.hidden = !user?.isAdmin));
  if (!ok) return;

  try {
    [state.rooms, state.periods] = await Promise.all([loadRooms(true), loadPeriods()]);
    periodDraft = state.periods.map((p) => ({ ...p }));
    $("aRoom").innerHTML = `<option value="">全部教室</option>` +
      state.rooms.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
    $("aMonth").value = today().slice(0, 7);
    loadPending();
  } catch (e) {
    console.error(e);
    toast(e.message, true);
  }
});
