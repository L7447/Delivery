/* ══════════════════════════════════════════════════════
   外送記錄 App — style.css (極簡瘦身、無深色模式版)
   ══════════════════════════════════════════════════════ */

:root {
  --bg: #f8fafc; 
  --sf: #ffffff; 
  --sf2: #f1f5f9; 
  --border: #e2e8f0;
  --bg-header: rgba(255, 255, 255, 0.85);
  --overlay-bg: rgba(240, 244, 248, 0.95);
  --bg-input: #f8fafc;

  --t1: #0f172a; 
  --t2: #475569; 
  --t3: #94a3b8; 
  --hint-color: #3b82f6;

  --card-border: #cbd5e1;
  --cashtip-bg: rgba(34, 197, 94, 0.08);
  --cashtip-border: rgba(34, 197, 94, 0.3);

  --schedule-bg: #ffffff;
  --chart-text: #1c1917;

  --text-cyan: #0891b2;
  --text-red: #dc2626;
  --text-blue: #2563eb;

  --acc: #FF6B35;
  --acc-d: rgba(255,107,53,0.1);
  --green: #22c55e;
  --green-d: rgba(34,197,94,0.1);
  --red: #ef4444;
  --red-d: rgba(239,68,68,0.1);
  --blue: #3b82f6;
  --blue-d: rgba(59,130,246,0.1);
  --gold: #f59e0b;
  --gold-d: rgba(245,158,11,0.1);

  --mono: 'SF Mono', ui-monospace, 'Menlo', monospace;  
  --title: -apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif;   
  --sans: -apple-system, 'SF Pro Text', 'Noto Sans TC', 'Helvetica Neue', sans-serif; 
  --rs: 10px;             
  --r: 16px;             
}

/* ══ 基礎設定 ══ */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; background: var(--bg); color: var(--t1); font-family: var(--sans); -webkit-font-smoothing: antialiased; overflow: hidden; -webkit-backface-visibility: hidden; backface-visibility: hidden; }
html.no-tr, html.no-tr * { transition: none !important; -webkit-transition: none !important; }
#app { width: 100%; height: 100dvh; position: relative; overflow: hidden; }

/* ══ 頁面與導航 ══ */
.page { position: absolute; inset: 0; bottom: 0; overflow-y: auto; overflow-x: hidden; padding: 16px 16px 24px; opacity: 0; transform: translateY(10px); pointer-events: none; transition: opacity .2s, transform .2s; -webkit-overflow-scrolling: touch; background: var(--bg); }
.page.active { opacity: 1; transform: translateY(0); pointer-events: auto; }
.page::-webkit-scrollbar { display: none; }
#home-bottom-content, #hist-content, #page-add > div:nth-child(2), #page-report > div:nth-child(2), #vehicle-content, #settings-content { padding-bottom: calc(100px + env(safe-area-inset-bottom)) !important; }

/* ══ 膠囊式懸浮導覽列 (全新藍底高對比版) ══ */
#nav { position: fixed; bottom: calc(13px + env(safe-area-inset-bottom)); left: 10px; right: 10px; height: 76px; display: flex; align-items: center; justify-content: space-around; background: #2563eb; border-radius: 38px; z-index: 90; padding: 0 10px; box-shadow: 0 12px 30px rgba(37, 99, 235, 0.35); }
#nav-indicator { position: absolute; top: 50%; left: 0; width: 72px; height: 66px; background: #ffffff; border-radius: 33px; transform: translateY(-50%) translateX(0px); transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1); pointer-events: none; z-index: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.ni { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; cursor: pointer; height: 58px; width: 58px; border-radius: 22px; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); -webkit-tap-highlight-color: transparent; position: relative; z-index: 1; }
.ni:active { transform: scale(0.88); }
.ni.active { background: transparent; }
.ni-img { width: 24px; height: 24px; object-fit: contain; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); filter: brightness(0) invert(1); opacity: 0.9; }
.ni.active .ni-img { transform: translateY(-2px) scale(1.08); filter: none; opacity: 1; }
.ni .lb { font-size: 10px; color: rgba(255, 255, 255, 0.85); font-weight: 600; transition: color 0.3s; }
.ni.active .lb { color: #2563eb; font-weight: 800; }

/* ══ 彈出視窗與頂部 ══ */
.overlay-page { position: fixed; inset: 0; background: var(--overlay-bg); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px); z-index: 200; display: flex; flex-direction: column; transform: translateY(100%); transition: transform .3s cubic-bezier(.4,0,.2,1); overflow: hidden; pointer-events: none; }
.overlay-page.show { transform: translateY(0); pointer-events: auto; }
.top-bar { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; background: var(--sf); }
.top-bar h2 { font-size: 16px; font-weight: 600; font-family: var(--title); }
.bar-btn { width: 32px; height: 32px; background: transparent; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; -webkit-tap-highlight-color: transparent; padding: 0; outline: none; }
.overlay-body { flex: 1; overflow-y: auto; padding: 16px; -webkit-overflow-scrolling: touch; }
.fixed-header { padding: 16px 16px 12px; flex-shrink: 0; background: var(--bg-header); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); z-index: 20; border-bottom: 1px solid rgba(0, 0, 0, 0.05); }

/* ══ 共用元件 ══ */
.pg-title { font-family: var(--title); font-size: 22px; font-weight: 700; text-align: center; margin-bottom: 16px; }
.mbtn { width: 36px; height: 36px; border-radius: 12px; background: var(--sf); border: 1px solid var(--border); box-shadow: 0 4px 6px rgba(0,0,0,0.05); display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 13px; color: var(--acc); font-weight: 900; transition: all 0.15s; flex-shrink: 0; -webkit-tap-highlight-color: transparent; }
.mbtn:active { transform: translateY(2px); background: var(--sf2); }
.fg { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.fg label { font-size: 11px; color: var(--t2); font-weight: 700; letter-spacing: .5px; }
.finp, .fsel { width: 100%; padding: 10px 12px; background: var(--bg-input); border: 1px solid var(--border); border-radius: var(--rs); color: var(--t1); font-size: 16px; font-family: var(--sans); outline: none; appearance: none; transition: 0.15s; font-weight: 600; }
.finp:focus, .fsel:focus { border-color: var(--acc); background: var(--sf); box-shadow: 0 0 0 3px var(--acc-d); }
.card { background: var(--sf); border: 1px solid var(--border); border-radius: var(--r); padding: 16px; margin-bottom: 12px; }
.btn-acc { background: var(--acc); color: #fff; border: none; border-radius: var(--rs); font-size: 14px; font-family: var(--sans); font-weight: 600; cursor: pointer; padding: 12px; }
.btn-danger { background: var(--red-d); color: var(--red); border: 1px solid rgba(239,68,68,.25); border-radius: var(--rs); padding: 10px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
.empty-tip { text-align: center; padding: 16px 0; color: var(--t3); font-size: 13px; font-weight: 700; }

/* ══ 滑動頁籤 (Slide Tabs) 修復版 ══ */
.slide-tabs { position: relative; display: flex; background: rgba(0,0,0,0.05); border-radius: 999px; padding: 4px; margin-bottom: 12px; }
.tabs-2 .slide-bg { width: calc(50% - 4px); }
.tabs-3 .slide-bg { width: calc(33.333% - 2.66px); }
.tabs-4 .slide-bg { width: calc(25% - 2px); }
.tabs-5 .slide-bg { width: calc(20% - 1.6px); }
.tabs-6 .slide-bg { width: calc(16.666% - 1.33px); }
.slide-bg { position: absolute; top: 4px; bottom: 4px; left: 4px; border-radius: 999px; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s; z-index: 0; }
body[data-tab="home"] .slide-bg    { background: var(--acc); box-shadow: 0 2px 8px rgba(255,107,53, 0.3); }
body[data-tab="history"] .slide-bg { background: var(--blue); box-shadow: 0 2px 8px rgba(59,130,246, 0.3); }
body[data-tab="report"] .slide-bg  { background: var(--green); box-shadow: 0 2px 8px rgba(34,197,94, 0.3); }
body[data-tab="vehicles"] .slide-bg{ background: #8B5CF6; box-shadow: 0 2px 8px rgba(139,92,246, 0.3); } 
.slide-btn { flex: 1; position: relative; z-index: 1; border: none; background: transparent; padding: 8px 0; color: var(--t2); font-size: 13px; font-weight: 700; cursor: pointer; transition: 0.3s; }
.slide-btn.active { color: #fff; font-weight: 800; }

/* ══ 首頁打卡按鈕 (修復復原) ══ */
.punch-card-new { background: var(--sf); border: 1px solid var(--border); border-radius: 20px; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; box-shadow: 0 8px 20px rgba(0,0,0,0.03); }
.punch-status-left { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 700; color: var(--t2); }
@keyframes blinkEffect { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.85); } }
.punch-dot-new { width: 12px; height: 12px; border-radius: 50%; background: #e2e8f0; }
.punch-dot-new.online { background: var(--green); box-shadow: 0 0 0 3px rgba(34,197,94,0.2); animation: blinkEffect 1.5s infinite; }
.punch-btn-right { padding: 10px 18px; border-radius: 12px; font-size: 13px; font-weight: 800; border: none; cursor: pointer; transition: 0.2s; display: flex; align-items: center; gap: 6px; }
.punch-btn-right:active { transform: scale(0.95); }
.btn-go-online { background: var(--green); color: #fff; box-shadow: 0 4px 12px rgba(34,197,94,0.25); }
.btn-go-offline { background: var(--red); color: #fff; box-shadow: 0 4px 12px rgba(239,68,68,0.25); }

/* ══ 現代化極簡日曆 (縮小內距、凸顯星期) ══ */
#hist-calendar {
  background: #ffffff;
  border-radius: 16px;
  padding: 8px 6px; /* ⬇️ 大幅縮小外框上下內距 */
  box-shadow: 0 4px 12px rgba(0,0,0,0.02);
  border: 1px solid #f1f5f9;
}
.month-grid { display: flex; flex-direction: column; gap: 2px; /* ⬇️ 縮小垂直間隔 */ }
.month-row  { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
/* 儲存格基礎設定：大幅縮小高度 */
.month-cell { 
  padding: 0; 
  position: relative; 
  cursor: pointer; 
  display: flex; 
  flex-direction: column; 
  align-items: center; 
  justify-content: center; 
  min-height: 40px; /* ⬇️ 將原本的 48px 縮小至 40px */
  background: transparent !important; 
  -webkit-tap-highlight-color: transparent;
}
/* 星期頭部 (日 一 二...) */
.month-cell.month-dow { 
  font-size: 13px; 
  color: #ea580c; /* 💡 改為顯眼高對比的橘紅色 */
  font-weight: 900; 
  cursor: default; 
  min-height: 20px; /* ⬇️ 縮小頭部高度 */
  padding-bottom: 4px; /* ⬇️ 縮小底部留白 */
}
/* 數字外層的圓形背景 */
.day-num { 
  width: 30px; /* ⬇️ 配合縮小的格子，將圓圈從 34px 縮小為 30px */
  height: 30px; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  border-radius: 50%; 
  font-size: 14px; 
  font-weight: 600; 
  color: #334155;
  transition: 0.2s;
  z-index: 1;
}
.month-cell:active .day-num { transform: scale(0.9); }
.month-cell.sel .day-num { background: #2563eb; color: #ffffff; font-weight: 800; box-shadow: 0 4px 8px rgba(37, 99, 235, 0.3); }
.month-cell.today:not(.sel) .day-num { background: #eff6ff; color: #2563eb; font-weight: 800; }
/* 有記錄的圓點：尺寸微調並貼齊底部 */
.has-rec-dot { 
  position: absolute; 
  bottom: 1px; /* ⬇️ 貼齊底部邊緣 */
  left: 50%; 
  transform: translateX(-50%); 
  width: 4px; /* 縮小圓點 */
  height: 4px; 
  border-radius: 50%; 
  background: #10b981; 
  z-index: 2;
}
/* 點選該日期的狀態下，綠點在深藍底上會看不清楚，改為淺藍色點點 */
.month-cell.sel .has-rec-dot { 
  background: #60a5fa; 
}

/* ══ 記錄卡片與下拉面板 ══ */
.hist-rec-card { background: var(--sf); border: 1px solid var(--border); border-radius: 16px; margin-top: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.02); overflow: hidden; }
.hrc-top { padding: 10px 12px; position: relative; cursor: pointer; }
.hrc-plat-tag { font-size: 10px; font-weight: 800; padding: 4px 8px; border-radius: 6px; color: #fff; }
.hrc-row1 { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--t2); font-weight: 700; margin-bottom: 6px; }
.hrc-amt { font-family: var(--mono); font-size: 18px; font-weight: 900; color: var(--t1); }
.hrc-toggle { position: absolute; right: 12px; top: 12px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--blue-d); color: var(--blue); font-size: 12px; font-weight: 900; cursor: pointer; transition: transform 0.3s; }
.hrc-collapse { background: #fafafa; border-top: 1px dashed var(--border); max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }

/* ══ 車輛管理：月份導航與標籤 ══ */
.veh-month-nav { background: #fff; border-radius: 99px; padding: 4px; display: inline-flex; align-items: center; box-shadow: 0 4px 12px rgba(0,0,0,0.04); border: 1px solid var(--border); }
.veh-month-btn { width: 32px; height: 32px; border-radius: 50%; border: none; background: transparent; color: var(--t2); font-size: 14px; font-weight: 900; cursor: pointer; transition: 0.2s; }
.veh-month-btn:active { background: var(--sf2); color: var(--t1); }
.veh-month-text { font-size: 15px; font-weight: 800; color: var(--t1); padding: 0 12px; min-width: 110px; text-align: center; }

/* 車輛紀錄精緻標籤 (取代 Emoji) */
.vr-chip { padding: 4px 8px; font-size: 11px; font-weight: 800; border-radius: 6px; display: inline-flex; align-items: center; white-space: nowrap; }
.chip-item  { background: #eff6ff; color: #4f46e5; border: 1px solid #c7d2fe; }
.chip-shop  { background: #fdf4ff; color: #7c3aed; border: 1px solid #e9d5ff; }
.chip-km    { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
.chip-note  { background: #fef2f2; color: #e11d48; border: 1px solid #fecdd3; }
.chip-fuel   { background: #fff7ed; color: #ea580c; border: 1px solid #ffedd5; }
.chip-liters { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
.chip-dist   { background: #f0fdfa; color: #0d9488; border: 1px solid #a7f3d0; }

.shop-chip { display: inline-flex; align-items: center; background: rgba(139,92,246,0.1); border: 1px solid rgba(139,92,246,0.3); color: #6d28d9; padding: 6px 12px; border-radius: 16px; font-size: 13px; font-weight: 700; cursor: pointer; transition: 0.2s; white-space: nowrap; }
.shop-chip-del { margin-left: 8px; background: rgba(239, 68, 68, 0.15); color: var(--red); width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; cursor: pointer; }

/* ══ 登入與註冊介面 ══ */
.auth-wrapper { background: #fff; border-radius: 24px; padding: 32px 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); border: 1px solid var(--border); margin-bottom: 20px; }
.auth-title { font-size: 26px; font-weight: 800; color: var(--t1); margin-bottom: 8px; }
.auth-subtitle { font-size: 13px; color: var(--t2); margin-bottom: 24px; line-height: 1.5; font-weight: 600; }
.auth-input-group { border: 1px solid var(--border); border-radius: 16px; padding: 10px 16px; margin-bottom: 16px; transition: 0.2s; background: #fff; }
.auth-input-group:focus-within { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
.auth-input-label { font-size: 11px; color: var(--t3); margin-bottom: 4px; display: block; font-weight: 700; }
.auth-input { width: 100%; border: none; outline: none; font-size: 15px; font-weight: 700; color: var(--t1); background: transparent; padding: 4px 0; }
.auth-btn-blue { width: 100%; background: #2563eb; color: #fff; border-radius: 16px; padding: 16px; font-size: 16px; font-weight: 800; border: none; cursor: pointer; box-shadow: 0 8px 20px rgba(37,99,235,0.25); display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 8px; transition: 0.2s; }
.auth-btn-blue:active { transform: scale(0.96); }
.auth-switch-text { text-align: center; margin-top: 24px; font-size: 13px; color: var(--t2); font-weight: 600; }
/* 修復點擊範圍與按鈕行為 */
.auth-switch-btn { background: none; border: none; color: #2563eb; font-weight: 800; font-size: 14px; cursor: pointer; padding: 8px 12px; margin-left: 4px; border-radius: 8px; transition: 0.2s; }
.auth-switch-btn:active { background: #eff6ff; }

/* ══ Toast 提示與遮罩 ══ */
#toast { position: fixed; top: 80px; left: 50%; transform: translate(-50%, -20px); background: rgba(30, 41, 59, 0.95); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 16px 28px; border-radius: 99px; font-size: 15px; font-weight: 800; opacity: 0; transition: all 0.4s; z-index: 999999; pointer-events: none; text-align: center; box-shadow: 0 12px 40px rgba(0,0,0,0.25); min-width: 240px; letter-spacing: 0.5px; }
#toast.show { opacity: 1; transform: translate(-50%, 0); }
#confirm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); backdrop-filter: blur(4px); z-index: 9999; display: none; align-items: center; justify-content: center; padding: 24px; }
#confirm-overlay.show { display: flex; }
#confirm-box { background: var(--sf); border-radius: 24px; padding: 24px; width: 100%; max-width: 340px; box-shadow: 0 20px 40px rgba(0,0,0,.15); }
#confirm-msg { font-size: 16px; font-weight: 700; color: var(--t1); line-height: 1.6; margin-bottom: 24px; text-align: center; }
