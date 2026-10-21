// 分步驟操作導覽：框住目標區塊、其餘變暗，旁邊顯示說明與「上一步／下一步」
//
// step = {
//   target: "CSS 選擇器" 或選擇器陣列（取第一個看得到的；都找不到就自動略過此步），
//           不填則說明卡置中顯示（用於開頭、結尾）
//   title, text: 說明標題與內容（可含簡單 HTML；text 也可以是回傳字串的函式）
//   before: 顯示此步前要做的事（例如切換分頁）
//   when: 開始導覽時判斷是否包含此步（例如只在已登入時說明申請表）
// }

const STORE_KEY = "hcrs-tour-done";

function store(fn) {
  try {
    return fn(localStorage);
  } catch {
    return null;
  }
}

function visible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function findTarget(target) {
  for (const sel of [].concat(target)) {
    const el = document.querySelector(sel);
    if (visible(el)) return el;
  }
  return null;
}

export function startTour(allSteps, { onEnd } = {}) {
  closeOffer();
  const steps = allSteps.filter((s) => !s.when || s.when());
  document.querySelector(".tour-root")?.remove();

  const root = document.createElement("div");
  root.className = "tour-root";
  root.innerHTML = `
    <div class="tour-shade"></div>
    <div class="tour-spot"></div>
    <div class="tour-pop" role="dialog" aria-live="polite">
      <div class="tour-step"></div>
      <h3 class="tour-title"></h3>
      <div class="tour-text"></div>
      <div class="tour-dots"></div>
      <div class="tour-actions">
        <button type="button" class="tour-skip">略過導覽</button>
        <span class="spacer"></span>
        <button type="button" class="btn ghost tour-prev">上一步</button>
        <button type="button" class="btn tour-next">下一步</button>
      </div>
    </div>`;
  document.body.append(root);

  const spot = root.querySelector(".tour-spot");
  const pop = root.querySelector(".tour-pop");
  let index = 0;
  let current = null;
  let dir = 1;

  function end() {
    root.remove();
    window.removeEventListener("resize", place);
    window.removeEventListener("scroll", place, true);
    document.removeEventListener("keydown", onKey);
    store((s) => s.setItem(STORE_KEY, "1"));
    onEnd?.();
  }

  function onKey(e) {
    if (e.key === "Escape") end();
    if (e.key === "ArrowRight") go(index + 1);
    if (e.key === "ArrowLeft") go(index - 1);
  }

  function go(i) {
    if (i < 0) return;
    if (i >= steps.length) return end();
    dir = i >= index ? 1 : -1;
    index = i;
    const step = steps[i];
    step.before?.();
    // 等分頁切換完成後再找目標
    requestAnimationFrame(() => {
      const el = step.target ? findTarget(step.target) : null;
      if (step.target && !el) return go(index + dir); // 目標不存在（例如未登入）就跳過
      current = el;
      render(step);
    });
  }

  function render(step) {
    const pos = index;
    root.querySelector(".tour-step").textContent = `第 ${pos + 1} / ${steps.length} 步`;
    root.querySelector(".tour-dots").innerHTML = steps.map((_, k) => `<i class="${k === pos ? "on" : ""}"></i>`).join("");
    root.querySelector(".tour-title").textContent = step.title;
    root.querySelector(".tour-text").innerHTML = typeof step.text === "function" ? step.text() : step.text;
    root.querySelector(".tour-prev").disabled = pos === 0;
    root.querySelector(".tour-next").textContent = index === steps.length - 1 ? "完成" : "下一步";
    if (current) current.scrollIntoView({ block: "center", inline: "nearest" });
    place();
    root.querySelector(".tour-next").focus({ preventScroll: true });
  }

  // 計算框線位置與說明卡位置（優先放在目標下方，其次上方，都放不下就貼在畫面底部）
  function place() {
    const M = 12;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    pop.style.width = Math.min(360, vw - M * 2) + "px";
    pop.classList.remove("place-below", "place-above", "place-center", "place-bottom");

    if (!current) {
      root.classList.add("no-target");
      pop.classList.add("place-center");
      pop.style.left = (vw - pop.offsetWidth) / 2 + "px";
      pop.style.top = Math.max(M, (vh - pop.offsetHeight) / 2) + "px";
      return;
    }
    root.classList.remove("no-target");

    const pad = 6;
    const r = current.getBoundingClientRect();
    const top = Math.max(r.top - pad, 4);
    const bottom = Math.min(r.bottom + pad, vh - 4);
    const left = Math.max(r.left - pad, 4);
    const right = Math.min(r.right + pad, vw - 4);
    Object.assign(spot.style, { top: top + "px", left: left + "px", width: right - left + "px", height: bottom - top + "px" });

    const h = pop.offsetHeight;
    const w = pop.offsetWidth;
    let x = Math.min(Math.max(M, r.left + r.width / 2 - w / 2), vw - w - M);
    let y;
    if (vh - bottom >= h + 14) {
      y = bottom + 10;
      pop.classList.add("place-below");
    } else if (top >= h + 14) {
      y = top - h - 10;
      pop.classList.add("place-above");
    } else {
      y = vh - h - M;
      x = vw - w - M;
      pop.classList.add("place-bottom");
    }
    pop.style.left = x + "px";
    pop.style.top = y + "px";
    // 小箭頭指向目標中央
    pop.style.setProperty("--ax", Math.min(Math.max(16, r.left + r.width / 2 - x), w - 16) + "px");
  }

  root.querySelector(".tour-next").onclick = () => go(index + 1);
  root.querySelector(".tour-prev").onclick = () => go(index - 1);
  root.querySelector(".tour-skip").onclick = end;
  // 點變暗區域不做任何事，避免誤觸離開
  root.querySelector(".tour-shade").onclick = (e) => e.stopPropagation();
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place, true);
  document.addEventListener("keydown", onKey);
  go(0);
}

// ---------- 右下角「需要導覽嗎？」提示 ----------

function closeOffer() {
  document.querySelector(".tour-offer")?.remove();
}

export function offerTour(steps, { delay = 800, onEnd } = {}) {
  if (store((s) => s.getItem(STORE_KEY))) return;
  try {
    if (sessionStorage.getItem(STORE_KEY + "-later")) return;
  } catch { /* 無法使用 sessionStorage 時照常顯示 */ }

  setTimeout(() => {
    if (document.querySelector(".tour-root, .tour-offer")) return;
    const box = document.createElement("div");
    box.className = "tour-offer";
    box.setAttribute("role", "dialog");
    box.innerHTML = `
      <button type="button" class="tour-offer-close" aria-label="關閉">✕</button>
      <div class="tour-offer-title">👋 第一次使用嗎？</div>
      <p>花 1 分鐘，帶您看看怎麼查詢教室借用狀況、怎麼申請借用。</p>
      <div class="tour-actions">
        <button type="button" class="tour-skip" data-act="never">不用了</button>
        <span class="spacer"></span>
        <button type="button" class="btn ghost" data-act="later">下次再說</button>
        <button type="button" class="btn" data-act="start">開始導覽</button>
      </div>`;
    box.querySelector('[data-act="start"]').onclick = () => startTour(steps, { onEnd });
    box.querySelector('[data-act="never"]').onclick = () => {
      store((s) => s.setItem(STORE_KEY, "1"));
      closeOffer();
    };
    const later = () => {
      try { sessionStorage.setItem(STORE_KEY + "-later", "1"); } catch { /* 忽略 */ }
      closeOffer();
    };
    box.querySelector('[data-act="later"]').onclick = later;
    box.querySelector(".tour-offer-close").onclick = later;
    document.body.append(box);
  }, delay);
}
