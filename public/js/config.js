// ===== 請依學校 Firebase 專案修改這個檔案 =====

// Firebase 主控台 → 專案設定 → 一般 → 你的應用程式 → SDK 設定與配置
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000",
};

// 只允許這個網域的 Google 帳號登入
export const ALLOWED_DOMAIN = "chc.edu.tw";

// 第一位（固定）管理員，用來在系統剛建立時登入設定其他管理員與主管
// ⚠ 必須和 firestore.rules 裡的 bootstrapAdmins() 一致
export const BOOTSTRAP_ADMINS = ["admin@chc.edu.tw"];

export const SITE_TITLE = "教室借用系統";

// 是否寫入 mail 集合寄送通知信（需安裝 Firebase「Trigger Email from Firestore」擴充功能）
export const MAIL_ENABLED = true;

// 尚未設定節次時使用的預設值（管理員可在後台修改）
export const DEFAULT_PERIODS = [
  { id: "p0", name: "晨光", start: "07:50", end: "08:30" },
  { id: "p1", name: "第1節", start: "08:40", end: "09:20" },
  { id: "p2", name: "第2節", start: "09:30", end: "10:10" },
  { id: "p3", name: "第3節", start: "10:30", end: "11:10" },
  { id: "p4", name: "第4節", start: "11:20", end: "12:00" },
  { id: "p5", name: "第5節", start: "13:30", end: "14:10" },
  { id: "p6", name: "第6節", start: "14:20", end: "15:00" },
  { id: "p7", name: "第7節", start: "15:10", end: "15:50" },
];
