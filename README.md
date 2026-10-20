# H.C.R.S 教室借用系統

以 Firebase（Authentication + Firestore + Hosting）建置的學校教室借用系統，取代原本的 Excel 登記方式。

## 功能

| 身分 | 可以做的事 |
| --- | --- |
| 未登入訪客 | 查看「借用狀況」月曆（只顯示已核准），可依教室篩選、點日期看當天各教室 × 節次表 |
| 一般教師（任何 @chc.edu.tw 或 @hres.chc.edu.tw 帳號） | 申請借用、查看／取消自己的申請 |
| 主管 | 以上全部 ＋ 進入管理後台審核（同意／不同意）、取消借用、收到申請通知信 |
| 管理員 | 以上全部 ＋ 設定教室、節次時間、指定管理員與主管、刪除紀錄 |

- **登入**：Google 登入，只接受 `@chc.edu.tw` 與 `@hres.chc.edu.tw` 帳號（前端與 Firestore 規則都會檢查）。要增減網域時，需同時修改 `public/js/config.js` 的 `ALLOWED_DOMAINS` 與 `firestore.rules` 的 `signedIn()`。
- **三種借用方式**
  - 只借一次：指定日期 ＋ 節次
  - 每週固定：選星期幾 ＋ 節次 ＋ 起訖日期（例如整學期）
  - 每月固定：選每月幾號 ＋ 節次 ＋ 起訖日期
- **衝突檢查**：送出申請時若與已核准的借用衝突會直接擋下並顯示衝突日期；與其他待審核申請重疊會提醒。主管核准時也會再檢查一次。
- **審核流程**：教師送出 → 寄信給所有主管 → 主管在後台同意／不同意 → 寄信通知申請人 → 核准後才顯示在公開月曆。
- 管理員／主管申請時可勾選「直接核准」，方便把 Excel 上原有的固定借用直接輸入。
- 後台「所有借用」可依狀態、教室、月份篩選並 **匯出 CSV**（可用 Excel 開啟）。

## 畫面

- `index.html`：公開借用狀況（月曆）、申請借用、我的申請
- `admin.html`：管理後台（僅管理員與主管可用）

## 資料結構（Firestore）

| 集合 | 說明 |
| --- | --- |
| `rooms/{id}` | `name`, `note`, `active`, `order` |
| `settings/periods` | `list: [{id, name, start, end}]` 節次設定 |
| `roles/{email}` | `role: "admin" \| "supervisor"`, `name`（不在此集合者皆為一般教師） |
| `reservations/{id}` | `roomId`, `roomName`, `type: once/weekly/monthly`, `date`, `weekdays[]`, `monthDays[]`, `startDate`, `endDate`, `periodIds[]`, `teacherName`（使用教師）, `className`（班級）, `course`（課程）, `purpose`（用途）, `note`, `applicantEmail`, `applicantName`, `status: pending/approved/rejected/cancelled`, 審核資訊 |
| `mail/{id}` | 寄信佇列，由 Trigger Email 擴充功能處理 |

## 安裝步驟

### 1. 建立 Firebase 專案
1. 到 [Firebase 主控台](https://console.firebase.google.com/) 建立專案。
2. **Authentication** → 登入方式 → 啟用 **Google**。
3. **Firestore Database** → 建立資料庫（選 `asia-east1` 台灣）。
4. 專案設定 → 一般 → 新增「網頁應用程式」，複製 `firebaseConfig`。

### 2. 修改設定
1. `public/js/config.js`：貼上 `firebaseConfig`。
2. 初始管理員已設定為 `hres.noc@hres.chc.edu.tw`（`config.js` 的 `BOOTSTRAP_ADMINS` 與 `firestore.rules` 的 `bootstrapAdmins()`，兩處需一致）。

### 3. 部署

前端是純靜態網頁（`public/` 資料夾），可放在 **GitHub Pages** 或 **Firebase Hosting**，二選一即可；資料一律存在 Firebase。

#### 方式 A：GitHub Pages（前端）＋ Firebase（資料）
1. GitHub repo → **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
2. 把程式合併到 `main` 分支，`.github/workflows/pages.yml` 會自動把 `public/` 部署上去
   （也可到 Actions 分頁手動執行「Deploy to GitHub Pages」）。
   網址為 `https://znxuyz.github.io/H.C.R.S-HRES-Classroom-Reservation-System/`。
3. Firebase 主控台 → **Authentication → 設定 → 已授權網域** → 新增 `znxuyz.github.io`
   （沒加的話 Google 登入會出現 `auth/unauthorized-domain` 錯誤）。
4. Firestore 規則與索引仍要設定到 Firebase，兩種做法擇一：
   - 主控台：Firestore → **規則**，貼上 `firestore.rules` 內容後發布；
     索引可在第一次開啟月曆時，依瀏覽器 Console 錯誤訊息中的連結一鍵建立
     （`reservations`：`status` 遞增 ＋ `endDate` 遞增）。
   - 指令：`firebase deploy --only firestore`

> 注意：私人（private）repo 使用 GitHub Pages 需要付費方案；免費帳號請將 repo 設為公開。
> `config.js` 裡的 Firebase 設定公開是正常的，安全性由 Firestore 規則把關。

#### 方式 B：Firebase Hosting
需要在電腦上安裝 Firebase 指令工具。指令工具要知道部署到哪個 Firebase 專案，所以先把
`.firebaserc.example` 複製一份、檔名改成 `.firebaserc`，再把裡面的 `your-firebase-project-id`
換成你的專案 ID（Firebase 主控台 → 專案設定 → 一般 → 專案 ID）。
（使用方式 A 且在主控台貼規則的話，不需要這個檔案。）
```bash
npm install -g firebase-tools
firebase login
firebase deploy        # 部署網站、Firestore 規則與索引
```
部署完成後網址為 `https://<專案ID>.web.app`。若使用自訂網域，請到 Authentication → 設定 → 已授權網域 加入該網域。

### 4. 初始設定
用初始管理員 `hres.noc@hres.chc.edu.tw` 登入 → 右上「管理後台」：
1. **教室設定**：新增教室（可排序、暫停開放）。
2. **節次設定**：調整各節名稱與時間（預設為國小常見作息）。
3. **帳號權限**：加入主管（會收到申請通知信）與其他管理員。

### 5. 寄送郵件通知（選用但建議）
系統把信件寫入 `mail` 集合，由 Firebase 官方擴充功能寄出：
1. 專案升級為 **Blaze（用量計費）** 方案（擴充功能需要；學校用量通常在免費額度內）。
2. Extensions → 安裝 **Trigger Email from Firestore**：
   - Email documents collection：`mail`
   - SMTP connection URI：例如用學校 Google 帳號的應用程式密碼
     `smtps://寄件帳號%40chc.edu.tw:應用程式密碼@smtp.gmail.com:465`
   - Default FROM address：寄件帳號
3. 若暫不寄信，把 `config.js` 的 `MAIL_ENABLED` 設為 `false` 即可，審核流程照常運作（主管需自行到後台查看「待審核」）。

## 本機測試
```bash
firebase emulators:start   # 或任何靜態伺服器，例如 npx serve public
```
（使用 ES Modules，不能直接用 `file://` 開啟。）
