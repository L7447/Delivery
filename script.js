/* ══════════════════════════════════════════════════════
   外送記錄與分析 — script.js
   設計：由上到下分區註解，結構清晰，不閃爍，功能完整
   ══════════════════════════════════════════════════════ */
// 每當使用者點擊螢幕，就更新「最後活動時間」，防止流程在操作中途過期
document.addEventListener('click', () => {
  if (localStorage.getItem('auth_flow_active') === 'true') {
    localStorage.setItem('auth_last_active', Date.now().toString());
  }
});

/* ══ 1. 共用工具函式與狀態 開始 ══════════════════════════════ */
let turnstileWidgetId = null;
let isAppInitialized = false; // 紀錄是否已經初始化過
let currentMaintCategory = 'maintenance'; // 'maintenance' 或 'repair'
let editingVehRecId = null; 
const MAINT_ITEMS_GAS = ['機油', '齒輪油', '空濾', '前輪', '後輪', '煞車油', '前煞車皮', '後煞車皮', '傳動皮帶', '傳動保養', '大保養'];
const MAINT_ITEMS_EV = ['齒輪油', '傳動皮帶', '傳動鍊條', '煞車油', '前煞車皮', '後煞車皮', '後輪', '前輪', '其它'];
const KEYS = { records: 'delivery_records', platforms: 'delivery_platforms', settings: 'delivery_settings', punch: 'delivery_punch_live', vehicles: 'delivery_vehicles', vehicleRecs: 'delivery_vehicle_recs' };
const DEFAULT_PLATFORMS =[
  { id:'uber', name:'Uber Eats', color:'#008000', active:false, ruleDesc:'每週一及週四趟獎結算。｜每週一薪資結算。｜每週四發薪。' },
  { id:'foodpanda', name:'foodpanda', color:'#D70F64', active:false, ruleDesc:'雙週日薪資結算，｜結算後週三寄明細，｜再隔週三發薪。' },
  { id:'foodomo', name:'foodomo', color:'#ff0000', active:false, ruleDesc:'每月15日及月底薪資結算。｜每月5日及20日發薪。' },
];
/* ══ 環境判斷工具（自動區分本地開發與正式環境） ══ */
function isLocalDevelopment() {
  return location.hostname === '127.0.0.1' || 
         location.hostname === 'localhost' || 
         location.hostname.includes('192.168.') || 
         location.protocol === 'file:';
}

/** 顯示用日期：2026/6/1（去掉月日前導 0） */
function fmtDateDisp(ymd) {
  if (!ymd) return '';
  if (ymd instanceof Date) {
    return `${ymd.getFullYear()}/${ymd.getMonth()+1}/${ymd.getDate()}`;
  }
  const s = String(ymd).replace(/-/g, '/');
  // 2026/06/01 → 2026/6/1
  return s.replace(/\/0*(\d+)/g, '/$1');
}
function fmtMDDisp(ymd) {
  // 06/01 → 6/1
  if (!ymd) return '';
  if (ymd instanceof Date) return `${ymd.getMonth()+1}/${ymd.getDate()}`;
  const p = String(ymd).replace(/-/g, '/').split('/');
  if (p.length >= 3) return `${+p[1]}/${+p[2]}`;
  if (p.length === 2) return `${+p[0]}/${+p[1]}`;
  return s.replace(/\b0+(\d)/g, '$1');
}

let homePunchTimer = null;
// 打卡計時，動態彈性格式
// 格式化秒數（未滿 1 小時顯示 00:00，滿 1 小時自動顯示 01:00:00）
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = n => String(n).padStart(2, '0');

  // 超過 1 小時顯示 時:分:秒，未滿 1 小時顯示 分:秒 (從 00:00 開始)
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}
// 每秒更新一次畫面上的計時器數字
function startPunchClock(startTimeMs) {
  if (homePunchTimer) clearInterval(homePunchTimer);
  homePunchTimer = setInterval(() => {
    const el = document.getElementById('live-punch-timer');
    if (el) {
      const diff = Date.now() - startTimeMs;
      el.textContent = formatDuration(diff);
    } else {
      clearInterval(homePunchTimer); // 如果元素消失了(切換頁面)，就停止計時
    }
  }, 1000);
}

function escapeDebugText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getAuthDebugLogs() {
  try {
    const raw = localStorage.getItem('delivery_auth_debug_log');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function appendAuthDebugLog(message, detail = '', level = 'info') {
  if (!window.__debugSeq) window.__debugSeq = 0;
  window.__debugSeq += 1;
  const entry = {
    seq: window.__debugSeq,
    ts: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    message: String(message),
    detail: detail ? String(detail) : '',
    level
  };
  const logs = getAuthDebugLogs();
  logs.push(entry);
  while (logs.length > 80) logs.shift();
  localStorage.setItem('delivery_auth_debug_log', JSON.stringify(logs));
  window.__authDebugLogs = logs;
  const prefix = level === 'error' ? '⚠️ ' : '';
  console.log(`[TRACE#${entry.seq}] ${prefix}${entry.message}`, entry.detail || '');
  return logs;
}

// 支出子類別定義
const EXP_SUB_CATS = {
  '保險': ['強制險', '第三責任險', '職災險', '其它保險'],
  '裝備': ['平台開通裝備', '手機架', '藍牙耳機', '行車記錄器', '記憶卡', '行動電源', '充電線', '良民證', '安全帽', '防曬裝備', '禦寒裝備', '其它'],
  '規費': ['罰單', '停車費'],
  '貸款、分期': ['車貸', '分期付款']
};
// 更新支出子類別標籤，並清空備註
window.updateExpSubTags = function() {
  const cat = document.getElementById('f-exp-cat').value;
  const container = document.getElementById('exp-sub-tags');
  const noteInp = document.getElementById('f-exp-note');
  
  if (noteInp) noteInp.value = ''; // 👈 [需求 5] 更改分類時自動清空備註
  if (!container) return;

  const tags = EXP_SUB_CATS[cat] || [];
  container.innerHTML = tags.map(t => 
    `<div class="exp-tag-pill" data-tag="${t}" onclick="setExpNote('${t}', this)">${t}</div>`
  ).join('');
};
window.setExpNote = function(val, el) {
  // 更新備註/hidden input
  document.getElementById('f-exp-note').value = val;

  const container = document.getElementById('exp-sub-tags');
  if (container) {
    container.querySelectorAll('.exp-tag-pill')
      .forEach(x => x.classList.remove('is-selected'));
  }

  if (el) el.classList.add('is-selected');

  // 微動畫（保留你原本的想法，但改成不覆蓋成對的 class）
  el.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(0.97)' },
      { transform: 'scale(1)' }
    ],
    { duration: 200, easing: 'ease-out' }
  );
};

// 👈 [需求 2] 刪除一般支出記錄
window.deleteGeneralExpense = async function(id) {
  const ok = await customConfirm('確定要「刪除這筆支出記錄」嗎？');
  if (!ok) return;

  // 1. 濾除資料
  S.generalExpenses = S.generalExpenses.filter(e => e.id !== id);
  
  // 2. 存檔
  await idbSet('generalExpenses', S.generalExpenses);
  localStorage.setItem('delivery_general_expenses', JSON.stringify(S.generalExpenses));
  
  toast('支出記錄，已刪除 ✅');
  
  // 3. [關鍵] 觸發全局刷新，確保總額與列表同步更新
  renderReport(); 
};

/* ════ 基本工資設定區 (預設值)(範圍設定) 開始════ 
 * 未來調薪時，只需更改這裡的 max (最大) 與 min (最小) 數值即可！
 * 預設 Infinity 代表「無限大」。
 */
const DEFAULT_WAGE_RULES = [
  { max: 165,      min: 0,   text: '🚑 嚴重低於基本工資', color: 'var(--red)',   bg: 'var(--red-d)' },
  { max: 185,      min: 166, text: '😭 低於基本工資',     color: 'var(--acc)',   bg: 'var(--acc-d)' },
  { max: 195,      min: 186, text: '🥲 略低於基本工資',   color: 'var(--blue)',  bg: 'var(--blue-d)' },
  { max: Infinity, min: 196, text: '🎉 符合基本工資',     color: 'var(--green)', bg: 'var(--green-d)' }
];
// 動態取得目前設定的工資規則 (若無則使用預設)
function getActiveWageRules() {
  return (S.settings && S.settings.wageRules) ? S.settings.wageRules : DEFAULT_WAGE_RULES;
}
/* === 全域：基本工資標籤產生器 (高質感狀態圖例版) === */
function getWageBadge(hours, total) {
  // 如果使用者手動關閉此功能，直接回傳空字串不顯示標籤
  if (S.settings && S.settings.wageRulesEnabled === false) return '';
  
  if (hours <= 0 || total <= 0) return '';
  const avg = Math.round(total / hours); // 計算時薪
  const rules = getActiveWageRules();
  
  const rule = rules.find(r => avg >= r.min && avg <= r.max);
  if (!rule) return ''; 

  // 自動將 Emoji 圖示與文字分離 (利用空白切割)
  const parts = rule.text.trim().split(' ');
  const icon = parts.length > 1 ? parts[0] : '';
  const text = parts.length > 1 ? parts.slice(1).join(' ') : rule.text;

  // 定義進階樣式色系配對 (對齊設定頁的顏色)
  let bg = '#f0fdf4', color = '#15803d', border = '#86efac', shadow = 'rgba(22,163,74,0.15)'; // 第 4 階 (綠色)
  
  if (rule.color.includes('red')) {
    // 第 1 階 (紅色)
    bg = '#fef2f2'; color = '#e11d48'; border = '#fecdd3'; shadow = 'rgba(225,29,72,0.15)';
  } else if (rule.color.includes('acc')) {
    // 第 2 階 (橘色)
    bg = '#fff7ed'; color = '#c2410c'; border = '#fdba74'; shadow = 'rgba(234,88,12,0.15)';
  } else if (rule.color.includes('blue')) {
    // 第 3 階 (藍色)
    bg = '#eff6ff'; color = '#1d4ed8'; border = '#bfdbfe'; shadow = 'rgba(37,99,235,0.15)';
  }

  // 套用與「首頁狀態圖例」一模一樣的立體膠囊設計
  return `
    <div style="margin-top:3px;">
      <span style="display: inline-flex; align-items: center; margin-right:-13px; gap: 0px; font-size: 11px; font-weight: 800; padding: 2px 5px; border-radius: 8px; background: ${bg}; color: ${color}; border: 1.5px solid ${border}; white-space: nowrap;">
        ${icon ? `<span style="font-size: 13px;">${icon}</span> ` : ''}${text}
      </span>
    </div>
  `;
}
/* ══ ✨ 新增：基本工資分析設定 ══ */
function openWageSettings() {
  document.getElementById('sub-title').textContent = '基本工資分析設定';
  
  // 右上角放入重設預設值按鈕
  document.getElementById('sub-top-right').innerHTML = `
    <button onclick="resetWageSettings()" style="background:var(--sf2); color:var(--t2); border:2px solid var(--border); padding:7px 14px; border-radius:16px; font-size:14px; font-weight:700; cursor:pointer; box-shadow:0 2px 4px rgba(0,0,0,0.05); transition:0.2s;">↺ 預設值</button>
  `;

  // 讀取目前的規則設定
  const rules = getActiveWageRules();
  const l1 = rules[0].max;
  const l2 = rules[1].max;
  const l3 = rules[2].max;

  // 檢查是否已手動關閉此功能 (預設為 true 開啟)
  const isEnabled = S.settings.wageRulesEnabled !== false;

  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px; padding-bottom:32px;">
      
      <!-- 頂部總開關區塊 -->
      <div style="background:#ffffff; border-radius:16px; padding:16px; border:2px solid ${isEnabled ? '#10b981' : '#e2e8f0'}; display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; box-shadow:0 4px 12px rgba(0,0,0,0.03); transition:0.3s;" id="wage-toggle-box">
        <div style="display:flex; flex-direction:column; gap:4px;">
          <span style="font-size:15px; font-weight:900; color:var(--t1);">啟動基本工資分析</span>
          <span style="font-size:11px; font-weight:700; color:var(--t3);">開啟後，歷史記錄將自動計算時薪標籤</span>
        </div>
        <label class="switch">
          <input type="checkbox" id="wage-enabled" ${isEnabled ? 'checked' : ''} onchange="toggleWageUI(this)">
          <span class="slider"></span>
        </label>
      </div>

      <div style="font-size:13px; color:var(--hint-color); line-height:1.6; font-weight:700; margin-bottom:20px; background:var(--blue-d); padding:12px 16px; border-radius:12px; border:1px solid #bfdbfe;">
        💡 請設定各階層的「最高時薪界線」，系統會依據此數值自動計算銜接區間。
      </div>

      <!-- 👇 統一的大白框，受上方總開關控制透明度 -->
      <div id="wage-rules-container" style="background:#ffffff; border-radius:24px; padding:14px; border:2px solid #e2e8f0; box-shadow:0 8px 20px rgba(0,0,0,0.02); opacity:${isEnabled ? '1' : '0.4'}; pointer-events:${isEnabled ? 'auto' : 'none'}; transition:0.3s;">
        <div style="display:flex; flex-direction:column; gap:12px;">
          
          <!-- 第 4 階 (綠) -->
          <div style="display:flex; border-radius:16px; overflow:hidden; border: 1.5px solid #10b981;">
            <div style="flex:1; background:#ecfdf5; padding:8px 16px 12px 16px; display:flex; flex-direction:column; justify-content:center;">
              <div style="margin-bottom:25px;">
                <span style="background:#10b981; color:#fff; font-size:13px; font-weight:750; padding:4px 10px; border-radius:8px; letter-spacing:0.5px;">🎉 符合基本工資</span>
              </div>
              <div style="font-size:12px;color:#059669;font-weight:700;display:flex;align-items:flex-end;gap:6px;"> 時薪
                <!-- 👇 時薪數字毛玻璃區塊 -->
                <div style="background:rgba(16,185,129,0.1); backdrop-filter:blur(30px); -webkit-backdrop-filter:blur(40px); padding:4px 10px; border-radius:8px; border:1.5px solid rgba(16,185,129,0.2);">
                  <span style="font-family:var(--mono); font-size:18px; color:#059669; font-weight:800;"><span id="lbl-l4-min">${l3+1}</span> ~ <span id="lbl-l4-max">${rules[3]?.max === Infinity ? 1000 : rules[3].max}</span></span>
                </div> 元
              </div>
            </div>
            <div style="width:90px; background:#10b981; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:10px;">
              <span style="font-size:10px; color:#ecfdf5; font-weight:700; margin-bottom:4px;">上限</span>
              <input type="number" id="w-l4" value="${rules[3]?.max === Infinity ? 1000 : rules[3].max}" oninput="updateWageLabels()" style="width:100%; text-align:center; padding:6px; font-size:18px; color:#059669; font-weight:900; background:#fff; border:none; border-radius:8px; outline:none;">
            </div>
          </div>

          <!-- 第 3 階 (藍) -->
          <div style="display:flex; border-radius:16px; overflow:hidden; border: 1.5px solid #3b82f6;">
            <div style="flex:1; background:#eff6ff; padding:8px 16px 12px 16px; display:flex; flex-direction:column; justify-content:center;">
              <div style="margin-bottom:25px;">
                <span style="background:#3b82f6; color:#fff; font-size:13px; font-weight:750; padding:4px 10px; border-radius:8px; letter-spacing:0.5px;">🥲 略低於基本工資</span>
              </div>
              <div style="font-size:12px;color:#1d4ed8;font-weight:700;display:flex;align-items:flex-end;gap:6px;"> 時薪
                <!-- 👇 時薪數字毛玻璃區塊 -->
                <div style="background:rgba(59,130,246,0.1); backdrop-filter:blur(30px); -webkit-backdrop-filter:blur(40px); padding:4px 10px; border-radius:8px; border:1.5px solid rgba(59,130,246,0.2);">
                  <span style="font-family:var(--mono); font-size:18px; color:#1d4ed8; font-weight:800;"><span id="lbl-l3-min">${l2+1}</span> ~ <span id="lbl-l3-max">${l3}</span></span>
                </div> 元
              </div>
            </div>
            <div style="width:90px; background:#3b82f6; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:10px;">
              <span style="font-size:10px; color:#eff6ff; font-weight:700; margin-bottom:4px;">上限</span>
              <input type="number" id="w-l3" value="${l3}" oninput="updateWageLabels()" style="width:100%; text-align:center; padding:6px; font-size:18px; color:#1d4ed8; font-weight:900; background:#fff; border:none; border-radius:8px; outline:none;">
            </div>
          </div>

          <!-- 第 2 階 (橘) -->
          <div style="display:flex; border-radius:16px; overflow:hidden; border: 1.5px solid #f97316;">
            <div style="flex:1; background:#fff7ed; padding:8px 16px 12px 16px; display:flex; flex-direction:column; justify-content:center;">
              <div style="margin-bottom:25px;">
                <span style="background:#f97316; color:#fff; font-size:13px; font-weight:750; padding:4px 10px; border-radius:8px; letter-spacing:0.5px;">😭 低於基本工資</span>
              </div>
              <div style="font-size:12px;color:#fa5413;font-weight:700;display:flex;align-items:flex-end;gap:6px;"> 時薪
                <!-- 👇 時薪數字毛玻璃區塊 -->
                <div style="background:rgba(249,115,22,0.1); backdrop-filter:blur(30px); -webkit-backdrop-filter:blur(40px); padding:4px 10px; border-radius:8px; border:1.5px solid rgba(249,115,22,0.2);">
                  <span style="font-family:var(--mono); font-size:18px; color:#fa5413; font-weight:800;"><span id="lbl-l2-min">${l1+1}</span> ~ <span id="lbl-l2-max">${l2}</span></span>
                </div> 元
              </div>
            </div>
            <div style="width:90px; background:#f97316; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:10px;">
              <span style="font-size:10px; color:#fff7ed; font-weight:700; margin-bottom:4px;">上限</span>
              <input type="number" id="w-l2" value="${l2}" oninput="updateWageLabels()" style="width:100%; text-align:center; padding:6px; font-size:18px; color:#fa5413; font-weight:900; background:#fff; border:none; border-radius:8px; outline:none;">
            </div>
          </div>

          <!-- 第 1 階 (紅) -->
          <div style="display:flex; border-radius:16px; overflow:hidden; border: 1.5px solid #ef4444;">
            <div style="flex:1; background:#fef2f2; padding:8px 16px 12px 16px; display:flex; flex-direction:column; justify-content:center;">
              <div style="margin-bottom:25px;">
                <span style="background:#ef4444; color:#fff; font-size:13px; font-weight:750; padding:4px 10px; border-radius:8px; letter-spacing:0.5px;">🚑 嚴重低於基本工資</span>
              </div>
                <div style="font-size:12px;color:#f01717;font-weight:700;display:flex;align-items:flex-end;gap:6px;"> 時薪
                  <!-- 👇 時薪數字毛玻璃區塊 -->
                  <div style="background:rgba(239,68,68,0.1); backdrop-filter:blur(30px); -webkit-backdrop-filter:blur(40px); padding:4px 10px; border-radius:8px; border:1.5px solid rgba(239,68,68,0.2);">
                    <span style="font-family:var(--mono); font-size:18px; color: #f01717; font-weight:800;">0 ~ <span id="lbl-l1">${l1}</span></span>
                  </div> 元
              </div>
            </div>
            <div style="width:90px; background:#ef4444; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:10px;">
              <span style="font-size:10px; color:#fef2f2; font-weight:700; margin-bottom:4px;">上限</span>
              <input type="number" id="w-l1" value="${l1}" oninput="updateWageLabels()" style="width:100%; text-align:center; padding:6px; font-size:18px; color:#f01717; font-weight:900; background:#fff; border:none; border-radius:8px; outline:none;">
            </div>
          </div>

        </div>
      </div>
      
      <button onclick="saveWageSettings()" class="btn-acc" style="width:100%; padding:16px; font-size:16px; font-weight:900; border-radius:16px; box-shadow:0 8px 24px rgba(255,107,53,0.3); margin-top:24px;">✅ 儲存工資設定</button>
    </div>
  `;

  openOverlay('sub-page');
}
// 👇 即時切換開關的視覺效果
window.toggleWageUI = function(checkbox) {
  const box = document.getElementById('wage-toggle-box');
  const container = document.getElementById('wage-rules-container');
  if (checkbox.checked) {
    box.style.borderColor = '#10b981';
    container.style.opacity = '1';
    container.style.pointerEvents = 'auto';
  } else {
    box.style.borderColor = '#e2e8f0';
    container.style.opacity = '0.4';
    container.style.pointerEvents = 'none';
  }
}
// 使用者輸入時，即時更新下方的關聯數字預覽
window.updateWageLabels = function() {
  const l1 = parseInt(document.getElementById('w-l1').value) || 0;
  const l2 = parseInt(document.getElementById('w-l2').value) || 0;
  const l3 = parseInt(document.getElementById('w-l3').value) || 0;
  const l4 = parseInt(document.getElementById('w-l4').value) || 0;

  document.getElementById('lbl-l1').textContent = l1;
  document.getElementById('lbl-l2-min').textContent = l1 + 1;
  document.getElementById('lbl-l2-max').textContent = l2;
  document.getElementById('lbl-l3-min').textContent = l2 + 1;
  document.getElementById('lbl-l3-max').textContent = l3;
  document.getElementById('lbl-l4-min').textContent = l3 + 1;
  document.getElementById('lbl-l4-max').textContent = l4;
}

function saveWageSettings() {
  const isEnabled = document.getElementById('wage-enabled').checked;
  const l1 = parseInt(document.getElementById('w-l1').value) || 0;
  const l2 = parseInt(document.getElementById('w-l2').value) || 0;
  const l3 = parseInt(document.getElementById('w-l3').value) || 0;
  const l4 = parseInt(document.getElementById('w-l4').value) || 0;
  
  if (isEnabled && (l1 >= l2 || l2 >= l3 || l3 >= l4)) {
    toast('⚠️ 設定錯誤：金額必須依序遞增，<br>(第一階 < 第二階 < 第三階 < 第四階)');
    return;
  }

  // 儲存開關狀態
  S.settings.wageRulesEnabled = isEnabled;

  // 儲存規則
  S.settings.wageRules = [
    { max: l1, min: 0,    text: '🚑 嚴重低於基本工資', color: 'var(--red)',   bg: 'var(--red-d)' },
    { max: l2, min: l1+1, text: '😭 低於基本工資',     color: 'var(--acc)',   bg: 'var(--acc-d)' },
    { max: l3, min: l2+1, text: '🥲 略低於基本工資',   color: 'var(--blue)',  bg: 'var(--blue-d)' },
    { max: l4, min: l3+1, text: '🎉 符合基本工資',     color: 'var(--green)', bg: 'var(--green-d)' }
  ];

  saveSettings();
  closeOverlay('sub-page');
  toast('基本工資設定，已儲存 ✅');
  
  if (S.tab === 'history') renderHistory();
  if (S.tab === 'home') renderHome();
  if (S.tab === 'report') renderReport();
}
// 一鍵重設為預設值
function resetWageSettings() {
  customConfirm('確定要將『基本工資分析設定』，<br>重設為「系統預設值」嗎？').then(ok => {
    if (ok) {
      S.settings.wageRules = null; // 清空設定即可自動套用 DEFAULT_WAGE_RULES
      saveSettings();
      toast('已重設為：『預設值』✅');
      openWageSettings(); // 重新渲染設定彈窗
      
      if (S.tab === 'history') renderHistory();
      if (S.tab === 'home') renderHome();
      if (S.tab === 'report') renderReport();
    }
  });
}
/* ════ 基本工資設定區 (預設值)(範圍設定) 結束════ */

/* ══ 解析現金小費備註並賦予專屬顏色標籤 ══ */
function getCashTipTagsHtml(note) {
  if (!note) return '';
  const tags = note.split(' ').filter(t => t.trim() !== '');
  return tags.map(tag => {
    let style = 'background:#f8fafc; color:#475569; border:1px solid #cbd5e1;'; // 預設灰白
    if (tag.includes('不用找') || tag.includes('小費')) style = 'background:#fef08a; color:#854d0e; border:1px solid #facc15;';
    else if (tag.includes('爬樓梯') || tag.includes('送上樓')) style = 'background:#fbcfe8; color:#9d174d; border:1px solid #f472b6;';
    else if (tag.includes('大單') || tag.includes('重物')) style = 'background:#f3e8ff; color:#6b21a8; border:1px solid #c084fc;';
    else if (tag.includes('天氣') || tag.includes('下雨')) style = 'background:#dcfce7; color:#166534; border:1px solid #4ade80;';
    else if (tag.includes('特殊')) style = 'background:#e0f2fe; color:#0369a1; border:1px solid #60a5fa;';
    
    return `<span class="ct-mini-tag" style="${style}">${safeText(tag)}</span>`;
  }).join('');
}


function normalizePlatforms(rawPlatforms) {
  // 如果傳入的資料不是陣列，回傳全部關閉的預設平台
  if (!Array.isArray(rawPlatforms)) return DEFAULT_PLATFORMS.map(p => ({ ...p, active: false }));
  
  return DEFAULT_PLATFORMS.map(dp => {
    // 從儲存的資料中找出對應 ID 的平台
    const sp = rawPlatforms.find(s => s.id === dp.id);
    
    // 如果找到了，檢查它的 active 是否為 true (支援布林值或字串)
    const isActive = sp ? (sp.active === true || sp.active === 'true') : false;
    
    return {
      id: dp.id,
      name: dp.name,
      color: (sp && sp.color) ? sp.color : dp.color,
      active: isActive, // 👈 這裡確保了儲存的勾選狀態被帶回來
      ruleDesc: dp.ruleDesc
    };
  });
}

/* ====================== XSS 防護：HTML 轉義函式 ====================== */
function escapeHtml(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* 如果需要支援簡單換行，可以用這個安全版本 */
function escapeHtmlWithBr(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function safeText(value) {
  return escapeHtml(value);
}

function safeTextWithBr(value) {
  return escapeHtmlWithBr(value);
}

// 👇 新增：限制每行 9 個字元（2組天氣標籤約8-9字）並換行的備註格式化
function formatNoteWithLimit(note) {
  if (!note) return '';
  let lines = note.split('\n');
  let newLines = lines.map(line => {
    // 使用 Array.from 正確處理包含 Emoji 標籤的真實字元長度
    let chars = Array.from(line); 
    let res = [];
    for (let i = 0; i < chars.length; i += 9) {
      res.push(chars.slice(i, i + 9).join(''));
    }
    return res.join('\n'); // 將長字串用換行符拼接
  });
  // 最後統一做 XSS 逃脫並將換行符轉換為 <br>
  return escapeHtmlWithBr(newLines.join('\n'));
}

/* ====================== IndexedDB 儲存協助函式 ====================== */
const DB_NAME = 'delivery_records_db';
const DB_VERSION = 6; // 升級版本
const DB_STORES = ['records', 'vehicleRecs', 'generalExpenses', 'photos']; // 新增 photos

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const db = event.target.result;
      DB_STORES.forEach(storeName => {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(storeName) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDb();
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get('payload');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}

function idbSet(storeName, value) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDb();
      const tx = db.transaction(storeName, 'readwrite');
      const request = tx.objectStore(storeName).put(value, 'payload');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}

function idbDelete(storeName) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDb();
      const tx = db.transaction(storeName, 'readwrite');
      const request = tx.objectStore(storeName).delete('payload');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}


const DEFAULT_SETTINGS = { 
  goals: { weekly: 0, monthly: 0, yearly: 0 },
  /*
  rewards:[
    // 內建熊貓預設獎勵 (加入 recurringDays 陣列判斷星期幾)
    { id: 'fp_m_w', name: '週一～週三獎勵', platformId: 'foodpanda', recurring: true, recurringDays: [1,2,3], tiers:[{orders:40, amount:150}, {orders:80, amount:450}, {orders:120, amount:1300}, {orders:150, amount:2000}] },
    { id: 'fp_t_s', name: '週四～週六獎勵', platformId: 'foodpanda', recurring: true, recurringDays: [4,5,6], tiers:[{orders:40, amount:150}, {orders:80, amount:450}, {orders:120, amount:1300}, {orders:150, amount:2000}] },
    { id: 'fp_sun', name: '週日獎勵', platformId: 'foodpanda', recurring: true, recurringDays: [0], tiers:[{orders:15, amount:75}, {orders:24, amount:150}, {orders:35, amount:350}, {orders:45, amount:500}] }
  ],
  */
  rewards:[],
  shopHistory:[],
  autoBackup: false,
  // ✨ 新增提醒設定
  reminder: { enabled: false, time: '22:00', lastSent: '' } 
};

// 帳號登入系統狀態
// 替換原本的 USER 宣告
let USER = JSON.parse(localStorage.getItem('delivery_user') || '{"email":null,"verified":false,"loggedIn":false,"joinDate":null,"token":null,"role":"user"}');
function saveUser() { localStorage.setItem('delivery_user', JSON.stringify(USER)); }

// 模擬後端資料庫：儲存所有註冊的帳號資訊以供統計
let DB_USERS = JSON.parse(localStorage.getItem('delivery_db_users') || '[]');
function saveDbUsers() { localStorage.setItem('delivery_db_users', JSON.stringify(DB_USERS)); }

// 暫存驗證碼
let tempAuthCode = '';

// 👇 全域權限控制變數 (預設必須登入)
let GLOBAL_REQUIRE_LOGIN = true; 
let GLOBAL_ALLOW_REGISTRATION = true; // 👈 新增：控制是否允許註冊

// 👇 獲取雲端權限設定（自動判斷本地開發）
async function fetchSystemSettings() {
  try {
    if (isLocalDevelopment()) {
      console.log('🟢 本地開發模式 - 跳過遠端 API');
      GLOBAL_REQUIRE_LOGIN = false;
      GLOBAL_ALLOW_REGISTRATION = true;
      return;
    }

    const res = await fetch(`${API_BASE_URL}/settings/system`, { 
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) throw new Error('Network response not ok');

    const data = await res.json();
    if (data.success && data.settings) {
      GLOBAL_REQUIRE_LOGIN = data.settings.requireLoginToAdd !== false; 
      GLOBAL_ALLOW_REGISTRATION = data.settings.allowRegistration !== false;
      console.log('✅ 系統設定已從雲端載入');
    }
  } catch(e) {
    console.log('⚠️ 無法取得系統設定，使用本地預設值', e);
    GLOBAL_REQUIRE_LOGIN = false;
    GLOBAL_ALLOW_REGISTRATION = true;
  }
}

// 👇 專屬權限警告視窗
function showLoginRequiredWarning() {
  customConfirm(`
    <div style="font-size:48px; margin-bottom:12px; text-align:center;">🔒</div>
    <div style="font-size:28px; font-weight:800; color:var(--red); margin-bottom:12px; text-align:center;">權限不足</div>
    <div style="font-size:16px; color:var(--t1); line-height:1.6; text-align:center; margin-bottom:16px;">
      管理員已設定系統限制：<br>
      <span style="font-size:18px;font-family:var(--mono);font-weight:800;color:#ff0000;">必須登入帳號</span> 才能進入頁面。<br>
    </div>
    <div style="font-size:16px; color:var(--blue); font-weight:700; text-align:center;">
      是否立即前往登入畫面？
    </div>
  `).then(ok => {
    if (ok) {
      goPage('settings');
      setTimeout(() => openAuthModal(), 300);
    }
  });
}

const S = {
  tab: localStorage.getItem('delivery_current_tab') || 'home', rptY: new Date().getFullYear(), rptM: new Date().getMonth()+1, rptView: 'overview',
  calY: new Date().getFullYear(), calM: new Date().getMonth()+1, selDate: todayStr(),
  records: [], platforms: [], settings: { ...DEFAULT_SETTINGS }, punch: null,
  vehicles: [], vehicleRecs: [], editingId: null, selPlatformId: null, charts: {},
  homeSubTab: 'schedule', vehicleTab: 'fuel', newVehIcon: 4, newVehColor: '#555555',
  histPage: 1, // 新增分頁狀態
  histShowList: false, // 對帳列表預設
  histFilter: 'all',
  histReconcilePlat: null,      // 對帳明細：必選平台 id
  selVehicleId: null, vehY: new Date().getFullYear(), vehM: new Date().getMonth()+1, addVehRecType: 'fuel',
  rptOverviewFilter: 'all', ovPeriod: 'month', cmpType: 'prev_month', cmpPeriods: [],
  trendMode: 'week', // 👈 [修正] 補上預設值，避免剛進入趨勢頁、還沒點過頁籤時 navTrend() 判斷不到模式而卡住不動
  histFullCalY: new Date().getFullYear(), histFullCalM: new Date().getMonth()+1,
  generalExpenses: [], // 存放一般支出紀錄
  rptNetMode: 'month', // 淨賺頁面的子頁籤：month, year, expense_overview
  rptExpFilter: 'all', // 支出總覽的類別過濾
  rewardSubTab: 'current',
  vehSearchTab: 'search',
  orderTrips: [],
  orderTripPage: 1,
  orderTimerFullscreen: false,
  lawHourlyWage: 245
};

async function saveGeneralExpenses() {
  try {
    await idbSet('generalExpenses', S.generalExpenses);
  } catch (e) {
    localStorage.setItem('delivery_general_expenses', JSON.stringify(S.generalExpenses));
  }
}

// 讓 todayStr 支援傳入自訂日期物件
function todayStr(dObj) { 
  const d = dObj || new Date(); 
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; 
}
function nowTime() { return new Date().toTimeString().slice(0,5); }
const fmt = n => Number(n||0).toLocaleString('zh-TW', { minimumFractionDigits:0 });
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2,5);
const pad = n => String(n).padStart(2,'0');
const pf = v => parseFloat(v)||0;
const getPlatform = id => S.platforms.find(p=>p.id===id)||{name:'未知',color:'#999'};
const getDayRecs = date => S.records.filter(r=>r.date===date);
const getMonthRecs = (y,m) => { const prefix = `${y}-${pad(m)}`; return S.records.filter(r => r.date && r.date.startsWith(prefix)); };
/* 👈 [新增] 週總覽：以指定日期所在的那一週（週一至週日）為範圍 */
function getWeekRange(dateObj) {
  const d = new Date(dateObj);
  const day = d.getDay() || 7;
  const start = new Date(d); start.setDate(start.getDate() - day + 1);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  return { start, end };
}
const getWeekRecs = (dateObj) => {
  const { start, end } = getWeekRange(dateObj);
  const sStr = todayStr(start), eStr = todayStr(end);
  return S.records.filter(r => r.date && r.date >= sStr && r.date <= eStr);
};
const recTotal = r => r.isCashTip ? 0 : (pf(r.income)+pf(r.bonus)+pf(r.tempBonus)+pf(r.tips));



function _parseYMD(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function _fmtMD(str) {
  const d = _parseYMD(str);
  return `${d.getMonth()+1}/${d.getDate()}`; // 6/1，不再 pad
}

/** 取得指定平台、錨點日期所在的報酬區間 */
function getPayPeriod(platformId, anchorDate) {
  const ad = new Date(anchorDate || new Date());
  ad.setHours(12, 0, 0, 0);

  // Uber：週一～週日
  if (platformId === 'uber') {
    const { start, end } = getWeekRange(ad);
    return {
      platformId: 'uber',
      startStr: todayStr(start),
      endStr: todayStr(end),
      start, end,
      // 顯示在「日期按鈕」下方的小字（不是整頁大提醒）
      dateHint: '週一 00:00～04:00 行程歸週日'
    };
  }

  // foodpanda：以 2025-11-10 為錨點，每 14 天一區間（公式，不用查表）
  if (platformId === 'foodpanda') {
    const anchor = new Date(2025, 10, 10); // 2025/11/10
    anchor.setHours(12, 0, 0, 0);
    const diffDays = Math.floor((ad.getTime() - anchor.getTime()) / 86400000);
    const cycle = Math.floor(diffDays / 14);
    const start = new Date(anchor);
    start.setDate(start.getDate() + cycle * 14);
    const end = new Date(start);
    end.setDate(end.getDate() + 13);
    return {
      platformId: 'foodpanda',
      startStr: todayStr(start),
      endStr: todayStr(end),
      start, end,
      dateHint: null
    };
  }

  // Foodomo：上半月 1～15、下半月 16～月底
  if (platformId === 'foodomo') {
    const y = ad.getFullYear(), m = ad.getMonth();
    const isFirst = ad.getDate() <= 15;
    const start = isFirst ? new Date(y, m, 1) : new Date(y, m, 16);
    const end = isFirst ? new Date(y, m, 15) : new Date(y, m + 1, 0);
    return {
      platformId: 'foodomo',
      startStr: todayStr(start),
      endStr: todayStr(end),
      start, end,
      dateHint: null,
      isFirstHalf: isFirst
    };
  }

  const { start, end } = getWeekRange(ad);
  return { platformId, startStr: todayStr(start), endStr: todayStr(end), start, end, dateHint: null };
}

function shiftPayPeriod(platformId, anchorDate, dir) {
  const cur = getPayPeriod(platformId, anchorDate);

  if (platformId === 'uber') {
    const d = new Date(cur.start);
    d.setDate(d.getDate() + dir * 7);
    return d;
  }
  if (platformId === 'foodpanda') {
    const d = new Date(cur.start);
    d.setDate(d.getDate() + dir * 14);
    return d;
  }
  if (platformId === 'foodomo') {
    const d = new Date(cur.start);
    if (dir > 0) {
      if (cur.isFirstHalf) d.setDate(16);
      else { d.setMonth(d.getMonth() + 1); d.setDate(1); }
    } else {
      if (cur.isFirstHalf) { d.setMonth(d.getMonth() - 1); d.setDate(16); }
      else d.setDate(1);
    }
    return d;
  }
  const d = new Date(anchorDate);
  d.setDate(d.getDate() + dir * 7);
  return d;
}

/** 精簡區間總計卡（無折疊、無下方分析） */
function buildSimplePeriodSummary(total, orders, mileage, hours) {
  return `
    <div style="background:#fff; border:2px solid #1e293b; border-radius:16px; overflow:hidden; margin-bottom:4px;">
      <div style="background:#1e293b; color:#fff; padding:4px 14px; font-size:16px; font-weight:800; letter-spacing:1px;">📊 區間總計</div>
      <div style="padding:5px 14px; display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between;">
        <div style="font-family:var(--mono); font-size:26px; font-weight:900; color:#006eff;">
          <span style="font-size:12px;">$</span>${fmt(total)}
        </div>
        <div style="display:inline-flex; align-items:stretch; border-radius:10px; border:1.5px solid #c3c9d0; overflow:hidden; background:#c3c9d0; gap:2px;">
          <div style="background:#fff7ed; padding:4px 10px;"><span style="font-family:var(--mono); font-weight:900; color:#ff0000; font-size:15px;">${fmt(orders)}</span><span style="font-size:10px; color:#f97316; font-weight:700;"> 單</span></div>
          <div style="background:#e1ffff; padding:4px 10px;"><span style="font-family:var(--mono); font-weight:900; color:#b23dff; font-size:15px;">${fmt(mileage)}</span><span style="font-size:10px; color:#000; font-weight:800;"> km</span></div>
          <div style="background:#eff6ff; padding:4px 10px;"><span style="font-size:11px;">⏱️</span> <span style="font-family:var(--mono); font-weight:900; color:#2563eb; font-size:13px;">${fmtHours(hours)}</span></div>
        </div>
      </div>
    </div>`;
}

/* ══ 數學算式安全解析器 (供臨時獎勵使用) ══ */
window.safeEvalMath = function(str) {
  if (!str) return 0;
  let s = String(str).replace(/=/g, '').trim();
  if (!s) return 0;
  try {
    // 嚴格限制只能包含數字、小數點及基本運算符號，防止 XSS 安全漏洞
    if (/^[\d\+\-\*\/\.\s\(\)]+$/.test(s)) {
      let result = new Function('return ' + s)();
      return isFinite(result) ? result : 0;
    }
  } catch(e) {}
  return parseFloat(s) || 0;
};
/* ══ ⚡ 自訂數字計算鍵盤邏輯 ⚡ ══ */
let kbTargetEl = null;
// 打開鍵盤
window.openCustomKeyboard = function() {
  kbTargetEl = document.getElementById('f-temp-bonus');
  document.getElementById('math-kb-overlay').classList.add('show');
  document.getElementById('math-kb-container').classList.add('show');
  updateKbDisplay();
};
// 關閉鍵盤
window.closeCustomKeyboard = function() {
  document.getElementById('math-kb-overlay').classList.remove('show');
  document.getElementById('math-kb-container').classList.remove('show');
  // 當點擊「完成」或「背景」關閉時，自動執行一次等號結算
  kbPress('='); 
};
// 處理按鍵點擊
window.kbPress = function(key) {
  if (!kbTargetEl) return;
  let val = kbTargetEl.value;

  if (key === 'C') {
    val = '';
  } else if (key === 'DEL') {
    val = val.slice(0, -1);
  } else if (key === '=') {
    // 按下等號時計算結果
    if (val && /[\+\-\*\/]/.test(val)) {
      let res = safeEvalMath(val);
      val = String(Math.round(res * 100) / 100);
    }
  } else {
    // 防呆：防止連續輸入符號 (例如打 ++ 變 +)
    const lastChar = val.slice(-1);
    if (['+', '-', '.'].includes(key) && ['+', '-', '.'].includes(lastChar)) {
      val = val.slice(0, -1) + key; 
    } else {
      val += key;
    }
  }

  kbTargetEl.value = val;
  updateKbDisplay();
  
  // 每次按鍵都即時更新上方的新增記錄總額
  if(typeof calcAddTotal === 'function') calcAddTotal(); 
};
// 更新鍵盤上方的螢幕顯示
function updateKbDisplay() {
  const display = document.getElementById('kb-display');
  if(display) {
    display.textContent = kbTargetEl.value || '0';
    // 讓內容過長時自動捲動到最右邊
    display.scrollLeft = display.scrollWidth;
  }
}
window.handleMathInput = function(el) {
  let val = el.value;
  // 當使用者打出 '=' 時，立刻將輸入框內的算式替換為計算結果
  if (val.includes('=')) {
    let result = safeEvalMath(val);
    el.value = Math.round(result * 100) / 100; // 四捨五入到小數第二位
  }
  calcAddTotal(); // 即時更新總額
};
window.handleMathBlur = function(el) {
  // 當離開輸入框時，就算沒有打 '=' 也自動幫他算好
  let val = el.value;
  if (val && /[\+\-\*\/]/.test(val)) {
    let result = safeEvalMath(val);
    el.value = Math.round(result * 100) / 100;
  }
  calcAddTotal();
};


/* 👇 計算精確佔比 (最大餘數法)，保證加總絕對等於 100% (並自動去除 .0) */
function getExactPercentages(values, precision = 1) {
  const sum = values.reduce((a, b) => a + b, 0);
  // 如果總和是 0，回傳全部都是 '0'
  if (sum <= 0) return values.map(() => '0');

  const pow = Math.pow(10, precision); 
  const exacts = values.map(v => (v / sum) * 100);
  
  let floors = exacts.map(v => Math.floor(v * pow));
  let remainders = exacts.map((v, i) => ({ rem: (v * pow) - floors[i], idx: i }));
  
  let diff = (100 * pow) - floors.reduce((a, b) => a + b, 0);
  
  remainders.sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < diff; i++) {
    floors[remainders[i].idx] += 1;
  }
  
  return floors.map(v => {
    // 取得帶有小數點的原始字串 (如 '100.0', '95.5')
    const strVal = (v / pow).toFixed(precision);
    // 👇 如果結尾是 '.0'，就把它切掉 (變成整數)
    return strVal.endsWith('.0') ? strVal.slice(0, -2) : strVal;
  });
}

function fmtHours(hVal) {
  const h = pf(hVal); if (h <= 0) return '0';
  const totalMins = Math.round(h * 60);
  const hrs = Math.floor(totalMins / 60); const mins = totalMins % 60;
  
  // 定義單位的專屬樣式 (縮小字體、顏色改為黑色、並與數字保持些微間距)
  const unitStyle = 'font-size: 12px; color: #000000; margin:5px 4px 0 4px ; font-weight: 800;';
  
  if (hrs > 0 && mins > 0) return `${hrs}<span style="${unitStyle}">h</span>${mins}<span style="${unitStyle}">m</span>`;
  if (hrs > 0 && mins === 0) return `${hrs}<span style="${unitStyle}">h</span>`;
  return `${mins}<span style="${unitStyle}">m</span>`;
}

function toast(msg, ms=1500) {
  const el = document.getElementById('toast');
  let text = String(msg == null ? '' : msg);
  // 超過 11 個字才執行自動換行
  // 用 Array.from 正確計算含 Emoji 的字元數
  if (Array.from(text).length > 13) {
    // 1. 中文逗號「，」後面換行
    text = text.replace(/，/g, '，\n');
    // 2. 半形/全形括號 (（ 前面換行（開頭除外）
    text = text.replace(/([^\n])([\(（])/g, '$1\n$2');
  }
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}

/* ══ 智慧型進度條動畫 (支援儲存與載入) ══ */
/* ══ 執行多段式漸進進度條動畫 ══ */
let progressInterval = null;
let isSimulatingProgress = false;

function showProgress(text, isSlow = false) {
  const ov = document.getElementById('progress-overlay');
  const fill = document.getElementById('big-progress-fill');
  const txt = document.getElementById('big-progress-text');
  
  txt.textContent = text;
  fill.style.transition = 'width 0.2s ease'; 
  fill.style.width = '0%';
  ov.classList.add('show');
  
  let currentPct = 0;
  clearInterval(progressInterval);
  
  // 若設定為 isSlow (如油價載入)，則每 300ms 增加 2%，達成非常緩慢的效果
  const step = isSlow ? 2 : 5;
  const intervalMs = isSlow ? 300 : 150;
  const maxPct = isSlow ? 95 : 85;

  progressInterval = setInterval(() => {
    if (currentPct < maxPct) {
      currentPct += step;
      fill.style.width = currentPct + '%';
    }
  }, intervalMs);
  
  isSimulatingProgress = true;
}
function finishProgress(callback) {
  clearInterval(progressInterval); // 停止定時器
  const ov = document.getElementById('progress-overlay');
  const fill = document.getElementById('big-progress-fill');
  
  if (!isSimulatingProgress) {
    if (callback) callback();
    return;
  }
  
  // 瞬間衝向 100%
  fill.style.transition = 'width 0.4s ease-out';
  fill.style.width = '100%';
  
  // 動畫結束後隱藏
  setTimeout(() => {
    ov.classList.remove('show');
    isSimulatingProgress = false;
    if (callback) callback();
  }, 450); 
}

// 保留給舊的儲存流程呼叫
function runSaveProgress(callback) {
  showProgress('資料儲存中...');
  setTimeout(() => { finishProgress(callback); }, 500); 
}

/* ══ 彈窗事件安全性加強 ══ */
window.customConfirm = function(msg) {
  return new Promise(resolve => {
    const ov = document.getElementById('confirm-overlay');
    // 如果確認框不存在，這裡應確保它在 HTML 載入時就已經是 display: none
    if (!ov) return resolve(false);

    document.getElementById('confirm-msg').innerHTML = msg;
    ov.classList.add('show');

    const ok = document.getElementById('confirm-ok-btn');
    const cancel = document.getElementById('confirm-cancel-btn');

    // 移除舊的監聽器，防止事件累積導致的重複觸發或卡死
    const onOk = () => { ov.classList.remove('show'); resolve(true); cleanup(); };
    const onCancel = () => { ov.classList.remove('show'); resolve(false); cleanup(); };
    
    function cleanup() {
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
    }

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
  });
};
function openOverlay(id) { 
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('show'); 
  }
}
/* ══ 正確的關閉彈窗邏輯 ══ */
function closeOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;

  if (id === 'sub-page' && el.dataset.forced === 'true') {
    toast('⚠️ 安全要求：請先完成密碼修改');
    return;
  }

  el.classList.remove('show');
  
  if (id === 'sub-page') {
    window.__authFlowLocked = false;
    window.__authTurnstileActive = false;
    // 👈 [關鍵]：手動關閉彈窗，就代表流程結束了，移除復活標記
    localStorage.removeItem('auth_flow_active'); 
    localStorage.removeItem('auth_last_active');
    localStorage.removeItem('auth_origin_tab');
  }
}

/* 🌟 記錄詳情專用：極致滑順向下關閉動畫 (320ms iOS 彈性物理曲線) */
function closeDetailOverlay() {
  const ov = document.getElementById('detail-overlay');
  const box = document.getElementById('detail-box');
  if (!ov || !ov.classList.contains('show')) return;

  // 1. 背景與卡片同步啟動 320ms GPU 硬體加速動畫
  ov.style.transition = 'opacity 0.6s ease-out';
  ov.style.opacity = '0';

  if (box) {
    box.style.transition = 'transform 0.62s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.32s ease-out';
    box.style.transform = 'translate3d(0, 110%, 0) scale(0.96)';
    box.style.opacity = '0';
  }

  // 2. 動畫播放完畢後移除彈窗並恢復內聯樣式
  setTimeout(() => {
    ov.classList.remove('show');
    ov.style.opacity = '';
    ov.style.transition = '';
    if (box) {
      box.style.transform = '';
      box.style.opacity = '';
      box.style.transition = '';
    }
  }, 620);
}

/* 退出按鈕點擊動畫：抽屜式往左慢慢抽離 (附帶停留感) */
window.animateClose = function(btn, action) {
  const img = btn.querySelector('img');
  if (img) img.src = 'images/close2.png';
  btn.style.pointerEvents = 'none'; // 鎖定按鈕防止連點

  // 自動往上尋找最外層的頁面或彈窗容器
  const targetWrap = btn.closest('.overlay-page, #detail-overlay, #full-calendar-overlay, .page');
  
  // 套用抽屜往左滑出特效
  if (targetWrap) {
    targetWrap.classList.add('drawer-slide-out');
  }

  // 設定 600ms 延遲，配合 CSS 動畫播完後再執行關閉
  setTimeout(() => {
    action(); // 執行原本的關閉指令
    
    // 動作執行完畢後，移除動畫 Class，確保下次開啟時，動畫能再次被觸發
    if (targetWrap) {
      targetWrap.classList.remove('drawer-slide-out');
    }
    
    // 恢復原狀以供下次開啟
    if (img) img.src = 'images/close1.png';
    btn.style.pointerEvents = 'auto';
  }, 850);
}
/* 返回按鈕專用：由上而下關閉動畫 */
window.animateReturnClose = function(btn, action) {
  const img = btn.querySelector('img');
  if (img) img.src = 'images/close2.png';
  btn.style.pointerEvents = 'none';

  const targetWrap = btn.closest('.overlay-page, #sub-page, #detail-overlay, #full-calendar-overlay');

  // 🌟 若為記錄詳情彈窗，直接觸發 320ms 極速滑順向下動畫
  if (targetWrap && targetWrap.id === 'detail-overlay') {
    setTimeout(() => {
      action();
      if (img) img.src = 'images/close1.png';
      btn.style.pointerEvents = 'auto';
    }, 50);
    return;
  }

  // 其他大型彈窗
  setTimeout(() => {
    if (targetWrap) {
      if (targetWrap.id === 'full-calendar-overlay' && window.innerWidth < window.innerHeight) {
          targetWrap.classList.add('slide-down-out-rotated');
      } else {
          targetWrap.classList.add('slide-down-out');
      }
    }

    setTimeout(() => {
      action();
      if (targetWrap) {
          targetWrap.classList.remove('slide-down-out');
          targetWrap.classList.remove('slide-down-out-rotated');
      }
      if (img) img.src = 'images/close1.png';
      btn.style.pointerEvents = 'auto';
    }, 350);
  }, 80);
};
/* 子頁面內部切換專用：內容向下滑出並淡入新內容 (解決背景閃爍破綻) */
window.animateSubPageReturn = function(btn, action) {
  btn.style.pointerEvents = 'none';

  const subBody = document.getElementById('sub-body');
  const subTitle = document.getElementById('sub-title');

  // 1. 讓框內的內容向下滑出並淡出
  subBody.style.transition = 'transform 0.25s ease-in, opacity 0.25s ease-in';
  subBody.style.transform = 'translateY(30px)';
  subBody.style.opacity = '0';
  subTitle.style.transition = 'opacity 0.25s ease-in';
  subTitle.style.opacity = '0';

  setTimeout(() => {
    action(); // 2. 執行返回指令，此時內容會被替換

    // 3. 瞬間把新內容的位置拉到稍微偏上，準備滑入
    subBody.style.transition = 'none';
    subBody.style.transform = 'translateY(-15px)';
    void subBody.offsetWidth; // 強制重繪

    // 4. 加上滑順的淡入特效
    subBody.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease-out';
    subTitle.style.transition = 'opacity 0.35s ease-out';

    subBody.style.transform = 'translateY(0)';
    subBody.style.opacity = '1';
    subTitle.style.opacity = '1';

    btn.style.pointerEvents = 'auto';
  }, 250);
}
/* 專屬：向右翻頁並停留 2 秒的關閉動畫 */
window.flipCloseOverlay = function(btn, overlayId) {
  const overlay = document.getElementById(overlayId);

  const img = btn.querySelector('img');
  if (img) img.src = 'images/close2.png';
  btn.style.pointerEvents = 'none';

  // 套用向右翻頁動畫 Class
  overlay.classList.add('flip-page-out');

  // 停留 2 秒 (2000ms) 後，才真正移除元素並復原狀態
  setTimeout(() => {
    overlay.classList.remove('show');
    overlay.classList.remove('flip-page-out'); // 清除動畫，確保下次開啟正常
    if (img) img.src = 'images/close1.png';
    btn.style.pointerEvents = 'auto';
  }, 2000);
}

// 2. 總結卡片摺疊
function toggleSummaryCard(id) {
  const el = document.getElementById(id); 
  const btn = document.getElementById(id + '-btn'); 
  if (!el || !btn) return;
  if (navigator.vibrate) try { navigator.vibrate(12); } catch(e){}

  requestAnimationFrame(() => {
    if (el.style.maxHeight === '0px' || el.style.maxHeight === '') { 
      el.style.maxHeight = el.scrollHeight + 'px'; 
      btn.style.transform = 'rotate(180deg)'; 
    } else { 
      el.style.maxHeight = '0px'; 
      btn.style.transform = 'rotate(0deg)';
    }
  });
}

/* ══════════════════════════════ 🌟 通用「▼ 快速選擇日期」元件 ══════════════════════════════
   凡是頁面上有「◀ 日期 ▶」日期切換按鈕的地方，皆可呼叫 openQuickDatePicker() 開啟本彈窗，
   讓使用者直接跳到指定的 年/月、年、或週，不必一次次點擊 ◀▶。
   config = {
     mode: 'month' | 'year' | 'week',
     year, curY, curM,            // mode='month'/'year' 用
     weekAnchor: Date,            // mode='week' 用（用來列出鄰近週次）
     onSelect: (y, m) => {},      // mode='month' 會傳 (y,m)；mode='year' 只傳 (y)
     onSelectWeek: (date) => {}   // mode='week' 用
   }
*/
let _qdpState = {};
function closeQuickDatePicker() {
  const ov = document.getElementById('quick-date-overlay');
  if (ov) ov.classList.remove('show');
}
function openQuickDatePicker(config) {
  _qdpState = config || {};
  renderQuickDatePicker();
  const ov = document.getElementById('quick-date-overlay');
  if (ov) ov.classList.add('show');
}
function qdpChangeYear(dir) {
  _qdpState.year = (_qdpState.year || new Date().getFullYear()) + dir;
  renderQuickDatePicker();
}
function qdpPickMonth(m) {
  if (typeof _qdpState.onSelect === 'function') _qdpState.onSelect(_qdpState.year, m);
  closeQuickDatePicker();
}
function qdpPickYear(y) {
  if (typeof _qdpState.onSelect === 'function') _qdpState.onSelect(y);
  closeQuickDatePicker();
}
function qdpPickWeek(offsetWeeks) {
  const base = new Date(_qdpState.weekAnchor || new Date());
  base.setDate(base.getDate() + offsetWeeks * 7);
  if (typeof _qdpState.onSelectWeek === 'function') _qdpState.onSelectWeek(base);
  closeQuickDatePicker();
}

// 🌟 快速日期彈窗輔助函式
window.qdpSelectMonth = function(m) {
  _qdpState.month = m;
  renderQuickDatePicker();
};

window.qdpPickDay = function(d) {
  const y = _qdpState.year || _qdpState.curY;
  const m = _qdpState.month || _qdpState.curM || 1;
  if (typeof _qdpState.onSelectDay === 'function') {
    _qdpState.onSelectDay(y, m, d);
  } else if (typeof _qdpState.onSelect === 'function') {
    _qdpState.onSelect(y, m, d);
  }
  closeQuickDatePicker();
};

function renderQuickDatePicker() {
  const body = document.getElementById('quick-date-body');
  if (!body) return;
  const cfg = _qdpState;
  let html = '';

  if (cfg.mode === 'year') {
    const centerY = cfg.year || cfg.curY || new Date().getFullYear();
    const years = [];
    for (let i = 4; i >= -1; i--) years.push(centerY - i + 1);
    html += `<div class="qdp-title">📅 快速選擇年份</div>
      <div class="qdp-month-grid" style="grid-template-columns:repeat(3,1fr);">
        ${years.map(y => `<button class="qdp-month-btn ${y === cfg.curY ? 'active' : ''}" onclick="qdpPickYear(${y})">${y}</button>`).join('')}
      </div>`;
  } else if (cfg.mode === 'week') {
    const anchor = new Date(cfg.weekAnchor || new Date());
    html += `<div class="qdp-title">📅 快速選擇週次</div>
      <div class="qdp-week-grid">
        ${Array.from({length:10}, (_,i) => 4 - i).map(off => {
          const s = new Date(anchor); s.setDate(s.getDate() + off * 7);
          const day = s.getDay() || 7; s.setDate(s.getDate() - day + 1);
          const e = new Date(s); e.setDate(e.getDate() + 6);
          const isCur = off === 0;
          return `<button class="qdp-week-btn ${isCur ? 'active' : ''}" onclick="qdpPickWeek(${off})">${s.getFullYear()}/${pad(s.getMonth()+1)}/${pad(s.getDate())} ~ ${pad(e.getMonth()+1)}/${pad(e.getDate())}</button>`;
        }).join('')}
      </div>`;
  } else if (cfg.mode === 'day') {
    // 🌟 新增：年月日 (含日選擇) 模式
    const y = cfg.year || cfg.curY || new Date().getFullYear();
    const m = cfg.month || cfg.curM || (new Date().getMonth() + 1);
    const curD = cfg.curD || 1;
    const maxDays = new Date(y, m, 0).getDate();

    html += `<div class="qdp-title">📅 快速選擇日期</div>
      <div class="qdp-year-nav">
        <button onclick="qdpChangeYear(-1)">◀</button>
        <span class="qdp-year-label">${y} 年</span>
        <button onclick="qdpChangeYear(1)">▶</button>
      </div>

      <!-- 月份選擇條 -->
      <div style="font-size:12px; font-weight:800; color:var(--t3); margin:6px 0 4px; text-align:left;">選擇月份：</div>
      <div class="hide-scroll-bar" style="display:flex; gap:6px; overflow-x:auto; padding-bottom:4px; margin-bottom:8px;">
        ${Array.from({length:12}, (_,i) => i+1).map(mNum => `
          <button class="qdp-month-btn ${mNum === m ? 'active' : ''}" onclick="qdpSelectMonth(${mNum})" style="flex-shrink:0; padding:4px 10px; font-size:13px;">${mNum}月</button>
        `).join('')}
      </div>

      <!-- 日期選擇網格 (7縱列月曆網格) -->
      <div style="font-size:12px; font-weight:800; color:var(--t3); margin:4px 0; text-align:left;">選擇日期（${m} 月）：</div>
      <div class="qdp-month-grid" style="grid-template-columns:repeat(7,1fr); gap:4px; max-height:170px; overflow-y:auto; padding:2px;">
        ${Array.from({length:maxDays}, (_,i) => i+1).map(dNum => `
          <button class="qdp-month-btn ${y === cfg.curY && m === cfg.curM && dNum === curD ? 'active' : ''}" onclick="qdpPickDay(${dNum})" style="padding:6px 2px; font-size:13px; font-family:var(--mono);">${dNum}</button>
        `).join('')}
      </div>`;
  } else {
    // 預設月份模式
    const y = cfg.year || cfg.curY || new Date().getFullYear();
    html += `<div class="qdp-title">📅 快速選擇年月</div>
      <div class="qdp-year-nav">
        <button onclick="qdpChangeYear(-1)">◀</button>
        <span class="qdp-year-label">${y} 年</span>
        <button onclick="qdpChangeYear(1)">▶</button>
      </div>
      <div class="qdp-month-grid">
        ${Array.from({length:12}, (_,i) => i+1).map(m => `<button class="qdp-month-btn ${y === cfg.curY && m === cfg.curM ? 'active' : ''}" onclick="qdpPickMonth(${m})">${m} 月</button>`).join('')}
      </div>`;
  }

  html += `<button class="qdp-close-btn" onclick="closeQuickDatePicker()">取消</button>`;
  body.innerHTML = html;
}


function buildSummaryCard(title, total, orders, mileage, hours, bonus, tempBonus, tips, cardId, dateStr = '') {
  if (total <= 0) return '';
  const totalBonus = bonus + tempBonus; 
  const income = total - totalBonus - tips; // 算出淨行程
  
  // 計算佔比 (精確到小數點後1位並保證加總100.0%)
  const pcts = getExactPercentages([income, totalBonus, tips]);
  const incPct = pcts[0];
  const bonPct = pcts[1];
  const tipPct = pcts[2];

  // 👇 一體成型三色膠囊（缺資料也顯示，數字留––）
  const ordText = orders > 0 ? fmt(orders) : '––';
  const milText = mileage > 0 ? fmt(mileage) : '––';
  const hrText  = hours > 0 ? fmtHours(hours) : '––';

  const tagsHtml = `
    <div style="display:inline-flex;align-items:stretch;border-radius:8px;border:1.5px solid #e2e8f0;overflow:hidden;margin-bottom:4px;background:#e2e8f0;gap:2px;">
      <div style="background:#fff7ed;padding:1.5px 8px;display:flex;align-items:baseline;gap:3px;min-width:42px;">
        <span style="font-size:15px;font-family:var(--mono);font-weight:800;color:#ff0000;">${ordText}</span>
        <span style="font-size:10px;font-weight:600;color:#f97316;">單</span>
      </div>
      <div style="background:#e1ffff;padding:2px 8px;display:flex;align-items:baseline;gap:3px;min-width:48px;">
        <span style="font-size:15px;font-family:var(--mono);font-weight:800;color:#b23dff;">${milText}</span>
        <span style="font-size:10px;font-weight:800;color:#000;">km</span>
      </div>
      <div style="background:#eff6ff;padding:2px 8px;display:flex;align-items:center;gap:4px;min-width:52px;">
        <span style="font-size:11px;">⏱️</span>
        <span style="font-size:13px;font-family:var(--mono);font-weight:800;color:#2563eb;">${hrText}</span>
      </div>
    </div>`;

  const avgOrd = orders > 0 ? Math.round(total / orders) : 0;
  const ordHr = hours > 0 ? (orders / hours).toFixed(1) : 0;
  const avgHr = hours > 0 ? Math.round(total / hours) : 0;

  // 👇 基本工資分析
  const wageHtml = getWageBadge(hours, total);

  return `
    <div class="hist-rec-card" style="border: 2px solid #708090; box-shadow: 0 4px 10px rgba(0,0,0,0.03);">
      <div class="hrc-top" onclick="foldCard('${cardId}', event)" style="padding: 2px 7px; margin:0px 0 4px 0px;">
        <div class="hrc-toggle" id="${cardId}-btn" style="right:2px;top:0px;width:20px;height:20px;font-size:14px;">▼</div>
        <div class="hrc-row1">
          <span style="position:absolute; top:0; left:0; background:#64748b; color:#ffffff; padding:4px 14px; border-radius:0 0 16px 0; font-size:12px; font-weight:800; letter-spacing:1px;">${title}</span>
          ${dateStr ? `<span style="justify-content:center;margin: 0px 0 3px 100px;letter-spacing:0.5px;background: #fbff89;border:1px solid #000;border-radius:15px;padding:0.5px 12px;">${dateStr}</span>` : ''}
        </div>
        <div class="hrc-row2" style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; width: 100%; gap: 4px;">
          <!-- 左側金額 -->
          <span class="hrc-amt" style="color:var(--text-blue); font-weight: 800; flex-shrink: 0;">
            <span style="font-size:12px;">$ </span>${fmt(total)}
          </span>

          <!-- 右側標籤 (核心修正：加入 margin-left: auto) -->
          <div style="margin-left: auto;">
            ${tagsHtml}
          </div>
        </div>
      </div>

      <div id="${cardId}" class="hrc-collapse" style="background: #f0f7ff; overflow:hidden; transition:max-height 0.3s ease;">
        <div style="padding: 7px 8px 1px 8px; width: 100%; box-sizing: border-box;">
          
          <!-- 淨行程、獎勵、小費方塊區 (強制 3 等分網格) -->
          <div style="display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:6px;">
          
          <!-- 淨行程方塊 -->
          <div style="flex:1; display:flex; flex-direction:column; position:relative; background:#ffffff; border-radius:12px; border:1.5px solid #bbf7d0; overflow:hidden;">
            <!-- 標題區：下半部微圓角切削 -->
            <div style="background: rgba(34, 197, 94, 0.12); padding:4px 6px; display:flex; justify-content:center; align-items:center; gap:6px; border-radius:0 0 15px 15px; border-bottom:1px solid rgba(34,197,94,0.2);">
              <span style="color: #17a44b; font-size:12px; font-weight:650; font-family:var(--mono); padding-left:8px;">淨行程</span>
              <span style="display:inline-flex; align-items:center; border-radius:6px; padding:1px 4px; background: #ffffff; border:1px solid rgba(34, 197, 94, 0.3);">
                <span style="color: #17a44b; font-size:11px; font-weight:750; font-family:var(--mono);">${incPct}<span style="font-size:9px;"> %</span></span>
              </span>
            </div>
            <!-- 數字區：背景微漸層對應上方顏色 -->
            <div style="padding-top:7px; text-align:center; background:linear-gradient(180deg, rgba(34,197,94,0.03) 0%, transparent 80%);">
              <span style="color: #17a44b; font-size:17px; font-weight:750; font-family:var(--mono);"><span style="font-size:11px; opacity:0.8;">$ </span>${fmt(income)}</span>
            </div>
          </div>

          <!-- 獎勵方塊 -->
          <div style="flex:1; display:flex; flex-direction:column; position:relative; background:#ffffff; border-radius:12px; border:1.5px solid #fde047; overflow:hidden;">
            <div style="background: rgba(245, 158, 11, 0.12); padding:4px 6px; display:flex; justify-content:center; align-items:center; gap:6px; border-radius:0 0 15px 15px; border-bottom:1px solid rgba(245,158,11,0.2);">
              <span style="color: #ff791a; font-size:12px; font-weight:650; font-family:var(--mono); padding-left:8px;">獎勵</span>
              <span style="display:inline-flex; align-items:center; border-radius:6px; padding:1px 4px; background: #ffffff; border:1px solid rgba(245, 158, 11, 0.3);">
                <span style="color: #ff791a; font-size:11px; font-weight:750; font-family:var(--mono);">${bonPct}<span style="font-size:9px;"> %</span></span>
              </span>
            </div>
            <div style="padding-top:7px; text-align:center; background:linear-gradient(180deg, rgba(245,158,11,0.03) 0%, transparent 80%);">
              <span style="color: #ff791a; font-size:17px; font-weight:750; font-family:var(--mono);"><span style="font-size:11px; opacity:0.8;">$ </span>${fmt(totalBonus)}</span>
            </div>
          </div>

          <!-- 小費方塊 -->
          <div style="flex:1; display:flex; flex-direction:column; position:relative; background:#ffffff; border-radius:12px; border:1.5px solid #d8b4fe; overflow:hidden;">
            <div style="background: rgba(168, 85, 247, 0.12); padding:4px 6px; display:flex; justify-content:center; align-items:center; gap:6px; border-radius:0 0 15px 15px; border-bottom:1px solid rgba(168,85,247,0.2);">
              <span style="color: #7e22ce; font-size:12px; font-weight:650; font-family:var(--mono); padding-left:8px;">小費</span>
              <span style="display:inline-flex; align-items:center; border-radius:6px; padding:1px 4px; background: #ffffff; border:1px solid rgba(168, 85, 247, 0.3);">
                <span style="color: #9333ea; font-size:11px; font-weight:750; font-family:var(--mono);">${tipPct}<span style="font-size:9px;"> %</span></span>
              </span>
            </div>
            <div style="padding-top:7px; text-align:center; background:linear-gradient(180deg, rgba(168,85,247,0.03) 0%, transparent 80%);">
              <span style="color: #7e22ce; font-size:17px; font-weight:750; font-family:var(--mono);"><span style="font-size:11px; opacity:0.8;">$ </span>${fmt(tips)}</span>
            </div>
          </div>
        </div>
        
        <div style="border:1px solid #83c3ff; border-radius:10px; margin: 5px 0px -10px 0px;"></div>

        <div style="padding:5px 3px 5px 3px; display:flex; justify-content:center; align-items:flex-start; font-size:12px; font-weight:700; color: #000000; width:100%;">
          <div style="flex:1; text-align:center; padding-top:9px; font-family:var(--mono);">
            <span style="letter-spacing: 1.5px;">一單</span>： <span style="color: #16a3ca;font-size:19px;font-weight:800;"><span style="font-size:10px;">$ </span>${fmt(avgOrd)}</span>
          </div>
          <div class="h-div" style="height:58px; width:3px; margin-top:10px;"></div>
          <div style="flex:1; text-align:center; padding-top:9px; font-family:var(--mono)">
            <span style="letter-spacing: 1.5px;">1h</span>： <span style="color: var(--text-red); font-size:19px; font-weight:800;">${ordHr}<small style="color: rgb(185, 56, 255);font-size:10px; font-weight:600;"> 單</small></span>
          </div>
          <div class="h-div" style="height:58px; width:3px; margin-top:10px;"></div>
          <div style="flex:1; text-align:center; padding-top:9px; font-family:var(--mono)">
            <span style="letter-spacing: 1.5px;">時薪</span>： <span style="color: var(--text-blue); font-size:19px; font-weight:800;"><span style="font-size:10px;">$ </span>${fmt(avgHr)}</span>
            ${wageHtml}
          </div>
        </div>
      </div>
      </div>
    </div>`;
}

// 修復：計算平台日程表的函式 (擴大預測範圍至35天，解決Foodomo月底結算超過14天不顯示的問題)
function calcNextDates(id) {
  const today = new Date();
  today.setHours(0,0,0,0);
  const events = [];

  function addEv(name, targetDate) {
    const d = new Date(targetDate); d.setHours(0,0,0,0);
    const diff = Math.round((d - today) / 86400000);
    // 👇 將過濾條件從 14 天放寬到 35 天
    if (diff >= 0 && diff <= 35) {
      events.push({
        name, 
        dateStr: `${d.getMonth() + 1}/${d.getDate()}`, 
        diff, 
        diffStr: diff === 0 ? '今天' : diff === 1 ? '明天' : `${diff} 天後`,
        ts: d.getTime()
      });
    }
  }

  if (id === 'uber') {
    // 👇 迴圈檢查天數拉長到 35 天
    for(let i=0; i<=35; i++) {
      let d = new Date(today); d.setDate(d.getDate() + i);
      let dw = d.getDay();
      if (dw === 1) addEv('平日獎結算', d);
      if (dw === 4) { addEv('假日獎結算', d); addEv('發薪', d); }
    }
  } else if (id === 'foodpanda') {
    // 1. 取單率結算：每週三、六、日
    for(let i=0; i<=35; i++) {
      let d = new Date(today); d.setDate(d.getDate() + i);
      let dw = d.getDay(); // 0是週日, 3是週三, 6是週六
      if (dw === 3 || dw === 6 || dw === 0) {
        addEv('取單率結算', d);
      }
    }
    // 2. 雙週薪資結算 / 明細寄發 / 發薪
    //    錨點：2023/12/24（週日）= 某報酬區間末日（薪資結算日）
    //    週期 14 天：
    //      diffDays % 14 === 0  → 薪資結算（報酬區間最後一天，雙週日）
    //      (diffDays - 3) % 14 === 0  → 明細寄發（結算後第一個週三）
    //      (diffDays - 10) % 14 === 0 → 發薪（再隔一個週三）
    //    對照官方表：例 11/23 結算 → 11/26 明細 → 12/03 發薪
    const anchor = new Date(2023, 11, 24); 
    for(let i=0; i<=35; i++) {
      let d = new Date(today); d.setDate(d.getDate() + i);
      let diffDays = Math.round((d - anchor) / 86400000);
      
      // 薪資結算日 = 報酬區間最後一天（雙週日）
      if (diffDays % 14 === 0) addEv('薪資結算', d);
      // 每雙週三寄發明細
      if ((diffDays - 3) % 14 === 0) addEv('明細寄發', d);
      // 每雙週三發薪
      if ((diffDays - 10) % 14 === 0) addEv('發薪', d);
    }
  } else if (id === 'foodomo') {
    // 👇 迴圈檢查天數統一拉長到 35 天
    for(let i=0; i<=35; i++) {
      let d = new Date(today); d.setDate(d.getDate() + i);
      let dt = d.getDate();
      let isLastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() === dt;
      if (dt === 15 || isLastDay) addEv('薪資結算', d);
      if (dt === 5 || dt === 20) addEv('發薪', d);
    }
  }

  const uniqueEvents = [];
  const seen = new Set();
  // 依時間先後排序，過濾掉同一天重複的同名標籤，最後只取前 3 個顯示
  events.sort((a,b) => a.ts - b.ts).forEach(e => {
    const key = `${e.name}-${e.dateStr}`;
    if(!seen.has(key)) { seen.add(key); uniqueEvents.push(e); }
  });
  return uniqueEvents.slice(0, 3); 
}

/* ══ 加密版 loadAll() ═══════════════════════════════════════════════ */
async function loadAll() {
  console.log("🚀 資料庫同步中...");
  
  // 1. 讀取一般支出 (generalExpenses)
  try {
    const storedExp = await idbGet('generalExpenses');
    if (Array.isArray(storedExp)) {
      S.generalExpenses = storedExp;
    } else {
      S.generalExpenses = JSON.parse(localStorage.getItem('delivery_general_expenses') || '[]');
    }
  } catch (e) { S.generalExpenses = []; }

  // 2. 讀取行程記錄 (records)
  try {
    const storedRecs = await idbGet('records');
    S.records = Array.isArray(storedRecs) ? storedRecs : JSON.parse(localStorage.getItem(KEYS.records) || '[]');
  } catch (e) { S.records = []; }

  // 3. 讀取車輛記錄 (vehicleRecs)
  try {
    const storedVeh = await idbGet('vehicleRecs');
    S.vehicleRecs = Array.isArray(storedVeh) ? storedVeh : JSON.parse(localStorage.getItem(KEYS.vehicleRecs) || '[]');
  } catch (e) { S.vehicleRecs = []; }

  // 4. 讀取平台與其餘設定 (LocalStorage)
  try {
    S.platforms = normalizePlatforms(JSON.parse(localStorage.getItem(KEYS.platforms) || '[]'));
    S.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEYS.settings) || '{}') };
    S.vehicles = JSON.parse(localStorage.getItem(KEYS.vehicles) || '[]');
    S.punch = JSON.parse(localStorage.getItem(KEYS.punch) || 'null');
  } catch (e) { console.warn("設定檔載入異常", e); }

  loadOrderTrips();

  console.log(`✅ 載入完成: 支出 ${S.generalExpenses.length} 筆 / 行程 ${S.records.length} 筆`);
}

/* 替換原本的 saveRecords 等儲存函式 */
function performAutoBackup() {
  if (S.settings.autoBackup && USER.loggedIn) {
    const backupData = { records: S.records, vehicles: S.vehicles, vehicleRecs: S.vehicleRecs };
    localStorage.setItem('delivery_local_backup', JSON.stringify(backupData));
    
    // 記錄當下備份時間
    const now = new Date();
    S.settings.lastBackup = `${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    localStorage.setItem(KEYS.settings, JSON.stringify(S.settings));
  }
}

/* ══ 加密版儲存函式 ═══════════════════════════════════════════════ */
async function saveRecords() {
  try {
    await idbSet('records', S.records);
  } catch (e) {
    console.error('IndexedDB 儲存 records 失敗', e);
  }
}
function saveSettings() {
  try {
    localStorage.setItem(KEYS.settings, JSON.stringify(S.settings));
  } catch (e) {
    console.error('儲存 settings 失敗', e);
  }
}
function saveVehicles() {
  try {
    localStorage.setItem(KEYS.vehicles, JSON.stringify(S.vehicles));
  } catch (e) {
    console.error('儲存 vehicles 失敗', e);
  }
}
async function saveVehicleRecs() {
  try {
    await idbSet('vehicleRecs', S.vehicleRecs);
  } catch (e) {
    console.error('IndexedDB 儲存 vehicleRecs 失敗', e);
  }
}
// Platforms 不敏感，保持原本明文儲存
function savePlatforms() {
  localStorage.setItem(KEYS.platforms, JSON.stringify(S.platforms));
}
function savePunch() {
  localStorage.setItem(KEYS.punch, JSON.stringify(S.punch));
}

function goPage(name, force = false) {
  // 🌟 新增：未登入時禁止進入「收入分析」
  /*
  if (name === 'report' && !USER.loggedIn) {
    showLoginRequiredWarning();
    return;
  }
*/
  // 💡 標記 JavaScript 已接管畫面，平滑過渡
  document.documentElement.classList.add('js-ready');

  appendAuthDebugLog(`切換頁面`, `to=${name} from=${S.tab}`);

  if (window.__suppressNavigation && !force) return;

  // 🛡️ 忙碌攔截：除非是 force，否則忙碌時不准切換
  if (!force && isAuthFlowBusy() && name !== S.tab) {
    appendAuthDebugLog(`攔截頁面切換`, `target=${name} reason=auth-flow-active`);
    return;
  }

  S.tab = name;
  localStorage.setItem('delivery_current_tab', name);

  // --- 即時同步權限邏輯 ---
  if (name === 'report' && USER.loggedIn) {
    checkAccountStatus().then((isActive) => {
      if (isActive && S.tab === 'report') {
        renderReportWatermark(); 
      }
    });
  }

  // 切換 Page 顯示狀態
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const targetPage = document.getElementById(`page-${name}`);
  if (targetPage) targetPage.classList.add('active');

  // 💡【關鍵優化】：若進入登入頁 (auth)，導覽列維持顯示「來源頁」(如設定)，圖示絕不變灰失聯！
  let navPg = name;
  if (navPg === 'auth') {
    navPg = localStorage.getItem('auth_origin_tab') || 'settings';
    if (navPg === 'auth') navPg = 'settings';
  }

  // 瞬間更新導覽列圖片 (img2 為亮色圖，img1 為暗色圖)
  document.querySelectorAll('.ni[data-pg]').forEach(n => {
    const isActive = n.dataset.pg === navPg;
    n.classList.toggle('active', isActive);
    const img = n.querySelector('.ni-img'); 
    if (img) img.src = isActive ? n.dataset.img2 : n.dataset.img1;
  });
  
  document.body.setAttribute('data-tab', name);
  updateNavIndicator(navPg); // 對齊指示膠囊

  // 執行對應頁面渲染
  if (name === 'home')     renderHome();
  if (name === 'history')  renderHistory();
  if (name === 'report')   renderReport(); 
  if (name === 'vehicles') renderVehicles(); 
  if (name === 'settings') renderSettings();
}

/* ══ 底部導覽列滑動指示條 (終極防錯亂機制) ══ */
function updateNavIndicator(activePg) {
  // 使用 requestAnimationFrame 等待瀏覽器下一幀繪製完畢
  requestAnimationFrame(() => {
    const indicator = document.getElementById('nav-indicator');
    const activeEl = document.querySelector(`.ni[data-pg="${activePg}"]`);
    const nav = document.getElementById('nav');
    
    if (!indicator || !activeEl || !nav) return;
    
    // 如果寬度為 0 (可能剛啟動還在背景)，不要計算，直接返回避免版面崩潰
    if (nav.offsetWidth === 0 || activeEl.offsetWidth === 0) {
      // 設定一個延遲重試，最多試 5 次
      setTimeout(() => updateNavIndicator(activePg), 100);
      return;
    }
    
    try {
      const navRect = nav.getBoundingClientRect();
      const itemRect = activeEl.getBoundingClientRect();
      
      // 計算圖示中心點，確保背景膠囊完美置中
      const offsetX = itemRect.left - navRect.left + (activeEl.offsetWidth - indicator.offsetWidth) / 2;
      indicator.style.transform = `translateY(-50%) translateX(${offsetX}px)`;
    } catch(e) {
      console.warn("導覽列對齊失敗，忽略此次操作:", e);
    }
  });
}
/* ══ 導覽列點擊事件（點擊瞬間解鎖並同步亮色圖片） ══ */
function _bindNavEvents() {
  document.querySelectorAll('.ni[data-pg]').forEach(el => el.addEventListener('click', () => { 
    const pg = el.dataset.pg;
    
    // 💡 點擊導覽列瞬間，立刻強制解除登入狀態鎖定！
    window.__authFlowLocked = false;
    window.__authTurnstileActive = false;
    localStorage.removeItem('auth_flow_active');
    localStorage.removeItem('auth_last_active');

    if (pg === 'add') {
      if (S.tab !== 'add') openAddPage(); 
    } else {
      goPage(pg, true); // 👈 帶入 true，圖片與指示條 0 延遲瞬間切換！
    }
  }));
}

function switchHomeTab(tab, index) { 
  S.homeSubTab = tab; 
  const tabBg = document.getElementById('home-tab-bg');
  tabBg.style.transform = `translateX(${index * 100}%)`; 
  const rewardSubWrap = document.getElementById('reward-sub-tabs-wrap');
  if (rewardSubWrap) rewardSubWrap.style.display = (tab === 'reward') ? 'block' : 'none';
  if (tab === 'schedule') {
    tabBg.style.background = 'linear-gradient(135deg, #34d399 0%, #14b8a6 45%, #22c55e 70%, #10b981 100%)';
    tabBg.style.boxShadow = '0 3px 3px rgba(20, 184, 166, 0.7)';
  } else if (tab === 'goal') {
    tabBg.style.background = 'linear-gradient(135deg, #6366f1 0%, #3b82f6 40%, #06b6d4 75%, #10b981 100%)';
    tabBg.style.boxShadow = '0 3px 3px rgba(59, 130, 246, 0.6)';
  } else if (tab === 'reward') {
    tabBg.style.background = 'linear-gradient(135deg, #a855f7 0%, #d946ef 40%, #ec4899 75%, #f43f5e 100%)';
    tabBg.style.boxShadow = '0 3px 3px rgba(217, 70, 239, 0.6)';
  } else if (tab === 'ordertime') {
    tabBg.style.background = 'linear-gradient(135deg, #db2777 32%, #2563eb 77%, #0ea5e9 100%)';
    tabBg.style.boxShadow = '0 3px 3px rgba(14, 165, 233, 0.6)';
  }
  document.getElementById('btn-home-schedule').classList.toggle('active', tab==='schedule'); 
  document.getElementById('btn-home-goal').classList.toggle('active', tab==='goal'); 
  document.getElementById('btn-home-reward')?.classList.toggle('active', tab==='reward'); 
  document.getElementById('btn-home-ordertime')?.classList.toggle('active', tab==='ordertime'); 
  renderHome(); 
}

function switchHistTab(tab, index) {
  // 舊版週～年頁籤一律對應到對帳明細列表
  if (['week','biweek','halfmonth','month','year'].includes(tab)) tab = 'reconcile';
  S.histTab = tab;
  S.histPage = 1;
  S.histNavDate = new Date();
  if (tab === 'reconcile' && !S.histReconcilePlat) {
    const first = (S.platforms || []).find(p => p.active);
    S.histReconcilePlat = first ? first.id : null;
  }

  document.getElementById('hist-tab-bg').style.transform = `translateX(${index * 100}%)`;
  document.querySelectorAll('#page-history .slide-btn').forEach((btn, i) => btn.classList.toggle('active', i === index));
  renderHistory();
}
function switchRptTab(tab, index, btnEl) {
  S.rptView = tab;
  document.getElementById('rpt-tab-bg').style.transform = `translateX(${index * 100}%)`;
  document.querySelectorAll('#rpt-tabs .slide-btn').forEach(btn => btn.classList.remove('active'));
  btnEl.classList.add('active');
  
  const subTabsFixed = document.getElementById('net-profit-sub-tabs-fixed');
  
  // 👈 核心修改：切換分頁時，如果不是淨賺頁，就清除那個外框 box 的 ID，下次進入才會重新初始化
  const oldBox = document.getElementById('net-profit-framed-box');
  if (oldBox) oldBox.remove();

  if (tab === 'netProfit') {
    subTabsFixed.style.display = 'block';
  } else {
    subTabsFixed.style.display = 'none';
  }

  ['overview', 'trend', 'compare', 'top3', 'netProfit'].forEach(v => { 
    const el = document.getElementById(`rv-${v}`);
    if (el) el.style.display = (v === S.rptView ? '' : 'none'); 
  }); 
  renderReport(); 
}

/* ══ 替換：車輛頁籤切換 (四色強化漸層風格) ══ */
function switchVehicleTab(tab, index) { 
  const wrapper = document.getElementById('veh-selector-wrapper');
  const container = document.getElementById('veh-selector-container');
  const monthLabel = document.getElementById('veh-month-label');
  const monthNav = monthLabel ? monthLabel.parentElement : null;

  if (wrapper) wrapper.style.display = '';
  if (container) container.style.display = '';
  if (monthNav) monthNav.style.display = 'flex';

  S.vehicleTab = tab;

  // 🌟 [新增]：如果點擊的是「記錄搜尋」主按鈕，強制回到第一個子頁籤
  if (tab === 'search') {
    S.vehSearchTab = 'search'; 
  }

  const tabBg = document.getElementById('veh-tab-bg');
  tabBg.style.transform = `translateX(${index * 100}%)`; 
  
  const currentVeh = S.vehicles.find(x => x.id === S.selVehicleId);
  const isEV = currentVeh && currentVeh.defaultFuel === 'electric';
  
// 👉 採用現代高飽和雙色漸層，確保每個頁籤顏色完全獨立
  const colors = {
    fuel: isEV 
      ? { bg: 'linear-gradient(135deg, #0055ff 0%, #00c6ff 100%)', shadow: 'transparent', textId: 'btn-veh-fuel' } // ⚡ 極光藍
      : { bg: 'linear-gradient(135deg, #931519 0%, #ff1e00 100%)', shadow: 'transparent', textId: 'btn-veh-fuel' }, // 🔥 賽車純紅 (去除黃/橘色，改為深淺紅色交疊)
    maintenance: { bg: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)', shadow: 'transparent', textId: 'btn-veh-maint' }, // 🔧 翡翠綠
    wash: { bg: 'linear-gradient(135deg, #209cff 0%, #57efdb 100%)', shadow: 'transparent', textId: 'btn-veh-wash' }, // 🧽 清水青藍
    yearly: { bg: 'linear-gradient(135deg, #275677 0%, #1a8cff 100%)', shadow: 'transparent', textId: 'btn-veh-yearly' }, // 👑 閃耀純金 (純黃金漸層，與汽油的紅色徹底區分)
    search: { bg: 'linear-gradient(135deg, #a72399 0%, #f76ae9 100%)', shadow: 'transparent', textId: 'btn-veh-search' } // 🔍 霓虹紫
  };

  tabBg.style.background = colors[tab].bg; 
  tabBg.style.boxShadow = `0 4px 10px ${colors[tab].shadow}`;

  ['fuel', 'maintenance', 'wash', 'yearly', 'search'].forEach(t => {
    document.getElementById(colors[t].textId).style.color = (t === tab) ? '#fff' : 'var(--t2)';
    document.getElementById(colors[t].textId).classList.toggle('active', t === tab);
  });
  
  const labelEl = document.getElementById('veh-month-label');
  if (labelEl) {
    labelEl.innerHTML = (tab === 'yearly' || tab === 'search') 
      ? `<span style="color: #9333ea; font-size: 22px;">${S.vehY}</span> 年 <span style="color: #9333ea; font-size: 22px;">全年</span>` 
      : `<span style="color: #9333ea; font-size: 22px;">${S.vehY}</span> 年 <span style="color: #9333ea; font-size: 22px;">${S.vehM}</span> 月`;
  }

  renderVehicleContent(); 
}
/* ══ 1. 共用工具函式與狀態 結束 ══════════════════════════════ */


/* ════════════════════ 2. 首頁 開始 ═══════════════════ */
/* ══ 修正：公告顯示引擎 (相容新舊格式) ══ */
let annShownThisVisit = new Set();
function getFloatingAnnouncementHtml() {
  // 1. 彙整所有可能的來源 (相容舊的單數格式與新的陣列格式)
  let pool = [];
  if (Array.isArray(S.settings.announcements)) {
    pool = [...S.settings.announcements];
  } else if (S.settings.announcement) {
    // 如果還有舊格式資料，自動轉為陣列處理
    pool = [S.settings.announcement];
  }
  
  if (pool.length === 0) return '';

  // 2. 尋找第一則沒看過的
  const unseenAnn = pool.find(ann => {
    if (!ann || !ann.enabled || !ann.content) return false;
    const ver = ann.version;
    
    // 檢查永久封鎖 (勾選了「不再顯示此公告」)
    if (localStorage.getItem('ann_block_' + ver) === 'true') return false;
    
    // 檢查「本次停留首頁期間」是否已關閉過（僅用於公告排隊，離開首頁再回來會重置）
    if (annShownThisVisit.has(ver)) return false;
    
    return true;
  });

  if (!unseenAnn) return '';

  const ann = unseenAnn;
  return `
    <div id="home-announcement-overlay" class="ann-overlay">
      <div id="home-announcement-card" class="ann-card ann-${ann.style}">
        ${ann.style === 'golden-luxury' ? '<div class="inner-border"></div>' : ''}
        <div class="middle-content">
          <div class="ann-title">📢 ${safeText(ann.title)}</div>
          <div class="ann-meta">
              <span class="ann-tag" data-type="date">${safeText(ann.date)}</span>
              <span class="ann-tag" data-type="version">v${safeText(ann.version)}</span>
          </div>
          <div class="ann-body">
            ${safeTextWithBr(ann.content)}
          </div>
          <div id="ann-checkbox" data-checked="false" data-ver="${ann.version}" 
              style="display:flex; align-items:center; gap:8px; cursor:pointer; position:relative; z-index:100; margin-bottom:15px;">
              <div id="ann-cb-box" style="width:25px;height:25px;border:2px solid #fff;border-radius:5px;flex-shrink:0;"></div>
              <span style="font-size:16px; font-weight:750; color: #fff;">不再顯示此公告</span>
          </div>
          <button id="close-ann-btn" data-ver="${ann.version}" class="ann-btn">確認閱讀</button>
        </div>
      </div>
    </div>
  `;
}

/* ══ 公告點擊事件（加強版按鈕特效 + 延遲關閉）══ */
document.addEventListener('click', function(e) {
  const checkboxContainer = e.target.closest('#ann-checkbox');
  const closeBtn = e.target.closest('#close-ann-btn');

  if (checkboxContainer) {
    const box = checkboxContainer;
    const cbBox = document.getElementById('ann-cb-box');
    const nowChecked = !(box.dataset.checked === 'true');
    
    box.dataset.checked = String(nowChecked);
    
    if (nowChecked) {
      cbBox.style.background = '#3b82f6';
      cbBox.style.borderColor = '#3b82f6';
      cbBox.innerHTML = '<span style="color:#fff;font-size:24px;font-weight:900;display:flex;align-items:center;justify-content:center;line-height:24px;text-align:center;">✓</span>';
    } else {
      cbBox.style.background = 'transparent';
      cbBox.style.borderColor = '#fff';
      cbBox.innerHTML = '';
    }
    return;
  }

  /* ══ 修正：點擊公告確認按鈕 (補回 Toast 與動畫延遲) ══ */
  if (closeBtn) {
      const btn = closeBtn;
      const annVer = btn.dataset.ver;
      const box = document.getElementById('ann-checkbox');
      const isChecked = box ? box.dataset.checked === 'true' : false;

      // === 按鈕特效動畫 ===
      btn.style.transition = 'all 1.2s cubic-bezier(0.4, 0, 0.2, 1)';
      btn.style.transform = 'translateY(8px) scale(0.92)';
      btn.style.boxShadow = '0 4px 0 rgba(0,0,0,0.3)';

      setTimeout(() => {
          if (isChecked) {
              // 勾選了：永久不再顯示（存入 localStorage）
              localStorage.setItem('ann_block_' + annVer, 'true');
          }
          
          // 不管有無勾選，本次停留首頁期間都不再重複跳出（僅記憶體暫存，離開首頁再回來會重置）
          annShownThisVisit.add(annVer);

          const ov = document.getElementById('home-announcement-overlay');
          if (ov) ov.remove();

          // 檢查是否有下一個排隊中的公告
          setTimeout(() => checkAndShowAnnouncement(), 300);

          // 💡 [補回] 顯示已閱讀提示
          toast('已閱讀 ✅');
      }, 1300); // 配合您的動畫時間 1.3 秒
  }
});

/* ══ 修正：觸發檢查 (解決動畫秒差導致的封鎖) ══ */
function checkAndShowAnnouncement(ignoreOverlay = false) {
  if (S.tab !== 'home') return;
  if (document.getElementById('home-announcement-overlay')) return;

  // 如果不是強制忽略，且現在有子頁面開著，就跳過
  if (!ignoreOverlay && document.querySelector('.overlay-page.show')) return;

  const annHtml = getFloatingAnnouncementHtml();
  if (annHtml) {
    document.getElementById('app').insertAdjacentHTML('beforeend', annHtml);
  }
}

/* ══ 簡潔版：首頁渲染 (刪除多餘卡片，加入獎勵介面) ══ */
function renderHome() {
  if (shouldBlockAuthSensitiveUi('renderHome')) return;
  const topEl = document.getElementById('home-top-content');
  const botEl = document.getElementById('home-bottom-content');
  const tabBg = document.getElementById('home-tab-bg');
  
  if (!topEl || !botEl) return;

  try {
    if (!S.homeSubTab) S.homeSubTab = 'schedule';
    const records = Array.isArray(S.records) ? S.records : [];
    const platforms = Array.isArray(S.platforms) ? S.platforms : DEFAULT_PLATFORMS.map(p => ({ ...p }));
    let topHtml = '';
  
    // 更新背景滑塊位置 (支援 3 個按鈕)
    if (tabBg) {
      if (S.homeSubTab === 'schedule') tabBg.style.transform = 'translateX(0%)';
      else if (S.homeSubTab === 'ordertime') tabBg.style.transform = 'translateX(100%)';
      else if (S.homeSubTab === 'goal') tabBg.style.transform = 'translateX(200%)';
      else if (S.homeSubTab === 'reward') tabBg.style.transform = 'translateX(300%)';
    }

    // 👇 修復：確保 requestAnimationFrame 有正確的閉合
    requestAnimationFrame(() => {
    try {
      const today = todayStr();
      const dateObj = new Date(today + 'T00:00:00');
      const dow = ['日','一','二','三','四','五','六'][dateObj.getDay() || 0];

      // === 今日概況 Top 區塊 ===
      topHtml = `
        <div style="padding:3px 16px 0;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <div style="font-family:var(--title);font-size:26px;font-weight:700;color:var(--t1);letter-spacing:1.5px;">今日概況</div>

            <div style=" display:flex;align-items:center;font-size:14px;color:var(--t2);font-weight:600;background:var(--sf);padding:3px 12px;border-radius:20px;border:2px solid var(--border);font-family:var(--mono);gap:4px;" >
              <span style="font-size:20px;color:#ff4400;font-weight:900;letter-spacing:1.5px;margin:0 1px 3px 0px;">${dateObj.getFullYear()}</span>年
              <span style="font-size:20px;color:#ff4400;font-weight:900;letter-spacing:1.5px;margin:0 0px 3px 2px;">${dateObj.getMonth()+1}</span>月
              <span style="font-size:20px;color:#ff4400;font-weight:900;letter-spacing:1.5px;margin:0 0px 3px 2px;">${dateObj.getDate()}</span>日
              <span style="border-radius:20px;border:1px solid var(--t3);padding:3px 10px;display:flex;align-items:center;line-height:1;margin-left:5px;"> 星期 
              <span style="font-size:20px;color:var(--text-blue);font-weight:900;margin-left:5px;">${dow}</span>
              </span>
            </div>
          </div>
      `;

      // 打卡狀態卡片
      const activePunch = records.find(r => r.isPunchOnly && !r.punchOut);
      const isPunched = !!activePunch;

      let punchStatusHtml = '';
      if (isPunched) {
        // 取得上線時間戳記並立即計算當前時間差
        const startTime = activePunch.timestamp || new Date(`${activePunch.date}T${activePunch.punchIn}:00`).getTime();
        const initialDiff = Math.max(0, Date.now() - startTime);
        const initialTimerStr = formatDuration(initialDiff); // 👈 瞬間算出的時間字串
        
        punchStatusHtml = `
          <div style="display:flex; flex-direction:row; align-items:center; gap:2px;">
            <span style="color:var(--green);font-size:20px;font-weight:800;letter-spacing:1px;margin-right:3px;">上線中</span>
            <span id="live-punch-timer" style="color:#2563eb;font-family:var(--mono);font-size:18px;font-weight:800;margin-top:1px;border:1px solid #fff200;border-radius:12px;padding:6px 10px;background: #fffeaf;">${initialTimerStr}</span>
          </div>
        `;
        // 啟動每秒心跳
        requestAnimationFrame(() => startPunchClock(startTime));
      } else {
        punchStatusHtml = `<span style="color:var(--t3); font-size:20px; font-weight:800;">離線</span>`;
      }

      topHtml += `
        <div class="punch-card-new" style="margin:4px 0 6px 0; padding:5px 12px; height:auto;">
          <div class="punch-status-left">
            <div class="punch-dot-new ${isPunched ? 'online' : ''}" style="width:20px; height:20px;"></div>
            ${punchStatusHtml}
          </div>
          <button class="punch-btn-right ${isPunched ? 'btn-go-offline' : 'btn-go-online'}" 
                  onclick="${isPunched ? 'punchOut()' : 'punchIn()'}" 
                  style="height:35px; font-size:20px; padding:7px 14px;">
            ${isPunched ? '⏹ 下線' : '▶ 上線'}
          </button>
        </div>
      `;

      topHtml += `</div>`;
      topEl.innerHTML = topHtml;

      // 底部內容 (平台排程 / 目標進度 / 獎勵進度)
      let bottomHtml = '<div style="padding:0 8px 100px;">';
      const activePlatforms = platforms.filter(p => p.active);
      
      if (S.homeSubTab === 'schedule') {
        if (activePlatforms.length === 0) {
          bottomHtml += `<div class="empty-tip">請先至「設定」頁，啟用平台</div>`;
        } else {
          bottomHtml += `<div style="display:flex; flex-direction:column; gap:11px;">`;
          bottomHtml += `
            <div style="background: linear-gradient(to bottom, #ffffff, #f8fafc); border-radius: 16px; padding: 4px 10px; margin-bottom: -6px; border: 2px solid #cbd5e1; box-shadow: 0 6px 16px rgba(0,0,0,0.06); display: flex; flex-direction: column; align-items: center; position: relative; overflow: hidden;">
              <!-- 頂部四色漸層飾條 -->
              <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(to right, #16a34a, #ea580c, #0284c7, #475569);"></div>
              
              <div style="font-size: 13px; font-weight: 750; color: #334155; margin-bottom: 2px; letter-spacing: 1px;">💡 狀態標籤圖例</div>
              
              <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;">
                <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 900; padding: 5px 10px; border-radius: 8px; background: #dcfce7; color: #15803d; border: 1.5px solid #86efac;">
                  <span style="font-size: 13px;">🔥</span> 今天
                </span>
                <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 900; padding: 5px 10px; border-radius: 8px; background: #ffedd5; color: #c2410c; border: 1.5px solid #fdba74;">
                  <span style="font-size: 13px;">⚡</span> 明天
                </span>
                <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 900; padding: 5px 10px; border-radius: 8px; background: #e0f2fe; color: #0369a1; border: 1.5px solid #7dd3fc;">
                  <span style="font-size: 13px;">🔜</span> 近 3 天
                </span>
                <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 900; padding: 5px 10px; border-radius: 8px; background: #f1f5f9; color: #334155; border: 1.5px solid #cbd5e1;">
                  <span style="font-size: 13px;">⏳</span> 4 天以上
                </span>
              </div>
            </div>`;

          activePlatforms.forEach(p => {
            const events = calcNextDates(p.id); 
            if (!events || events.length === 0) return;
            bottomHtml += `
              <div style="position: relative; overflow: hidden; border: 3px solid ${p.color}; background: ${p.color}10; border-radius: 25px; padding: 42px 10px 12px 10px;">
                <div style="position: absolute; top: -2px; left: -2px; display:inline-flex; background: ${p.color}10; padding: 0px; border-radius: 30px; border: 4px solid ${p.color};">
                  <div style="background: linear-gradient(180deg, ${p.color}40 0%, transparent 50%, ${p.color}40 100%), ${p.color}95; border: 3px solid rgba(255, 255, 255, 0.9); border-radius: 30px; padding: 0px 13px; display: flex; align-items: center; justify-content: center;">
                    <span style="color: #ffffff; font-size: 20px; font-weight: 700; line-height: 30px; letter-spacing: 1px;">${safeText(p.name)}</span>
                  </div>
                </div>
                <div style="display:flex; gap:8px;">
                  ${events.map(ev => {
                    let titleColor = '#475569'; 
                    if (ev.name.includes('結算') || ev.name.includes('取單')) titleColor = '#e61f1f'; 
                    else if (ev.name.includes('明細')) titleColor = '#ea580c'; 
                    else if (ev.name.includes('發薪')) titleColor = '#0ea5e9'; 
                    
                    let diffBg = '#f1f5f9', diffColor = '#334155', diffIcon = '⏳', diffText = safeText(ev.diffStr);
                    let cardBorder = '#ffffff'; // 預設白色外框
                    let tagBorder = '#cbd5e1';  // 預設灰色標籤框
                    let isToday = false;        // 判斷是否啟動跑馬燈
                    let pulseClass = '';

                    if (ev.diff === 0) { 
                      diffBg = '#dcfce7'; diffColor = '#15803d'; diffIcon = '🔥'; diffText = '今天'; 
                      tagBorder = '#86efac';
                      isToday = true; // 👈 啟動跑馬燈
                    } 
                    else if (ev.diff === 1) { 
                      diffBg = '#ffedd5'; diffColor = '#c2410c'; diffIcon = '⚡'; 
                      cardBorder = '#fdba74'; tagBorder = '#fdba74';
                      pulseClass = 'pulse-tomorrow'; // 明日
                    } 
                    else if (ev.diff <= 3) { 
                      diffBg = '#e0f2fe'; diffColor = '#0369a1'; diffIcon = '🔜'; 
                      cardBorder = '#7dd3fc'; tagBorder = '#7dd3fc';
                      pulseClass = 'pulse-near';    // 近3天
                    }

                    // 依據是否為今天，切換不同的外框樣式
                    let cardClass = isToday ? 'marquee-today-card' : '';
                    let cardStyle = isToday 
                      ? `flex:1; text-align:center; display:flex; flex-direction:column; margin-top:10px; transition:0.3s;`
                      : `flex:1; background:#ffffff; border-radius:25px; text-align:center; border:2px solid ${cardBorder}; display:flex; flex-direction:column; overflow:hidden; margin-top:10px; transition:0.3s; box-shadow:0 2px 6px rgba(0,0,0,0.02);`;
                      
                    // 配合跑馬燈邊框，內部標題區塊需加入微小圓角，才不會蓋掉邊緣的光線
                    let headerRadius = isToday ? 'border-radius:25px 25px 0 0;' : '';

                    return `
                      <div class="${cardClass} ${pulseClass}" style="${cardStyle}">
                        <div style="background:${titleColor}25; padding:6px 2px; border-bottom:1.5px dashed ${titleColor}30; ${headerRadius} position:relative; z-index:1;">
                          <span style="font-size:16px; color:${titleColor}; font-weight:750;">${safeText(ev.name)}</span>
                        </div>
                        <div style="padding:10px 2px; display:flex; flex-direction:column; justify-content:center; align-items:center; flex:1; position:relative; z-index:1;">
                          <span style="font-family:var(--mono); font-size:17px; font-weight:900; color:var(--t1); line-height:1;">${safeText(ev.dateStr)}</span>
                          <div style="margin-top:8px;">
                            <span style="display:inline-flex; align-items:center; gap:2px; font-size:11px; font-weight:900; padding:4px 6px; border-radius:8px; background:${diffBg}; color:${diffColor}; border:1.5px solid ${tagBorder};">
                              <span style="font-size:10px;">${diffIcon}</span> ${diffText}
                            </span>
                          </div>
                        </div>
                      </div>`;
                  }).join('')}
                </div>
              </div>`;
          });
          bottomHtml += `</div>`;
        }
      } else if (S.homeSubTab === 'goal') {
        const goals = S.settings.goals || {};
        const weekly = pf(goals.weekly); const monthly = pf(goals.monthly); const yearly = pf(goals.yearly);
        if (weekly > 0 || monthly > 0 || yearly > 0) {
          // 👇 將三大目標包裝進一個大白框，加上標題與陰影
          bottomHtml += `
            <div style="background:#ffffff; border-radius:24px; padding:16px 14px; border:2px solid #e2e8f0; box-shadow:0 8px 24px rgba(0,0,0,0.03);">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px; padding:0 4px;">
                <span style="font-size:18px;">🎯</span>
                <span style="font-size:15px; font-weight:900; color:var(--t1); letter-spacing:0.5px;">收入目標進度</span>
              </div>
              <div style="display:flex; flex-direction:column; gap:12px;">`; 
          
          if (weekly > 0) {
            const wDate = new Date(dateObj); const wDay = wDate.getDay() || 7; wDate.setDate(wDate.getDate() - wDay + 1); let weekTotal = 0;
            for(let i=0; i<7; i++) { const dStr = `${wDate.getFullYear()}-${pad(wDate.getMonth()+1)}-${pad(wDate.getDate())}`; weekTotal += getDayRecs(dStr).reduce((s,r)=>s+recTotal(r),0); wDate.setDate(wDate.getDate() + 1); }
            const wPct = Math.min(100, Math.round(weekTotal/weekly*100)); const wRemain = Math.max(0, weekly-weekTotal); 
            const wColor = wPct >= 100 ? '#10b981' : '#3b82f6';
            
            // 內部卡片稍微調整圓角與外框，使其嵌在大框中更好看
            bottomHtml += `
              <div style="background: linear-gradient(135deg, #eff6ff 0%, #ffffff 100%); border: 1.5px solid #bfdbfe; border-radius: 16px; padding: 14px; position: relative; overflow: hidden;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <div style="width:32px; height:32px; border-radius:10px; background:#dbeafe; display:flex; align-items:center; justify-content:center; font-size:16px;">🏃</div>
                    <div>
                      <div style="font-size:14px;font-weight:900;color:#1e3a8a;">本週目標</div>
                      <div style="font-size:12px;color:#000000;font-weight:650;letter-spacing:1px;">剩餘<span style="font-weight:900;color:#60a5fa;font-size:17px;"> ${7 - wDay} </span>天</div>
                    </div> 
                  </div>
                  <span style="font-family:var(--mono);font-size:24px;font-weight:900;color:${wColor};">${wPct}<span style="font-size:14px;"> %</span></span>
                </div>
                <div style="height:12px; background:#e2e8f0; border-radius:6px; overflow:hidden; margin-bottom:8px;">
                  <div style="height:100%; width:${wPct}%; background:linear-gradient(90deg, ${wColor}10 0%, ${wColor} 100%); border-radius:6px; transition:width 0.4s ease;"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:650;font-family:var(--mono);">
                  <span style="color:#3b82f6;">$ <span style="color:#000000;font-size:12px;">${fmt(weekTotal)}</span><span style="color:#3b82f6;font-weight:800;font-size:14px;"> / ${fmt(weekly)}</span></span>
                  <span style="color:${wRemain > 0 ? '#64748b' : '#10b981'};">${wRemain>0 ? `還差 $ <span style="font-weight:800;color:#ff0000;font-size:14px;">${fmt(wRemain)}</span>` : '🎉 已達標！'}</span>
                </div>
              </div>`;
          }
          
          if (monthly > 0) {
            const monthRecs = getMonthRecs(dateObj.getFullYear(), dateObj.getMonth()+1); const monthTotal = monthRecs.reduce((s,r)=>s+recTotal(r), 0);
            const mPct = Math.min(100, Math.round(monthTotal/monthly*100)); const mRemain = Math.max(0, monthly-monthTotal); 
            const mColor = mPct >= 100 ? '#10b981' : '#a855f7';
            
            bottomHtml += `
              <div style="background: linear-gradient(135deg, #f3e8ff 0%, #ffffff 100%); border: 1.5px solid #e9d5ff; border-radius: 16px; padding: 14px; position: relative; overflow: hidden;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <div style="width:32px; height:32px; border-radius:10px; background:#e9d5ff; display:flex; align-items:center; justify-content:center; font-size:16px;">🔥</div>
                    <div>
                      <div style="font-size:14px;font-weight:900;color:#581c87;">本月目標</div>
                      <div style="font-size:12px;color:#000000;font-weight:650;letter-spacing:1px;">剩餘<span style="font-weight:900;color:#c084fc;font-size:17px;"> ${new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).getDate() - dateObj.getDate()} </span>天</div>
                    </div> 
                  </div>
                  <span style="font-family:var(--mono);font-size:24px;font-weight:900;color:${mColor};">${mPct}<span style="font-size:14px;"> %</span></span>
                </div>
                <div style="height:12px; background:#e2e8f0; border-radius:6px; overflow:hidden; margin-bottom:8px;">
                  <div style="height:100%; width:${mPct}%; background:linear-gradient(90deg, ${mColor}10 0%, ${mColor} 100%); border-radius:6px; transition:width 0.4s ease;"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:650;font-family:var(--mono);">
                  <span style="color:#a855f7;">$ <span style="color:#000000;font-size:12px;">${fmt(monthTotal)}</span><span style="color:#a855f7;font-weight:800;font-size:14px;"> / ${fmt(monthly)}</span></span>
                  <span style="color:${mRemain > 0 ? '#64748b' : '#10b981'};">${mRemain>0 ? `還差 $ <span style="font-weight:800;color:#ff0000;font-size:14px;">${fmt(mRemain)}</span>` : '🎉 已達標！'}</span>
                </div>
              </div>`;
          }
          
          if (yearly > 0) {
            const yearRecs = S.records.filter(r => r.date.startsWith(`${dateObj.getFullYear()}-`)); const yearTotal = yearRecs.reduce((s,r)=>s+recTotal(r), 0);
            const yPct = Math.min(100, Math.round(yearTotal/yearly*100)); const yRemain = Math.max(0, yearly-yearTotal); 
            const yColor = yPct >= 100 ? '#10b981' : '#0d9488';
            
            bottomHtml += `
              <div style="background: linear-gradient(135deg, #f0fdfa 0%, #ffffff 100%); border: 1.5px solid #99f6e4; border-radius: 16px; padding: 14px; position: relative; overflow: hidden;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <div style="width:32px; height:32px; border-radius:10px; background:#ccfbf1; display:flex; align-items:center; justify-content:center; font-size:16px;">👑</div>
                    <div>
                      <div style="font-size:14px;font-weight:900;color:#134e4a;">本年目標</div>
                      <div style="font-size:12px;color:#000000;font-weight:650;letter-spacing:1px;">剩餘<span style="font-weight:900;color:#2dd4bf;font-size:17px;"> ${Math.ceil((new Date(dateObj.getFullYear(), 11, 31) - dateObj) / 86400000)} </span>天</div>
                    </div>
                  </div>
                  <span style="font-family:var(--mono);font-size:24px;font-weight:900;color:${yColor};">${yPct}<span style="font-size:14px;"> %</span></span>
                </div>
                <div style="height:12px; background:#e2e8f0; border-radius:6px; overflow:hidden; margin-bottom:8px;">
                  <div style="height:100%; width:${yPct}%; background:linear-gradient(90deg, ${yColor}10 0%, ${yColor} 100%); border-radius:6px; transition:width 0.4s ease;"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:650;font-family:var(--mono);">
                  <span style="color:#0d9488;">$ <span style="color:#000000;font-size:12px;">${fmt(yearTotal)}</span><span style="color:#0d9488;font-weight:800;font-size:14px;"> / ${fmt(yearly)}</span></span>
                  <span style="color:${yRemain > 0 ? '#64748b' : '#10b981'};">${yRemain>0 ? `還差 $ <span style="font-weight:800;color:#ff0000;font-size:14px;">${fmt(yRemain)}</span>` : '🎉 已達標！'}</span>
                </div>
              </div>`;
          }
          bottomHtml += `</div></div>`; // 結束大白框
        } else {
          bottomHtml += `
            <div style="background:#ffffff; border-radius:24px; padding:32px 20px; border:2px solid #e2e8f0; box-shadow:0 8px 24px rgba(0,0,0,0.03); text-align:center;">
              <div style="font-size:32px; margin-bottom:12px;">🎯</div>
              <div style="font-size:15px; font-weight:800; color:var(--t1); margin-bottom:6px;">尚未設定收入目標</div>
              <div style="font-size:13px; color:var(--t3); font-weight:600; margin-bottom:16px;">設定目標，能幫助您更專注於跑單進度</div>
              <button onclick="goPage('settings'); setTimeout(openGoalSettings, 300);" style="background:var(--acc); color:#fff; border:none; border-radius:12px; padding:10px 20px; font-size:14px; font-weight:800; box-shadow:0 4px 12px rgba(255,107,53,0.3); cursor:pointer;">前往設定</button>
            </div>
          `;
        }
      } else if (S.homeSubTab === 'reward') {
        bottomHtml = getRewardsHtml();
      } else if (S.homeSubTab === 'ordertime') {
        bottomHtml = getOrderTimerHtml();
      }

      // 👇 在 renderHome 結尾正確關閉 requestAnimationFrame
      botEl.innerHTML = bottomHtml;

      // 強制顯示公告（防止被蓋住）
      setTimeout(() => {
        if (!document.getElementById('home-announcement-overlay')) {
          const annHtml = getFloatingAnnouncementHtml();
          if (annHtml) document.getElementById('app').insertAdjacentHTML('beforeend', annHtml);
        }
      }, 400);

    } catch(e) {
      console.error("renderHome 錯誤:", e);
      botEl.innerHTML = `<div class="empty-tip">載入失敗，請重新整理</div>`;
    }
  });
  } catch (err) {
    appendAuthDebugLog('⚠️ 首頁渲染失敗', err?.message || String(err), 'error');
    topEl.innerHTML = `<div style="padding:24px 16px; text-align:center; color:var(--t2);">⚠️ 首頁暫時無法載入，請稍後再試</div>`;
    botEl.innerHTML = '';
  }

  if (S.homeSubTab === 'ordertime') {
    startOrderTimerTicker(); // 確保一切換到這個分頁計時器就開始跳
  }
}

/* ══ 打卡輸入里程介面 ══ */
// 全域變數，用來存放裁剪實例
let mileageCropper = null;

function getMileageCaptureHtml(type) {
  const hasKey = !!S.settings.ocrKey;
  
  return `
    <div id="mileage-modal" style="padding:0 16px 25px; text-align:center;">
      <div style="display:flex; align-items:center; gap:8px; margin:0 0 2px 10px;">
        <div style="width:7px; height:32px; background:#cf39f0; border-radius:4px;"></div>
        <span style="background:rgba(207, 57, 240, 0.2);font-size:22px;font-weight:800;color:#000;letter-spacing:1px;padding:3px 14px;border-radius:8px;margin-left:-15.5px;">&nbsp;照片辨識功能</span>
      </div>
      
      <!-- 裁剪容器 -->
      <div style="width:100%; height:300px; background:#000; border-radius:16px; margin-bottom:3px; overflow:hidden; position:relative;">
        <img id="ocr-crop-target" style="max-width:100%; display:block;">
        <div id="ocr-init-tip" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:14px; background:rgba(0,0,0,0.5);">
          請先拍照，或從相簿選擇照片
        </div>
      </div>
      <p style="font-size:13px;color:var(--text-blue);font-weight:750;margin-bottom:6px;">💡 提示：範圍必須包含「數字」與「km」單位</p>
      <p style="font-size:15px;color:var(--red);font-weight:650;margin-bottom:6px;">💡 可移動藍框位置，增加辨識成功率</p>
      <div style="display:flex; gap:8px; margin-bottom:10px;">
        <button onclick="document.getElementById('ocr-file-input').click()" style="flex:1;padding:12px;border-radius:12px;background:#fff;color:var(--blue);border:2px solid var(--blue);font-size:15px;font-weight:800;">📸 拍照/選圖</button>
        <button id="start-ocr-btn" onclick="performCropAndOCR()" disabled style="flex:1;padding:12px;border-radius:12px;background:rgba(34,197,94,0.4);color: #000;border:2px solid var(--green);font-size:15px;font-weight:700;">🔍 裁剪並辨識</button>
      </div>

      <div style="background: #dde1e5; padding:15px 5px; border-radius:16px; margin-bottom:10px;">
        <label style="font-size:16px;font-weight:800;color:var(--t2);display:block;margin-bottom:8px;">確認辨識出的數字(可修改)，<span style="background:#fff;color:var(--red);font-size:16px;font-weight:750;border-radius:16px;padding:3px 7px;">可直接手動輸入</span></label>
        <div style="position:relative;">
          <input type="number" id="manual-km" class="manual-km-input" placeholder="辨識結果..." inputmode="numeric" style="width:100%;padding:12px;border-radius:12px;border:2px solid #cbd5e1;font-family:var(--mono);font-weight:900;font-size:22px;text-align:center;color:var(--text-blue);letter-spacing:1px;">
          <span style="position:absolute;right:15px;top:50%;transform:translateY(-50%);font-size:15px;font-weight:800;color:var(--t3);letter-spacing:0.5px;">km</span>
        </div>
      </div>

      <input type="file" id="ocr-file-input" accept="image/*" style="display:none;" onchange="initMileageCropper(this)">
      <button id="confirm-mileage-btn" class="btn-acc" style="width:100%;padding:16px;background: rgba(255, 107, 53, 0.4);color: #0759c4;border-radius:16px;border:3px solid #FF6B35;font-size:24px;font-weight:750;">確認里程，並打卡 ✅</button>
    </div>
  `;
}
// A. 當選取檔案後，初始化裁剪工具
window.initMileageCropper = function(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const targetImg = document.getElementById('ocr-crop-target');
  const tip = document.getElementById('ocr-init-tip');
  const ocrBtn = document.getElementById('start-ocr-btn');

  // 清除舊的裁剪實例
  if (mileageCropper) {
    mileageCropper.destroy();
  }

  const url = URL.createObjectURL(file);
  targetImg.src = url;
  if(tip) tip.style.display = 'none';

  // 初始化 Cropper.js
  mileageCropper = new Cropper(targetImg, {
    viewMode: 1,
    dragMode: 'none',
    zoomable: false,
    autoCropArea: 0.8,
    restore: false,
    guides: true,
    center: true,
    highlight: false,
    cropBoxMovable: true,
    cropBoxResizable: true,
    toggleDragModeOnDblclick: false,
    // 🌟 [新增/修改] 設定初始長寬比 (5:1 代表寬5, 高1，非常適合一行數字)
    aspectRatio: 6 / 5, 
    // 🌟 [新增] 設定初始裁剪框佔圖片的比例 (0.7 代表佔圖片寬度的 70%)
    autoCropArea: 0.7, 
  });

  ocrBtn.disabled = false;
  ocrBtn.style.opacity = '1';
};
// B. 執行裁剪並送往雲端辨識
window.performCropAndOCR = async function() {
  if (!mileageCropper) return;

  // 🌟 [新增]：檢查 API Key 是否存在
  if (!S.settings.ocrKey) {
    customConfirm(`
      <div style="font-size:40px; margin-bottom:12px;">📸</div>
      <div style="font-size:18px; font-weight:900; color:var(--red); margin-bottom:10px;">尚未設定辨識金鑰</div>
      <div style="font-size:14px; color:var(--t2); line-height:1.6;">
        使用「自動里程辨識」需要先申請，並設定免費的 OCR API Key。<br>是否立即前往設定頁面？
      </div>
    `).then(ok => {
      if (ok) {
        // 先關閉目前的輸入里程彈窗
        closeOverlay('sub-page'); 
        // 跳轉到設定頁並開啟 OCR 設定
        goPage('settings');
        setTimeout(() => openOCRSettings(), 300);
      }
    });
    return;
  }

  // 1. 取得裁剪範圍的畫布
  const canvas = mileageCropper.getCroppedCanvas({ maxWidth: 1000 });
  const ctx = canvas.getContext('2d');

  // 🌟 [新增] 影像增強技術：讓文字更黑、背景更白
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    // 轉灰階公式
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
    // 簡單的對比增強（低於 128 變黑，高於 128 變白）
    const threshold = avg < 128 ? avg * 0.8 : Math.min(255, avg * 1.2);
    data[i] = data[i + 1] = data[i + 2] = threshold;
  }
  ctx.putImageData(imageData, 0, 0);

  const loading = document.createElement('div');
  loading.style.cssText = "position:absolute; inset:0; background:rgba(255,255,255,0.8); display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:100;";
  loading.innerHTML = '<div class="spin"></div><div style="margin-top:10px; font-weight:800;">辨識中...</div>';
  document.getElementById('mileage-modal').appendChild(loading);

  try {
    // 2. 轉為 Base64
    const base64Image = canvas.toDataURL('image/jpeg', 0.8);

    const formData = new FormData();
    formData.append("base64Image", base64Image);
    formData.append("language", "eng");
    formData.append("filetype", "JPG");

    // 👈 [關鍵新增] 指定使用 Engine 2
    formData.append("OCREngine", "2");

    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { "apikey": S.settings.ocrKey },
      body: formData
    });

    const result = await response.json();

    if (result.ParsedResults && result.ParsedResults.length > 0) {
        let detectedText = result.ParsedResults[0].ParsedText;
        
        // 1. 先將整段文字按「換行符號」拆解成陣列 (處理不同行的問題)
        let lines = detectedText.split(/\r?\n/);
        let foundMileage = null;

        // 2. 逐行掃描
        for (let line of lines) {
            let normalizedLine = line.toLowerCase().trim();
            if (!normalizedLine) continue;

            // 3. 在「這一行」內，只縮緊「數字與數字」或「數字與 km」之間的空格
            // 這樣可以解決 7073 1 km 的問題，但不會抓到上一行的時間
            let tightenedLine = normalizedLine.replace(/(\d)\s+(?=\d|km|k\s*m)/g, '$1');

            // 4. 正則表達式：尋找這行裡面接著 km 的數字
            // k[mnr\.]? : 容錯處理，有時 km 會被辨識成 kn, kr, km. 或 km
            const kmRegex = /(\d+)\s*k[mnr\.]?/;
            const match = tightenedLine.match(kmRegex);

            if (match && match[1]) {
                foundMileage = match[1];
                break; // 只要找到帶有 km 的那一行，就停止掃描其他行
            }
        }

        // 5. 輸出結果
        if (foundMileage) {
            document.getElementById('manual-km').value = foundMileage;
            toast('已排除時間，精確抓取里程 ✅');
        } else {
            // 備份方案：如果所有行都沒看到 km，才抓取全圖最長數字
            const allTightened = detectedText.replace(/(\d)\s+(?=\d)/g, '$1');
            const backupNumbers = allTightened.match(/\d+/g);
            if (backupNumbers) {
                const longest = backupNumbers.sort((a,b) => b.length - a.length)[0];
                document.getElementById('manual-km').value = longest;
                toast('⚠️ 未偵測到單位，擷取最長數字');
            } else {
                toast('⚠️ 辨識失敗，請調整範圍');
            }
        }
    }
  } catch (err) {
    toast('❌ 辨識失敗');
  } finally {
    loading.remove();
  }
};
/* ══ 修正：上線打卡後跳轉到當日記錄列表 ══ */
async function punchIn() {
  const active = S.records.find(r => r.isPunchOnly && r.punchOut === '');
  if (active) { toast('⚠️ 已經打卡，正在線上中囉！'); return; }

  document.getElementById('sub-title').textContent = '🚀 上線打卡';
  document.getElementById('sub-body').innerHTML = getMileageCaptureHtml('in');
  openOverlay('sub-page');

  document.getElementById('confirm-mileage-btn').onclick = async () => {
    const km = pf(document.getElementById('manual-km').value);
    if (km <= 0) { toast('⚠️ 請輸入：起始里程'); return; }

    const d = new Date();
    const rec = {
      id: newId(),
      date: todayStr(d),
      time: nowTime(),
      isPunchOnly: true,
      punchIn: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      punchOut: '',
      hours: 0,
      startKm: km,
      timestamp: d.getTime(),
      mileage: 0,
      note: ''
    };

    S.records.push(rec);
    await saveRecords();

    // 👈 [核心 1] 更新首頁按鈕顏色 (確保下次回來是紅色的)
    renderHome(); 

    // 👈 [核心 2] 設定跳轉目標 (這就是你問的舊代碼，必須留著)
    S.histTab = 'day';
    S.selDate = rec.date;
    const [y, m] = rec.date.split('-');
    S.calY = parseInt(y);
    S.calM = parseInt(m);

    closeOverlay('sub-page');
    if (mileageCropper) {
      mileageCropper.destroy();
      mileageCropper = null;
    }
    toast('▶ 已上線，起始里程：' + km + ' km');

    // 👈 [核心 3] 不再跳轉，直接保持在目前頁面並更新首頁
    renderHome();
    appendAuthDebugLog('打卡完成', 'punchIn 不進行頁面切換', 'info');
  };
}
/* ══ 修正：下線打卡後跳轉到當日記錄列表 ══ */
async function punchOut() {
  const activeRec = S.records.find(r => r.isPunchOnly && r.punchOut === '');
  if (!activeRec) return;

  document.getElementById('sub-title').textContent = '🏁 下線打卡';
  document.getElementById('sub-body').innerHTML = getMileageCaptureHtml('out');
  openOverlay('sub-page');

    document.getElementById('confirm-mileage-btn').onclick = async () => {
    const endKm = pf(document.getElementById('manual-km').value);
    if (endKm <= 0) {
      toast('⚠️ 請輸入終點里程');
      return;
    }
    if (endKm <= activeRec.startKm) {
      toast(`⚠️ 「結束里程」應大於「起始里程」 (${activeRec.startKm})`);
      return;
    }

    const diffKm = endKm - activeRec.startKm;

    // ── 新增：終點里程確認（取消 = 回去修改）──
    const ok = await customConfirm(`
      <div style="text-align:center; padding:6px 4px;">
        <div style="font-size:36px; margin-bottom:8px;">📍</div>
        <div style="font-size:22px; font-weight:800; color:var(--t1); margin-bottom:12px;">請確認「終點里程」</div>
        <div style="background:#f8fafc; border:2px solid #e2e8f0; border-radius:16px; padding:14px 16px; text-align:left;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:15px; font-weight:700; color: #ff0051;">終點里程：</span>
            <span style="font-family:var(--mono); font-size:20px; font-weight:800; color: #ec1414;">${fmt(endKm)} <span style="font-size:13px;letter-spacing:0.5px;">km</span></span>
          </div>
        </div>
        <div style="font-size:13px; font-weight:700; color: #304b71; margin-top:12px; line-height:1.5;">
          若數字有誤，請按「取消」返回修改
        </div>
      </div>
    `);

    // 按取消 → 不寫入、不關閉，留在里程輸入畫面
    if (!ok) return;

    // ── 以下才真正結算寫入 ──
    const now = new Date();
    const startMs = activeRec.timestamp || new Date(`${activeRec.date}T${activeRec.punchIn}:00`).getTime();

    activeRec.punchOut = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    activeRec.hours = (now.getTime() - startMs) / 3600000;
    activeRec.endKm = endKm;
    activeRec.mileage = diffKm;

    await saveRecords();
    renderHome();

    S.histTab = 'day';
    S.selDate = activeRec.date;
    const [y, m] = activeRec.date.split('-');
    S.calY = parseInt(y);
    S.calM = parseInt(m);

    closeOverlay('sub-page');
    if (mileageCropper) {
      mileageCropper.destroy();
      mileageCropper = null;
    }

    // 結算完成漂浮框（若已有 showPunchOutResultBox 就用它）
    if (typeof showPunchOutResultBox === 'function') {
      showPunchOutResultBox({
        punchIn: activeRec.punchIn || '',
        punchOut: activeRec.punchOut || '',
        hours: activeRec.hours || 0,
        startKm: activeRec.startKm,
        endKm: endKm,
        mileage: diffKm
      });
    } else {
      toast('已完成結算 ✅');
    }

    renderHome();
    appendAuthDebugLog('打卡完成', 'punchOut 不進行頁面切換', 'info');
    renderHistory();
  };
}

/** 下線結算完成漂浮框（風格對齊 showBackupResultBox） */
function showPunchOutResultBox(info) {
  const old = document.getElementById('punchout-result-overlay');
  if (old) old.remove();

  const hoursText = (typeof fmtHours === 'function')
    ? fmtHours(info.hours)
    : `${Number(info.hours || 0).toFixed(2)} h`;
  const milText = Math.round(Number(info.mileage || 0));

  const ov = document.createElement('div');
  ov.id = 'punchout-result-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:999998;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,0.45);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity 0.25s ease;';

    ov.innerHTML = `
    <div style="background:#ffffff;border-radius:24px;width:100%;max-width:340px;box-shadow:0 20px 50px rgba(0,0,0,0.2);overflow:hidden;transform:translate3d(0,16px,0);transition:transform 0.3s cubic-bezier(0.175,0.885,0.32,1.275);box-sizing:border-box;">
      <div style="background:linear-gradient(135deg,#10b981 0%,#059669 100%);padding:8px 20px 18px;text-align:center;">
        <div style="font-size:36px;margin-bottom:6px;">🏁</div>
        <div style="font-size:28px;font-weight:850;color:#fff;letter-spacing:1.5px;">下線結算完成</div>
      </div>

      <div style="padding:18px 20px 8px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box;">
        <!-- 大框：時間 -->
        <div style="border:3px solid #bfdbfe;border-radius:16px;padding:5px 0 0;background:#f8fbff;">
          <div style="font-size:18px;font-weight:800;color:#1d4ed8;margin-bottom:3px;letter-spacing:1px;padding:0 10px;">⏱️ 時間</div>
          <div style="display:flex;flex-direction:column;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background: #e7fbff;border-radius:12px;border:1px solid #99e4ff;margin:0 10px 20px 10px;">
              <span style="font-size:13px;font-weight:700;color:#005eff;"><span style="color:#14a22a;">上線</span> → <span style="color:#e11919;">下線</span></span>
              <span style="font-family:var(--mono);font-size:14px;font-weight:900;color: #005eff;"><span style="color:#14a22a;">${safeText(info.punchIn)}</span> → <span style="color:#e11919;">${safeText(info.punchOut)}</span></span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 30px;background:#eff6ff;border-radius:0 0 12px 12px;border-top:3px solid #bfdbfe;">
              <span style="font-size:20px;font-weight:750;color:#1d4ed8;">工時</span>
              <span style="font-family:var(--mono);font-size:22px;font-weight:800;color:#1d4ed8;">${hoursText}</span>
            </div>
          </div>
        </div>

        <!-- 大框：里程 -->
        <div style="border:3px solid #a5f3fc;border-radius:16px;padding:5px 0 0;background:#f0fdff;">
          <div style="font-size:18px;font-weight:800;color:#1b86a4;margin-bottom:3px;letter-spacing:1px;padding:0 10px;">🚗 里程</div>
            <div style="display:flex;flex-direction:column;margin:0 10px 20px 10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 30px;background:#f0fdf4;border-radius:20px;border:1px solid #bbf7d0;letter-spacing:1px;margin-bottom:1px;">
                <span style="font-size:15px;font-weight:700;color:#14a22a;">起點里程</span>
                <span style="font-family:var(--mono);font-size:16px;font-weight:900;color:#14a22a;">${fmt(Math.round(info.startKm))} <span style="font-size:11px;font-weight:700;">km</span></span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 30px;background:#fef2f2;border-radius:20px;border:1px solid #fecdd3;letter-spacing:1px;">
                <span style="font-size:15px;font-weight:700;color:#e11919;">終點里程</span>
                <span style="font-family:var(--mono);font-size:16px;font-weight:900;color:#e11919;">${fmt(Math.round(info.endKm))} <span style="font-size:11px;font-weight:700;">km</span></span>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 30px;background:#ecfeff;border-radius:0 0 12px 12px;border-top:3px solid #a5f3fc;letter-spacing:0.7px;">
              <span style="font-size:20px;font-weight:750;color: #006683;">本次行駛</span>
              <span style="font-family:var(--mono);font-size:22px;font-weight:800;color: #006683;">${milText} <span style="font-size:13px;font-weight:700;">km</span></span>
            </div>
        </div>
      </div>
      <div style="padding:12px 20px 20px;box-sizing:border-box;width:100%;">
        <button id="punchout-result-ok" style="width:100%;box-sizing:border-box;padding:14px;border:none;border-radius:14px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;font-size:22px;font-weight:800;cursor:pointer;letter-spacing:1.5px;">知道了</button>
      </div>
    </div>
  `;

  document.body.appendChild(ov);
  requestAnimationFrame(() => {
    ov.style.opacity = '1';
    const box = ov.firstElementChild;
    if (box) box.style.transform = 'translateY(0)';
  });

  const close = () => {
    ov.style.opacity = '0';
    setTimeout(() => ov.remove(), 250);
  };
  ov.querySelector('#punchout-result-ok').addEventListener('click', close);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
}

// 3. 雲端 OCR 辨識邏輯
window.processMileagePhoto = async function(input) {
  if (!input.files || !input.files[0]) return;

  // 1. 檢查有無 Key
  if (!S.settings.ocrKey) {
    toast('⚠️ 請先至設定填寫 OCR API Key');
    return;
  }

  const file = input.files[0];
  const imgPreview = document.getElementById('ocr-preview-img');
  const loading = document.getElementById('ocr-loading');
  const placeholder = document.getElementById('ocr-placeholder');

  // 2. 顯示本地預覽 (加速感)
  imgPreview.src = URL.createObjectURL(file);
  imgPreview.style.display = 'block';
  if(placeholder) placeholder.style.display = 'none';
  loading.style.display = 'flex';

  try {
    // 🚀 [核心優化]：壓縮圖片再上傳 (將圖片縮放至寬度 1000px)
    const compressedBase64 = await compressImage(file, 1000);

    const formData = new FormData();
    // 使用 base64 格式上傳，穩定性最高
    const pureBase64 = compressedBase64.split(',')[1]; 
    formData.append("base64Image", "data:image/jpeg;base64," + pureBase64);
    formData.append("language", "eng");
    formData.append("filetype", "JPG");

    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { "apikey": S.settings.ocrKey },
      body: formData
    });

    const result = await response.json();

    if (result.ParsedResults && result.ParsedResults.length > 0) {
      const detectedText = result.ParsedResults[0].ParsedText;
      // 提取數字邏輯
      const numbers = detectedText.match(/\d+/g);
      if (numbers) {
        const mileage = Math.max(...numbers.map(n => parseInt(n)));
        document.getElementById('manual-km').value = mileage;
        toast('✅ 辨識完成：' + mileage);
      } else {
        toast('⚠️ 辨識成功但找不到數字，請手動校正');
      }
    } else {
      throw new Error("API 傳回錯誤");
    }
  } catch (err) {
    console.error("OCR Error:", err);
    toast('❌ 網路辨識失敗，請改用手動輸入');
  } finally {
    loading.style.display = 'none';
  }
};

// 🖼️ 強化版：圖片壓縮與格式轉換函式 (解決 iOS HEIC 問題)
function compressImage(file, maxWidth) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        
        // 計算縮放比例
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = height * (maxWidth / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        // 繪製到畫布：這一步會把 HEIC 解碼並轉化為畫布像素
        ctx.drawImage(img, 0, 0, width, height);

        // 👈 [關鍵]：強制輸出為 image/jpeg，這會徹底解決格式不符的問題
        // 0.7 是壓縮品質，數值越低檔案越小，辨識速度越快
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        
        // 檢查 DataURL 是否有效
        if (dataUrl.length < 100) {
          reject("圖片轉換失敗");
        } else {
          resolve(dataUrl);
        }
      };
      img.onerror = () => reject("圖片載入失敗");
    };
    reader.onerror = () => reject("檔案讀取失敗");
  });
}
/* ══ 2. 首頁 結束 ══════════════════════════════════════════ */


/* ══ 3. 查看記錄 開始 ════════════════════════════════════ */
// 1. 查看記錄卡片摺疊
function foldCard(id, e) {
  e.stopPropagation();
  const el = document.getElementById(id); 
  const btn = document.getElementById(id + '-btn'); 
  if (!el || !btn) return;
  if (navigator.vibrate) try { navigator.vibrate(12); } catch(e){}

  requestAnimationFrame(() => {
    if (el.style.maxHeight === '0px' || el.style.maxHeight === '') { 
      el.style.maxHeight = el.scrollHeight + 'px'; 
      btn.style.transform = 'rotate(180deg)'; 
    } else { 
      el.style.maxHeight = '0px'; 
      btn.style.transform = 'rotate(0deg)'; 
    }
  });
}

// 3. 小日曆網格摺疊
function toggleCalendarGrid() {
  const grid = document.getElementById('hist-calendar');
  const btn = document.getElementById('hist-cal-toggle');
  if (!grid || !btn) return;
  if (navigator.vibrate) try { navigator.vibrate(12); } catch(e){}

  requestAnimationFrame(() => {
    if (grid.classList.contains('collapsed-cal')) {
      grid.classList.remove('collapsed-cal');
      btn.style.transform = 'rotate(180deg)';
    } else {
      grid.classList.add('collapsed-cal');
      btn.style.transform = 'rotate(0deg)';
    }
  });
}

/* ══ 美化版：單筆記錄卡片 (包含保養維修項目 + 車行 + 備註 + 精美雙色時間標籤) ══ */
function buildRecItem(r, listNo) {
  const cid = `hrc-${r.id}`;
  
  const dStr = safeText(fmtDateDisp(r.date));
  const tStr = safeText(r.time || '--:--');
  
  // 🌟 專法報酬記錄卡片（獨立專屬樣式）
  if (r.isSpecialLawAdj || (r.lawAdjAmt > 0 && pf(r.orders) === 0)) {
    const plat = getPlatform(r.platformId);
    const lawStartDisp = r.lawStart ? fmtDateDisp(r.lawStart) : '2026/7/20';
    const lawEndDisp = r.lawEnd ? fmtDateDisp(r.lawEnd) : '2026/8/2';
    const totalAmt = recTotal(r);

    return `
      ${listNo ? `<span style="font-family:var(--mono);font-size:13px;font-weight:900;color:#64748b;">#${listNo}</span>` : ''}
      <div class="hist-rec-card" data-id="${safeText(r.id)}" style="border:2px solid #a855f7;background:#fff;box-shadow:0 4px 4px rgba(168,85,247,0.4);">
        <div class="hrc-top" onclick="openDetailOverlay('${safeText(r.id)}')">
          <div class="hrc-row1" style="display:block; position:relative;">
            <span style="position:absolute;top:-5px;left:-15px;background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:0 0 16px 0;color:#fff;font-size:15px;font-weight:700;letter-spacing:0.7px;padding:4px 14px;">⚖️ 專法報酬差額調整</span>

            <div style="display:flex; align-items:center; gap:8px; margin-left:168px;">
              <span style="background:${plat.color}15;color:${plat.color};border:1px solid ${plat.color}40;padding:1px 8px;border-radius:12px;font-size:14px;font-weight:800;">${safeText(plat.name)}</span>
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
            <div style="display:flex;flex-direction:column;gap:2px;background:#e6d3f0;padding:1px 8px;border-radius:12px;border:1px solid #b77cd4;">
              <span style="font-family:var(--mono);font-size:14px;font-weight:750;color: #0072E3;">${lawStartDisp} ~ ${lawEndDisp}</span>
            </div>

            <div style="text-align:right;margin-top:-27px;">
              <span style="font-family:var(--mono);font-size:24px;font-weight:900;color:#fff;background:linear-gradient(90deg, #e6d3f0 29%, #b77cd4 30%, #a45fb6 100%);padding:2px 10px;border-radius:16px;box-shadow:0 3px 4px rgba(168,85,247,0.5);">
                <span style="font-size:27px;color: #2196f3;margin-right:8px;">+</span><span style="font-size:10px;margin-right:4px;">$</span>${fmt(totalAmt)}
              </span>
            </div>
          </div>
        </div>
      </div>`;
  }
  
  // 1. 現金小費專屬卡片 (與平台標籤合體版)
  if (r.isCashTip) {
    const plat = getPlatform(r.platformId);
    return `
      <div class="hist-rec-card cashtip-card" data-id="${safeText(r.id)}" onclick="openDetailOverlay('${safeText(r.id)}')" style="border: 1.5px solid ${plat.color};border-radius:13px; cursor:pointer; position:relative; margin-bottom:2px;">
        
        <!-- 左上角絕對定位標籤 (套用平台專屬顏色) -->
        <div style="position:absolute; top:-2px; left:-3px; z-index:1;">
          <span style="display:block; background:${plat.color}; color:#ffffff; padding:4px 10px; border-radius:0 0 16px 0; font-size:13px; font-weight:800; letter-spacing:1px; line-height:1.4;">💵 現金小費</span>
        </div>
        
        <!-- 右側內容區塊 (利用 padding-left 避開左上標籤) -->
        <div style="display:flex; align-items:center; justify-content:space-between; padding: 2px 10px 4px 105px; min-height: 28px;">
          
          <div style="display:flex; flex-direction:row; gap:4px; flex:1; overflow:hidden; padding-right:8px; margin-top:2px;">
            
            <!-- 上排：雙色日期時間膠囊 -->
            <div style="display:flex; align-items:center;">
              <div style="display:inline-flex; align-items:center; border-radius:6px; border:1.5px solid #e2e8f0; overflow:hidden; flex-shrink:0;">
                <span style="padding:2px 6px;background:#f1f5f9;font-size:13px;font-weight:800;color: #ff1f8f;font-family:var(--mono);border-right:2px solid #e2e8f0;">${dStr}</span>
                <span style="padding:2px 6px;background:#ffffff;font-size:12px;font-weight:900;color: #2563eb;font-family:var(--mono);">${tStr}</span>
              </div>
            </div>

            <!-- 下排：多彩備註標籤 -->
            ${r.note ? `<div style="display:flex; align-items:center; flex-wrap:nowrap; overflow:hidden; text-overflow:ellipsis;">${getCashTipTagsHtml(r.note)}</div>` : ''}
            <div class="h-div" style="margin:0 0 0 7px;height:24px;"></div>
          </div>
          
          <!-- 最右側：金額 -->
          <div style="font-family:var(--mono); font-size:18px; font-weight:750; color:#16a34a; flex-shrink:0; text-align:right;">
            <span style="font-size:11px; opacity:0.8;">$ </span>${fmt(r.cashTipAmt)}
          </div>
          
        </div>
      </div>`;
  }
  
  // 2. 純打卡紀錄 (精美標籤版)
  if (r.isPunchOnly) {
    const isOnline = r.punchOut === '';
    
    // 背景與邊框判斷
    const cardBorder = isOnline ? 'border: 2px solid #10b981;' : 'border: 1.5px solid #cbd5e1;';
    const tagBg = isOnline ? 'linear-gradient(135deg, #10b981, #059669)' : '#334155';
    // 計時中：下線時間留白；下線後：顯示下線時間
    const outTimeStr = isOnline ? '' : safeText(r.punchOut);

    // 1. 里程標籤 (僅在下線後且有里程時顯示)
    const mileageHtml = (pf(r.mileage) > 0) 
      ? `<div style="margin-left:6px; background:#fff7ed; color:#ea580c; padding:2px 5px; border-radius:8px; border:1.5px solid #ffd093; font-size:14px; font-weight:800; display:inline-flex; align-items:center; gap:4px;">
          <span style="font-size:13px;margin-right:5px;">🛣️</span>${Math.round(pf(r.mileage))}<span style="font-size:12px;letter-spacing:0.6px;margin:5px 0 0 4px;color:#000;">km</span>
        </div>` 
      : '';

    // 2. 累計工時精美標籤
    const hoursHtml = isOnline
      ? `<div style="margin-left:6px; background: #e5ffed; color: #009765; border:1.5px solid #78efa4; padding:5px 10px; border-radius:8px; font-size:15px; font-weight:750; display:inline-flex; align-items:center; gap:5px;">
          <span style="display:inline-block; width:8px; height:8px; background:#10b981; border-radius:50%; animation: pulse-green 1.5s infinite;"></span> 
          <span> 上線中</span>
         </div>`
      : `<div style="margin-left:6px; background:#eff6ff; color:#2563eb; padding:2px 3px; border-radius:8px; border:1.5px solid #bfdbfe; font-size:14px; font-weight:800; display:inline-flex; align-items:center; gap:4px;">
          <span style="font-size:13px;">⏱️</span> ${fmtHours(r.hours)}
         </div>`;

    return `
      <div class="hist-rec-card punch-card-compact" data-id="${safeText(r.id)}" onclick="openDetailOverlay('${safeText(r.id)}')" style="${cardBorder} padding:0 4px;">
        <span style="background:${tagBg}; color:#fff; font-size:13px; padding:4px 3px; border-radius:10px; font-weight:800; letter-spacing:0.5px; flex-shrink:0; width:60px; height:32px; display:flex; align-items:center; justify-content:center;margin-right:5px;">🕒 打卡</span>
        
        <div style="font-family:var(--mono);font-size:15px;font-weight:800;color:var(--t1); flex:1; display:flex; align-items:center; justify-content:flex-start;">
          <!-- 移除日期，只保留時間軸 -->
          <span style="font-size:16px;font-weight:850;color: #00b85f;margin-bottom:29px;">${safeText(r.punchIn)}</span><span style="font-family:var(--mono);color:#000;font-size:16px;font-weight:900;margin:0 15px 0 3px;">→</span><span style="color:var(--red);margin:27px 2px 0 -12px;">${outTimeStr}</span>
          
          <!-- 組合標籤區 -->
          <div style="display:flex; align-items:center;">
            ${mileageHtml}
            ${hoursHtml}
          </div>
        </div>
      </div>`;
  }

  // 3. 一般行程記錄
  const plat = getPlatform(r.platformId); 
  const total = recTotal(r);
  const totalBonus = pf(r.bonus) + pf(r.tempBonus);
  const income = total - totalBonus - pf(r.tips);

  const _orders = pf(r.orders); 
  const _hours = pf(r.hours);
  const avgOrd = _orders > 0 ? Math.round(total / _orders) : 0;
  const ordHr = _hours > 0 ? (_orders / _hours).toFixed(1) : 0;
  const avgHr = _hours > 0 ? Math.round(total / _hours) : 0;

  // 計算佔比 (精確到小數點後1位並保證加總100.0%)
  const pcts = getExactPercentages([income, totalBonus, pf(r.tips)]);
  const incPct = pcts[0];
  const bonPct = pcts[1];
  const tipPct = pcts[2];
  
  // 👇 全新設計：一體成型三色膠囊 (單數、里程、工時)
  let tagsParts = [];
  
  // 一體成型三色膠囊（缺資料也顯示，數字留––）
  const ordText = _orders > 0 ? String(_orders) : '––';
  const milText = pf(r.mileage) > 0 ? String(r.mileage) : '––';
  const hrText  = _hours > 0 ? fmtHours(_hours) : '––';

  const tagsHtml = `
    <div style="display:inline-flex; align-items:stretch; border-radius:8px; border:1.5px solid #c3c9d0; overflow:hidden; margin-bottom:1px; background:#c3c9d0; gap:2px;">
      <div style="background:#fff7ed; padding:1.5px 8px; display:flex; align-items:baseline; gap:3px; min-width:42px;">
        <span style="font-size:15px; font-family:var(--mono); font-weight:800; color:#ff0000;letter-spacing:0.5px;">${ordText}</span>
        <span style="font-size:10px; font-weight:600; color: #000;">單</span>
      </div>
      <div style="background:#e1ffff; padding:2px 8px; display:flex; align-items:baseline; gap:3px; min-width:48px;">
        <span style="font-size:15px; font-family:var(--mono); font-weight:800; color:#b23dff;letter-spacing:0.5px;">${milText}</span>
        <span style="font-size:10px; font-weight:800; color:#000;">km</span>
      </div>
      <div style="background:#eff6ff; padding:2px 8px; display:flex; align-items:center; gap:4px; min-width:52px;">
        <span style="font-size:11px;">⏱️</span>
        <span style="font-size:13px; font-family:var(--mono); font-weight:800; color:#2563eb;">${hrText}</span>
      </div>
    </div>
  `;

  // 基本工資分析
  const recWageHtml = getWageBadge(_hours, total);

  // === 保養維修專屬顯示 ===
  if (r.type === 'maintenance' || r.type === 'maint') {
    const maintItems = (r.items && r.items.length > 0)
      ? r.items.map(item => safeText(item)).join('、')
      : '未填寫保養項目';

    const kmLabel = r.km ? `<span class="veh-label veh-label-km">距離：${safeText(r.km.toString())} km</span>` : '';
    const noteLabel = r.note ? `<span class="veh-label veh-label-note">備註：${safeTextWithBr(r.note)}</span>` : '';

    return `
      <div class="hist-rec-card" data-id="${safeText(r.id)}" onclick="openDetailOverlay('${safeText(r.id)}')" style="border-color: #8b5cf6; box-shadow: 0 2px 8px rgba(139, 92, 246, 0.15);">
        <div class="hrc-top">
          <div class="hrc-toggle" id="${cid}-btn" onclick="foldCard('${safeText(cid)}', event)">▼</div>
          <div class="hrc-row1" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span class="hrc-plat-tag" style="background:#8b5cf6; color:#fff;">🔧 保養維修</span>
            <!-- 👇 紫色系雙色時間膠囊 -->
            <div style="display:inline-flex; align-items:center; border-radius:6px; border:1px solid #ddd6fe; overflow:hidden;">
              <span style="padding:2px 6px;background:#f3e8ff;font-size:13px;font-weight:800;color: #7e22ce;font-family:var(--mono);border-right:1px solid #ddd6fe;">${dStr}</span>
              <span style="padding:2px 6px;background:#ffffff;font-size:12px;font-weight:900;color: #9333ea;font-family:var(--mono);">${tStr}</span>
            </div>
            ${r.shop ? `<span style="font-size:12px; color:var(--t2); font-weight:700; background:#f1f5f9; padding:2px 8px; border-radius:6px;">${safeText(r.shop)}</span>` : ''}
          </div>
          <div style="display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:8px; margin:10px 0;">
            <span class="veh-label veh-label-item">項目：${maintItems}</span>
            ${kmLabel}
            ${noteLabel}
          </div>
          <div style="font-family:var(--mono); font-size:17px; font-weight:800; color:#8b5cf6;">
            -$${fmt(r.amount || 0)}
          </div>
        </div>
      </div>`;
  }

  // === 一般行程記錄 ===
  return `
    ${listNo ? `<span style="font-family:var(--mono);font-size:13px;font-weight:900;color:#64748b;">#${listNo}</span>` : ''}
    <div class="hist-rec-card" data-id="${safeText(r.id)}" style="border:2px solid ${plat.color};">
      <div class="hrc-top" onclick="openDetailOverlay('${safeText(r.id)}')">
        <div class="hrc-toggle" id="${cid}-btn" onclick="foldCard('${safeText(cid)}', event)">▼</div>
        <!-- 👇 將平台標籤改為絕對定位，對齊區間總計卡片風格 -->
        <div class="hrc-row1" style="margin: 0px 0 2px 0; display:block;">
          <span style="position:absolute; top:0; left:0; background:${plat.color}; color:#ffffff; padding:4px 14px; border-radius:0 0 16px 0; font-size:13px; font-weight:800; letter-spacing:0.7px; line-height:18px;">${safeText(plat.name)}</span>
          
          <div style="display:flex; align-items:flex-start; gap:8px; margin: 1px 0 5px 100px;">
            <!-- 👇 藍色系雙色時間膠囊 -->
            <div style="display:inline-flex; align-items:center; border-radius:20px; border:1.5px solid #65edff; overflow:hidden; margin-bottom:1px;">
              <span style="padding:1px 9px;background:#46484a;font-size:14px;font-weight:800;color: #f0ff1f;font-family:var(--mono);border-right:2px solid #c3c9d0;letter-spacing:0.5px;">${dStr}</span>
              <span style="padding:1px 9px;background:#ffffff;font-size:14px;font-weight:900;color: #2563eb;font-family:var(--mono);">${tStr}</span>
            </div>
            ${r.note ? `<div style="color: #2563eb; font-weight:800; font-size:12px; line-height:1.4; padding-top:1px;"> ${formatNoteWithLimit(r.note)}</div>` : ''}
          </div>
        </div>
        
        <div class="hrc-row2">
          <span class="hrc-amt"><span style="font-size:12px;">$ </span><span style="margin-right:10px;">${fmt(total)}</span></span>
          ${tagsHtml}
        </div>
      </div>

      <div id="${cid}" class="hrc-collapse" style="background: #f0f7ff; overflow:hidden; transition:max-height 0.3s ease; margin:4px 0 1px 0px;">
        <div style="padding: 7px 8px 1px 8px; width: 100%; box-sizing: border-box;">
          <!-- 淨行程、獎勵、小費方塊區 (強制 3 等分網格) -->
          <div style="display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:6px;">
          
          <!-- 淨行程方塊 -->
          <div style="flex:1; display:flex; flex-direction:column; position:relative; background:#ffffff; border-radius:12px; border:1.5px solid #bbf7d0; overflow:hidden;">
            <div style="background: rgba(34, 197, 94, 0.12); padding:4px 6px; display:flex; justify-content:center; align-items:center; gap:6px; border-radius:0 0 15px 15px; border-bottom:1px solid rgba(34,197,94,0.2);">
              <span style="color: #17a44b; font-size:12px; font-weight:650; font-family:var(--mono); padding-left:8px;">淨行程</span>
              <span style="display:inline-flex; align-items:center; border-radius:6px; padding:1px 4px; background: #ffffff; border:1px solid rgba(34, 197, 94, 0.3);">
                <span style="color: #17a44b; font-size:11px; font-weight:750; font-family:var(--mono);">${incPct}<span style="font-size:9px;"> %</span></span>
              </span>
            </div>
            <div style="padding-top:7px; text-align:center; background:linear-gradient(180deg, rgba(34,197,94,0.03) 0%, transparent 80%);">
              <span style="color: #17a44b; font-size:17px; font-weight:750; font-family:var(--mono);"><span style="font-size:11px; opacity:0.8;">$ </span>${fmt(income)}</span>
            </div>
          </div>

          <!-- 獎勵方塊 -->
          <div style="flex:1; display:flex; flex-direction:column; position:relative; background:#ffffff; border-radius:12px; border:1.5px solid #fde047; overflow:hidden;">
            <div style="background: rgba(245, 158, 11, 0.12); padding:4px 6px; display:flex; justify-content:center; align-items:center; gap:6px; border-radius:0 0 15px 15px; border-bottom:1px solid rgba(245,158,11,0.2);">
              <span style="color: #ff791a; font-size:12px; font-weight:650; font-family:var(--mono); padding-left:8px;">獎勵</span>
              <span style="display:inline-flex; align-items:center; border-radius:6px; padding:1px 4px; background: #ffffff; border:1px solid rgba(245, 158, 11, 0.3);">
                <span style="color: #ff791a; font-size:11px; font-weight:750; font-family:var(--mono);">${bonPct}<span style="font-size:9px;"> %</span></span>
              </span>
            </div>
            <div style="padding-top:7px; text-align:center; background:linear-gradient(180deg, rgba(245,158,11,0.03) 0%, transparent 80%);">
              <span style="color: #ff791a; font-size:17px; font-weight:750; font-family:var(--mono);"><span style="font-size:11px; opacity:0.8;">$ </span>${fmt(totalBonus)}</span>
            </div>
          </div>

          <!-- 小費方塊 -->
          <div style="flex:1; display:flex; flex-direction:column; position:relative; background:#ffffff; border-radius:12px; border:1.5px solid #d8b4fe; overflow:hidden;">
            <div style="background: rgba(168, 85, 247, 0.12); padding:4px 6px; display:flex; justify-content:center; align-items:center; gap:6px; border-radius:0 0 15px 15px; border-bottom:1px solid rgba(168,85,247,0.2);">
              <span style="color: #7e22ce; font-size:12px; font-weight:650; font-family:var(--mono); padding-left:8px;">小費</span>
              <span style="display:inline-flex; align-items:center; border-radius:6px; padding:1px 4px; background: #ffffff; border:1px solid rgba(168, 85, 247, 0.3);">
                <span style="color: #9333ea; font-size:11px; font-weight:750; font-family:var(--mono);">${tipPct}<span style="font-size:9px;"> %</span></span>
              </span>
            </div>
            <div style="padding-top:7px; text-align:center; background:linear-gradient(180deg, rgba(168,85,247,0.03) 0%, transparent 80%);">
              <span style="color: #7e22ce; font-size:17px; font-weight:750; font-family:var(--mono);"><span style="font-size:11px; opacity:0.8;">$ </span>${fmt(pf(r.tips))}</span>
            </div>
          </div>
        </div>

        <div style="border:1px solid #83c3ff; border-radius:10px; margin: 5px 0px -10px 0px;"></div>
      
        <div style="padding:5px 3px 5px 3px; display:flex; justify-content:center; align-items:flex-start; font-size:12px; font-weight:700; color: #000000; width:100%;">
          <div style="flex:1; text-align:center; padding-top:9px; font-family:var(--mono);">
            <span style="letter-spacing: 1.5px;">一單</span>： <span style="color: #16a3ca;font-size:19px;font-weight:800;"><span style="font-size:10px;">$ </span>${fmt(avgOrd)}</span>
          </div>
          <div class="h-div" style="height:58px; width:3px; margin-top:10px;"></div>
          <div style="flex:1; text-align:center; padding-top:9px; font-family:var(--mono)">
            <span style="letter-spacing: 1.5px;">1h</span>： <span style="color: var(--text-red); font-size:19px; font-weight:800;">${ordHr}<small style="color: #b938ff; font-size:10px; font-weight:600;"> 單</small></span>
          </div>
          <div class="h-div" style="height:58px; width:3px; margin-top:10px;"></div>
          <div style="flex:1; text-align:center; padding-top:9px; font-family:var(--mono)">
            <span style="letter-spacing: 1.5px;">時薪</span>： <span style="color: var(--text-blue); font-size:19px; font-weight:800;"><span style="font-size:10px;">$ </span>${fmt(avgHr)}</span>
            ${recWageHtml}
          </div>
        </div>
      </div>
      </div>
    </div>`;
}

if (!S.histTab || ['week','biweek','halfmonth','month','year'].includes(S.histTab)) S.histTab = 'day';
if (!S.histNavDate) S.histNavDate = new Date();
if (!S.histFilter) S.histFilter = 'all';

window.navHistGroup = function(dir, mode) {
  if (mode === 'reconcile' || S.histTab === 'reconcile') {
    const platId = S.histReconcilePlat;
    if (!platId) return;
    S.histNavDate = shiftPayPeriod(platId, S.histNavDate || new Date(), dir);
    S.histPage = 1;
    renderHistory();
    return;
  }
  let d = new Date(S.histNavDate);
  if (mode === 'week') { d.setDate(d.getDate() + (dir * 7)); }
  if (mode === 'biweek') { d.setDate(d.getDate() + (dir * 14)); }
  if (mode === 'halfmonth') {
    let isFirstHalf = d.getDate() <= 15;
    if (dir === 1) {
      if (isFirstHalf) d.setDate(16);
      else { d.setMonth(d.getMonth() + 1); d.setDate(1); }
    } else if (dir === -1) {
      if (isFirstHalf) { d.setMonth(d.getMonth() - 1); d.setDate(16); }
      else d.setDate(1);
    }
  }
  if (mode === 'month') { d.setMonth(d.getMonth() + dir); }
  if (mode === 'year') { d.setFullYear(d.getFullYear() + dir); }
  S.histNavDate = d;
  S.histPage = 1;
  renderHistory();
};
function changeHistFilter(val) { S.histFilter = val; renderHistory(); }

window.setHistReconcilePlat = function(platId) {
  S.histReconcilePlat = platId;
  S.histPage = 1;
  S.histNavDate = new Date();
  renderHistory();
};

/** 對帳：點日期 → 跳到列表該日第一筆（含換頁） */
window.jumpToHistListDate = function(dateStr) {
  const pages = window.__histReconcilePages || [];
  let targetPage = 1;
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].some(r => r.date === dateStr)) {
      targetPage = i + 1;
      break;
    }
  }
  S.histPage = targetPage;
  S.histShowList = true;
  renderHistory();

  requestAnimationFrame(() => {
    setTimeout(() => {
      const el = document.querySelector(`[data-hist-date="${dateStr}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'box-shadow 0.3s';
        el.style.boxShadow = '0 0 0 3px #3b82f6';
        setTimeout(() => { el.style.boxShadow = ''; }, 1200);
      }
    }, 50);
  });
};

/* 👈 [新增] 查看記錄（週/雙週/半月/月/年 分組檢視）的快速選日期入口 */
function openHistGroupDatePicker(mode) {
  if (!S.histNavDate) S.histNavDate = new Date();
  const d = new Date(S.histNavDate);
  if (mode === 'year') {
    openQuickDatePicker({
      mode: 'year', year: d.getFullYear(), curY: d.getFullYear(),
      onSelect: (y) => { const nd = new Date(S.histNavDate); nd.setFullYear(y); S.histNavDate = nd; S.histPage = 1; renderHistory(); }
    });
  } else if (mode === 'week' || mode === 'biweek') {
    openQuickDatePicker({
      mode: 'week', weekAnchor: d,
      onSelectWeek: (nd) => { S.histNavDate = nd; S.histPage = 1; renderHistory(); }
    });
  } else {
    // month / halfmonth 共用「年月」快速選擇
    openQuickDatePicker({
      mode: 'month', year: d.getFullYear(), curY: d.getFullYear(), curM: d.getMonth()+1,
      onSelect: (y, m) => { const nd = new Date(S.histNavDate); nd.setFullYear(y); nd.setMonth(m-1, mode==='halfmonth' ? nd.getDate() : 1); S.histNavDate = nd; S.histPage = 1; renderHistory(); }
    });
  }
}

/* ══ 替換：統一讓查看紀錄外層負責上下滾動 ══ */
function renderHistory() {
  const content = document.getElementById('hist-content');
  content.style.overflowY = 'auto';
  content.style.overflowX = 'hidden';
  content.style.display = 'block';
  content.style.WebkitOverflowScrolling = 'touch';

  if (['week','biweek','halfmonth','month','year'].includes(S.histTab)) S.histTab = 'reconcile';

  if (S.histTab === 'day') {
    renderHistDayView();
  } else {
    renderHistReconcileView();
  }
}

function renderHistDayView() {
  const content = document.getElementById('hist-content'); const { calY:y, calM:m } = S;

  // 定義樣式組件 (22px 數字與 12px 單位)
  const styleNum = (val) => `<span style="font-size: 20px; font-weight: 900; color: #006eff; font-family: var(--mono); vertical-align: middle;">${val}</span>`;
  const styleUnit = (txt) => `<span style="font-size: 11px; font-weight: 800; color: #000000; margin: 0 1px; vertical-align: middle;">${txt}</span>`;

  content.innerHTML = `<div id="hist-header" style="padding:6px 16px 6px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px">
        <button class="mbtn" id="hist-prev">◀</button>
        
        <div onclick="openHistDayDatePicker()" style="min-width:90px; text-align:center; cursor:pointer;">
          <h2 id="hist-label" style="margin:0; line-height:1;">
            ${styleNum(y)}${styleUnit(' 年 ')}${styleNum(m)}${styleUnit(' 月 ')} <span style="color:#000; font-size:10px; vertical-align:middle;">▼</span>
          </h2>
        </div>
        
        <button class="mbtn" id="hist-next">▶</button>
        <!-- 👇 這裡將箭頭改為預設 ▼ -->
        <button class="mbtn" onclick="toggleCalendarGrid()" id="hist-cal-toggle" style="background:#bbdaf7;color:#0c72d2;font-size:22px;font-weight:900;width:35px;height:35px;border:1.5px solid #29458b;border-radius:50%;transition:transform 0.3s;transform:rotate(180deg);title="收起/展開日曆">▼</button>
      </div>
      <div style="display:flex; gap:18px;">
        <button class="icon-btn" onclick="openSearch()" title="搜尋記錄"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>
        <button class="icon-btn" onclick="openFullCalendar()" title="大日曆"><img src="images/calendar.png" alt="日曆" style="width:16px;height:16px;opacity:0.7;"></button>
      </div>
    </div>
    <div id="hist-calendar-wrap" style="transition: max-height 0.3s ease; overflow: hidden; max-height: 500px;">
      <!-- 👇 這裡加入 collapsed-cal 讓它預設為折疊狀態 -->
      <div class="month-grid collapsed-cal" id="hist-calendar"></div>
    </div>
    <div class="hist-divider"></div>
    <div id="hist-day-summary" style="margin:6px 0 4px;"></div>
    <div class="sec-title" id="hist-day-label" style="padding:0 7px; color: #000000;">指定日記錄</div>
  </div>
  <div id="hist-rec-list" style="padding:0 16px 24px; display:flex; flex-direction:column; gap:7px;"></div>`;
  
  const prevBtn = document.getElementById('hist-prev');
  const nextBtn = document.getElementById('hist-next');

  // 防呆：確保按鈕存在才綁定
  if (prevBtn) {
    prevBtn.onclick = () => { 
      S.calM--; 
      if (S.calM < 1) { S.calM = 12; S.calY--; } 
      S.selDate = `${S.calY}-${pad(S.calM)}-01`; 
      renderHistory(); 
    };
  }
  if (nextBtn) {
    nextBtn.onclick = () => { 
      S.calM++; 
      if (S.calM > 12) { S.calM = 1; S.calY++; } 
      S.selDate = `${S.calY}-${pad(S.calM)}-01`; 
      renderHistory(); 
    };
  }

  renderHistCalendarGrid(); 
  renderHistRecords(S.selDate);
}
window.openHistDayDatePicker = function() {
  const curDate = S.selDate ? new Date(S.selDate + 'T00:00:00') : new Date();
  const curY = S.calY || curDate.getFullYear();
  const curM = S.calM || (curDate.getMonth() + 1);
  const curD = curDate.getDate() || 1;

  openQuickDatePicker({
    mode: 'day',
    year: curY,
    curY: curY,
    curM: curM,
    curD: curD,
    onSelectDay: (y, m, d) => {
      S.calY = y;
      S.calM = m;
      S.selDate = `${y}-${pad(m)}-${pad(d)}`;
      renderHistory(); // 自動跳轉至小日曆該天位置並渲染當日記錄
    }
  });
};

function renderHistCalendarGrid() {
  const { calY:y, calM:m } = S; const grid = document.getElementById('hist-calendar'); const first = new Date(y, m-1, 1).getDay(); const days  = new Date(y, m, 0).getDate(); const DOW = ['日','一','二','三','四','五','六'];
  
  let html = `<div class="month-row header-row">`; 
  DOW.forEach(d => { html += `<div class="month-cell month-dow">${d}</div>`; }); 
  html += `</div><div class="month-row">`;
  
  let col = 0; 
  for (let i=0; i<first; i++) { html += `<div class="month-cell"></div>`; col++; }
  for (let day=1; day<=days; day++) {
    const ds  = `${y}-${pad(m)}-${pad(day)}`; 
    // 👇 改為：只要當天有任何紀錄 (包含一般、現金小費、打卡)，就顯示圓點
    const hasRecord = getDayRecs(ds).length > 0; 
    const cls = ['month-cell', ds===todayStr()?'today':'', ds===S.selDate?'sel':''].filter(Boolean).join(' '); 
    const dotHtml = hasRecord ? `<div class="has-rec-dot"></div>` : '';
    html += `<div class="${cls}" data-ds="${ds}">${dotHtml}<div class="day-num">${day}</div></div>`;
    col++; 
    if (col % 7 === 0 && day < days) { html += `</div><div class="month-row">`; }
  } 
  html += `</div>`; 
  grid.innerHTML = html;

  // 標記包含選定日期的該週為 current-week
  grid.querySelectorAll('.month-row').forEach(row => {
    if (row.querySelector('.sel')) row.classList.add('current-week');
  });

  grid.querySelectorAll('.month-cell[data-ds]').forEach(cell => { 
    cell.addEventListener('click', () => { 
      S.selDate = cell.dataset.ds; 
      
      // 更新格子選中狀態
      grid.querySelectorAll('.month-cell').forEach(c => c.classList.toggle('sel', c.dataset.ds === S.selDate)); 
      
      // 即時更新當前所在週 (確保折疊狀態下如果點擊到相鄰日期，能無縫切換顯示正確的週)
      grid.querySelectorAll('.month-row').forEach(row => row.classList.remove('current-week'));
      const newSel = grid.querySelector('.sel');
      if (newSel) newSel.closest('.month-row').classList.add('current-week');

      renderHistRecords(S.selDate); 
    }); 
  });
}

// 👇 智慧工時計算函數 (依據單/多平台與打卡記錄聰明判斷)
function calcTotalHours(recs) {
  const byDate = {};
  recs.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push(r);
  });

  let totalHours = 0;
  for (let date in byDate) {
    const dayRecs = byDate[date];
    const punchRecs = dayRecs.filter(r => r.isPunchOnly);
    const regularRecs = dayRecs.filter(r => !r.isPunchOnly && !r.isCashTip);

    // 計算當天各平台的行程工時總和
    const plats = {};
    regularRecs.forEach(r => {
      if (r.platformId) {
        plats[r.platformId] = (plats[r.platformId] || 0) + pf(r.hours);
      }
    });
    const platIds = Object.keys(plats);

    if (platIds.length === 0) {
      // 情境 A：只有純打卡或現金小費，直接加總打卡時間
      totalHours += punchRecs.reduce((s, r) => s + pf(r.hours), 0);
    } 
    else if (platIds.length === 1) {
      // 情境 B：當天只有 1 個平台
      let platTime = plats[platIds[0]];
      // 防呆：如果平台行程時間忘記填(為0)，但有打卡，就拿打卡時間來墊檔
      if (platTime === 0 && punchRecs.length > 0) {
        totalHours += punchRecs.reduce((s, r) => s + pf(r.hours), 0);
      } else {
        totalHours += platTime;
      }
    } 
    else {
      // 情境 C：當天記錄大於 1 個平台 (雙開或多開)
      if (punchRecs.length > 0) {
        // 有打卡記錄：以打卡時間為主 (多段打卡會相加)
        totalHours += punchRecs.reduce((s, r) => s + pf(r.hours), 0);
      } else {
        // 沒有打卡記錄：各平台可能會重疊，取時間最長的那個平台
        let maxPlatHour = 0;
        for (let pid in plats) {
          if (plats[pid] > maxPlatHour) maxPlatHour = plats[pid];
        }
        totalHours += maxPlatHour;
      }
    }
  }
  return totalHours;
}

/* ══ 查看記錄 · 對帳明細列表（依平台報酬區間） ══ */
function renderHistReconcileView() {
  const content = document.getElementById('hist-content');
  const activePlats = (S.platforms || []).filter(p => p.active);
  if (!activePlats.length) {
    content.innerHTML = `<div class="empty-tip" style="padding:40px 16px;">請先至「設定」啟用至少一個外送平台</div>`;
    return;
  }
  if (!S.histReconcilePlat || !activePlats.some(p => p.id === S.histReconcilePlat)) {
    S.histReconcilePlat = activePlats[0].id;
  }
  if (!S.histNavDate) S.histNavDate = new Date();

  const plat = activePlats.find(p => p.id === S.histReconcilePlat) || activePlats[0];
  const period = getPayPeriod(plat.id, S.histNavDate);
  const sStr = period.startStr, eStr = period.endStr;

  const filteredRecs = S.records.filter(r =>
    r.date >= sStr && r.date <= eStr &&
    (r.platformId === plat.id || r.isPunchOnly)
  );
  let displayRecs = filteredRecs.filter(r => !r.isPunchOnly && !r.isCashTip);
  displayRecs.sort((a, b) => b.date.localeCompare(a.date) || (a.time || '').localeCompare(b.time || ''));

  // 分頁（同日不拆頁）
  const dateGroups = [];
  displayRecs.forEach(r => {
    const last = dateGroups[dateGroups.length - 1];
    if (last && last[0].date === r.date) last.push(r);
    else dateGroups.push([r]);
  });
  const pages = [];
  let currentPage = [], currentCount = 0;
  dateGroups.forEach(group => {
    const groupSize = group.length;
    const projected = currentCount + groupSize;
    if (currentCount === 0 || projected <= 10) {
      currentPage.push(...group);
      currentCount = projected;
    } else {
      pages.push(currentPage);
      currentPage = [...group];
      currentCount = groupSize;
    }
  });
  if (currentPage.length) pages.push(currentPage);
  window.__histReconcilePages = pages; // 給 jumpToHistListDate 用

  const totalPages = pages.length || 1;
  if (S.histPage > totalPages) S.histPage = totalPages;
  
  const pageItems = pages[S.histPage - 1] || [];

  // ✅ 前面幾頁的筆數加總 = 本頁第一筆的編號起點
  const pageStartNo = pages
    .slice(0, Math.max(0, (S.histPage || 1) - 1))
    .reduce((sum, p) => sum + p.length, 0);
  
  const tInc = filteredRecs.reduce((s, r) => s + recTotal(r), 0);
  const tOrd = filteredRecs.reduce((s, r) => s + pf(r.orders), 0);
  const tMil = filteredRecs.reduce((s, r) => s + pf(r.mileage), 0);
  const tHrs = calcTotalHours(filteredRecs);

  // ✅ 只顯示「有紀錄」的日期
  const datesWithRec = [...new Set(displayRecs.map(r => r.date))].sort();
  // 顯示順序可改成由新到舊：
  // const datesWithRec = [...new Set(displayRecs.map(r => r.date))];

  const dayChipsHtml = datesWithRec.map(ds => {
    const day = parseInt(ds.slice(8, 10), 10);
    return `
      <button onclick="jumpToHistListDate('${ds}')" style="flex-shrink:0;min-width:40px;padding:6px 6px 4px;border-radius:12px;border:1.5px solid #86efac;background:#ecfdf5;font-family:var(--mono);font-weight:800;font-size:14px;color:#047857;cursor:pointer;">
        ${day}
      </button>`;
  }).join('');

  // 區間標題下方小字（Uber 提示；位置同以前熊貓明細／發薪）
  let metaHtml = '';
  if (plat.id === 'uber') {
    metaHtml = `<div style="font-size:12px;font-weight:600;color: #e50f0f;text-align:center;margin-top:6px;line-height:1.4;">⚠️ 週一 00:00～04:00 的行程，歸類為週日行程</div>`;
  }

  content.innerHTML = `
    <div style="padding:8px 16px 24px;">
      <!-- 平台按鈕 -->
      <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:8px;margin-bottom:-4px;">
        ${activePlats.map(p => {
          const on = p.id === plat.id;
          return `<button onclick="setHistReconcilePlat('${p.id}')" style="flex-shrink:0;padding:8px 16px;border-radius:14px;font-size:13px;font-weight:800;border:2px solid ${on ? p.color : '#e2e8f0'};background:${on ? p.color : '#fff'};color:${on ? '#fff' : '#64748b'};cursor:pointer;">${safeText(p.name)}</button>`;
        }).join('')}
      </div>

      <!-- 區間導覽 + 下方提示 -->
      <div style="display:flex;align-items:center;justify-content:space-between;background:#fff;padding:3px 10px;border-radius:20px;border:1px solid #cbd5e1;margin-bottom:4px;">
        <button class="btn btn1" onclick="navHistGroup(-1,'reconcile')" style="width:42px;height:42px;">◀</button>
        <div onclick="openReconcileDatePicker()" style="flex:1;text-align:center;cursor:pointer;">
          <div style="font-family:var(--mono);font-weight:900;line-height:1.3;">
            <span style="color:#006eff;font-size:16px;">${period.startStr.slice(0,4)}</span>
            <span style="font-size:12px;color:#000;">年</span>
            <span style="color:#006eff;font-size:16px;">${_fmtMD(period.startStr)}</span>
            <span style="color:#000;font-size:14px;"> ~ </span>
            <span style="color:#006eff;font-size:16px;">${_fmtMD(period.endStr)}</span>
            <span style="color:#94a3b8;font-size:12px;vertical-align:middle;"> ▼</span>
          </div>
          ${metaHtml}
        </div>
        <button class="btn btn1" onclick="navHistGroup(1,'reconcile')" style="width:42px;height:42px;">▶</button>
      </div>

      <!-- 有紀錄的日期列（無小字提示） -->
      <div style="display:flex;gap:6px;overflow-x:auto;padding:2px 0 4px;">
        ${dayChipsHtml || `<span style="font-size:14px;color:#94a3b8;font-weight:700;">本區間尚無行程紀錄</span>`}
      </div>

      ${buildSimplePeriodSummary(tInc, tOrd, tMil, tHrs)}

      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:2px 0;flex-wrap:wrap;">
        <span style="font-size:14px;font-weight:750;color:#0099ff;">
          共有 <span style="font-size:18px;font-weight:900;color:#ff7300;">${displayRecs.length}</span> 筆
        </span>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="pg-btn" onclick="changeHistPage(-1)" ${S.histPage <= 1 ? 'disabled' : ''}
            style="padding:6px 12px;border-radius:10px;border:1.5px solid #cbd5e1;background:#fff;font-weight:800;color:#475569;${S.histPage <= 1 ? 'opacity:0.4;' : ''}">上一頁</button>
          <span style="font-family:var(--mono);font-size:13px;font-weight:900;color:#2563eb;background:#eff6ff;padding:4px 10px;border-radius:20px;border:1px solid #bfdbfe;">
            <span style="font-size:16px;font-weight:900;color: #f62525;">${S.histPage}</span> / ${totalPages}
          </span>
          <button class="pg-btn" onclick="changeHistPage(1)" ${S.histPage >= totalPages ? 'disabled' : ''}
            style="padding:6px 12px;border-radius:10px;border:1.5px solid #cbd5e1;background:#fff;font-weight:800;color:#475569;${S.histPage >= totalPages ? 'opacity:0.4;' : ''}">下一頁</button>
          <button class="toggle-list-btn" onclick="toggleHistList()">${S.histShowList ? '▲ 隱藏列表' : '▼ 顯示列表'}</button>
        </div>
      </div>

      <div id="hist-list-wrapper" class="${S.histShowList ? '' : 'hidden'}">
        ${typeof renderCardList === 'function' ? renderCardList(pageItems, pageStartNo) : ''}

        <!-- 回到頂端 -->
        <div style="display:flex;justify-content:center;padding:16px 0 28px;">
          <button onclick="scrollHistToTop()" style=" padding:10px 22px;border-radius:20px;border:1.5px solid #cbd5e1;background:#ffffff;color:#2563eb;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 4px 4px rgba(37,99,235,0.4);display:inline-flex;align-items:center;gap:6px;"> ↑ 回到頂端 </button>
        </div>
      </div>
  `;
}
// 回到頂端捲動函式（對帳明細列表）
window.scrollHistToTop = function() {
  const el = document.getElementById('hist-content');
  if (el) {
    el.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

window.openReconcileDatePicker = function() {
  const platId = S.histReconcilePlat;
  if (!platId) {
    toast('⚠️ 請先選擇平台');
    return;
  }

  // 以目前錨點為中心，前後各列出若干個「該平台報酬區間」
  const center = new Date(S.histNavDate || new Date());
  const periods = [];
  // 先往前推 5 格
  let cursor = new Date(center);
  for (let i = 0; i < 5; i++) {
    cursor = shiftPayPeriod(platId, cursor, -1);
  }
  // 再依序產生 11 個區間（前5 + 當前 + 後5）
  for (let i = 0; i < 11; i++) {
    const p = getPayPeriod(platId, cursor);
    periods.push(p);
    cursor = shiftPayPeriod(platId, cursor, 1);
  }

  const cur = getPayPeriod(platId, center);
  const body = document.getElementById('quick-date-body');
  const ov = document.getElementById('quick-date-overlay');
  if (!body || !ov) {
    toast('⚠️ 找不到日期選擇元件');
    return;
  }

  let html = `<div class="qdp-title">📅 選擇報酬區間</div>
    <div class="qdp-week-grid">`;

  periods.forEach((p, idx) => {
    const isCur = p.startStr === cur.startStr && p.endStr === cur.endStr;
    // 用 startStr 當選取值，避免 closure 問題
    html += `<button class="qdp-week-btn ${isCur ? 'active' : ''}"
      onclick="qdpPickPayPeriod('${p.startStr}')">
      ${p.startStr.slice(0,4)}/${p.startStr.slice(5,7)}/${p.startStr.slice(8,10)}
      ~
      ${p.endStr.slice(5,7)}/${p.endStr.slice(8,10)}
    </button>`;
  });

  html += `</div>
    <button class="qdp-close-btn" onclick="closeQuickDatePicker()">取消</button>`;

  body.innerHTML = html;
  ov.classList.add('show');
};

window.qdpPickPayPeriod = function(startStr) {
  // startStr = YYYY-MM-DD
  const [y, m, d] = startStr.split('-').map(Number);
  S.histNavDate = new Date(y, m - 1, d, 12, 0, 0);
  S.histPage = 1;
  closeQuickDatePicker();
  renderHistory();
};

// 輔助功能：展開/收起列表
window.toggleHistList = function() {
  S.histShowList = !S.histShowList;
  renderHistory();
};
// 輔助功能：渲染列表卡片 (提取原本的 group 邏輯)
function renderCardList(items, startIndex = 0) {
  if (items.length === 0) return `<div class="empty-tip">✨ 目前無行程記錄</div>`;
  let html = '';
  let cursor = 0;
  let no = startIndex; // 第 2 頁會是 10、20…

  while (cursor < items.length) {
    let currentDate = items[cursor].date;
    let group = [];
    while (cursor < items.length && items[cursor].date === currentDate) {
      group.push(items[cursor]);
      cursor++;
    }
    if (group.length > 1) {
      html += `<div class="rec-group-wrapper" data-hist-date="${currentDate}"><div class="rec-group-line"></div>${
        group.map(r => {
          no++;
          return `<div style="position:relative;margin-bottom:8px;"><div class="rec-node"></div>${buildRecItem(r, no)}</div>`;
        }).join('')
      }</div>`;
    } else {
      no++;
      html += `<div style="margin-bottom:8px;" data-hist-date="${currentDate}">${buildRecItem(group[0], no)}</div>`;
    }
  }
  return html;
}

// 分頁處理
window.changeHistPage = function(dir) {
  S.histPage += dir;
  renderHistory();
  document.getElementById('hist-content').scrollTop = 0;
};

function openFullCalendar() { document.getElementById('full-calendar-overlay').classList.add('show'); renderFullCalendar(); }
function closeFullCalendar() { document.getElementById('full-calendar-overlay').classList.remove('show'); }
function changeFullCalMonth(offset) { S.calM += offset; if(S.calM < 1) { S.calM = 12; S.calY--; } if(S.calM > 12) { S.calM = 1; S.calY++; } renderFullCalendar(); S.selDate=`${S.calY}-${pad(S.calM)}-01`; renderHistory(); }

/* ══ 修正：全螢幕日曆選盤等待 ✔ 邏輯 ══ */
window.handleFullCalBlur = function() {
  if (S.tempDateValue) {
    const [newY, newM] = S.tempDateValue.split('-');
    S.calY = parseInt(newY);
    S.calM = parseInt(newM);
    S.selDate = `${S.calY}-${pad(S.calM)}-01`;
    S.tempDateValue = null;

    setTimeout(() => {
      renderFullCalendar();
      renderHistory();
    }, 100);
  }
};

/* ══ 全螢幕大日曆 (修復排版 + 收入熱力圖設計) ══ */
function renderFullCalendar() {
  const { calY:y, calM:m } = S;

  // 定義樣式組件
  const styleNum = (val) => `<span style="font-size:20px;font-weight:900;color: #006eff;font-family:var(--mono);vertical-align:middle;margin-bottom:2px;">${val}</span>`;
  const styleUnit = (txt) => `<span style="font-size:13px;font-weight:800;color: #000;margin:8px 4px 0 2px;vertical-align:middle;">${txt}</span>`;
  
  // 1. 渲染頂部年月選擇器
  document.getElementById('fc-title').innerHTML = `
    <div style="position:relative; display:inline-block;">
      <span style="display:flex;flex-direction:row;cursor:pointer; align-items:center;align-content: center;justify-content:center; gap:4px;">
        ${styleNum(y)}${styleUnit(' 年 ')}${styleNum(m)}${styleUnit(' 月 ')} <span style="color:#000;font-size:12px;font-weight:900;vertical-align:middle;">▼</span>
      </span>
      <input type="month" value="${y}-${pad(m)}" onchange="S.tempDateValue=this.value" onblur="handleFullCalBlur()" style="position:absolute; top:0; left:0; width:100%; height:100%; opacity:0; cursor:pointer;">
    </div>`;
    
  const DOW = ['週日','週一','週二','週三','週四','週五','週六']; 
  document.getElementById('fc-dow').innerHTML = DOW.map(d => `<div class="fc-dow-cell">${d}</div>`).join('');
  
  const grid = document.getElementById('fc-grid'); 
  const first = new Date(y, m-1, 1).getDay(); 
  const days = new Date(y, m, 0).getDate(); 
  const today = todayStr();
  
  let html = ``; 
  const prevDays = new Date(y, m-1, 0).getDate();
  
  // 填補上個月的空白格
  for (let i=first-1; i>=0; i--) { 
    html += `<div class="fc-cell empty"><div class="fc-date">${pad(prevDays - i)}</div></div>`; 
  }
  
  // 2. 渲染當月格子 (導入收入熱力圖邏輯)
  for (let day=1; day<=days; day++) {
    const ds  = `${y}-${pad(m)}-${pad(day)}`; 
    const sum = getDayRecs(ds).reduce((s,r)=>s+recTotal(r), 0); 
    const isToday = ds === today;
    
    let cls = 'fc-cell'; 
    if(isToday) cls+=' today';
    
    let contentHtml = `<div class="fc-date">${pad(day)}</div>`;
    
    // 👇 根據收入多寡，賦予不同的背景色層級 (熱力圖概念)
    if(sum > 0) {
      cls += ' has-income';
      
      let levelStyle = '';
      let textColor = '#ffffff';
      
      if (sum < 1000) {
        // 等級 1：0 ~ 999 (淺藍色)
        levelStyle = 'background: #bfdbfe; border: 1.5px solid #93c5fd;';
        textColor = '#1d4ed8'; // 深藍字
      } else if (sum < 1600) {
        // 等級 2：1000 ~ 1599 (翠綠色)
        levelStyle = 'background: #34d399; border: 1.5px solid #10b981;';
        textColor = '#ffffff';
      } else if (sum < 2400) {
        // 等級 3：1600 ~ 2399 (活力橘)
        levelStyle = 'background: #fb923c; border: 1.5px solid #f97316;';
        textColor = '#ffffff';
      } else if (sum < 3000) {
        // 等級 4：2400 ~ 2999 (熱情紅)
        levelStyle = 'background: #ef4444; border: 1.5px solid #dc2626;';
        textColor = '#ffffff';
      } else {
        // 等級 5：3000 以上 (爆單尊貴紫帶陰影)
        levelStyle = 'background: #a855f7; border: 1.5px solid #7e22ce; box-shadow: 0 2px 8px rgba(168, 85, 247, 0.4);';
        textColor = '#ffffff';
        contentHtml += `<div style="position:absolute; top:2px; right:2px; font-size:18px;">🔥</div>`; // 爆單火焰小圖示
      }

      contentHtml += `
        <div class="fc-amt" style="${levelStyle} color:${textColor}; padding:2px 4px; border-radius:6px; font-weight:800; text-shadow:none; margin-top:auto;">
          ${fmt(sum)}
        </div>`;
    }
    html += `<div class="${cls}" style="position:relative; display:flex; flex-direction:column;">${contentHtml}</div>`;
  }
  
  // 填補下個月的空白格
  const totalCells = first + days; 
  const remain = totalCells % 7 === 0 ? 0 : (Math.ceil(totalCells/7)*7) - totalCells;
  for (let i=1; i<=remain; i++) { 
    html += `<div class="fc-cell empty"><div class="fc-date">${pad(i)}</div></div>`; 
  }
  
  grid.innerHTML = html;
}

/* ══ 修正：當日總計卡片的日期視覺化 (套用相同藍大黑小設計) ══ */
function renderHistRecords(ds) {
  const d = new Date(ds+'T00:00:00'); 
  const dow = ['日','一','二','三','四','五','六'][d.getDay()];
  document.getElementById('hist-day-label').textContent = `${d.getMonth()+1} 月 ${d.getDate()} 日（星期${dow}）記錄`;
  
  const recs = getDayRecs(ds); 
  const total = recs.reduce((s,r)=>s+recTotal(r), 0); 
  const cashTips = recs.filter(r=>r.isCashTip).reduce((s,r)=>s+pf(r.cashTipAmt), 0);
  const sumEl = document.getElementById('hist-day-summary');
  
  if (total > 0 || cashTips > 0) {
    const orders = recs.reduce((s,r)=>s+pf(r.orders), 0); 
    const mileage = recs.reduce((s,r)=>s+pf(r.mileage), 0); 
    const hours = calcTotalHours(recs); 
    const dayBonus = recs.reduce((s,r)=>s+pf(r.bonus), 0); 
    const dayTemp = recs.reduce((s,r)=>s+pf(r.tempBonus), 0); 
    const dayTips = recs.reduce((s,r)=>s+pf(r.tips), 0);
    
    // 👇 --- 核心修改：定義與導航列相同的樣式組件 ---
    // (稍微縮小一點點以適應卡片寬度，設定為 22px 與 12px)
    const styleNum = (val) => `<span style="font-size: 17px; font-weight: 900; color: #006eff; font-family: var(--mono); vertical-align: middle;">${val}</span>`;
    const styleUnit = (txt) => `<span style="font-size: 12px; font-weight: 800; color: #000000; margin: 0 1px; vertical-align: middle;"> ${txt} </span>`;
    
    // 產生格式化日期 HTML
    const styledDStr = `${styleNum(d.getFullYear())}${styleUnit('年')}${styleNum(d.getMonth()+1)}${styleUnit('月')}${styleNum(d.getDate())}${styleUnit('日')}`;
    // ---------------------------------------------

    let sumHtml = total > 0 ? buildSummaryCard('當日', total, orders, mileage, hours, dayBonus, dayTemp, dayTips, 'hist-day-card', styledDStr) : '';
    
    if (cashTips > 0) {
      sumHtml += `
        <div style="display: flex; align-items: stretch; border-radius: 12px; border: 2px solid #22c55e; overflow: hidden; margin: 4px 0px;">
          <div style="background: #1fa550; padding: 3px 12px; flex: 1; display:flex; align-items:center;">
            <span style="font-size:14px; font-weight:750; color:#ffffff; letter-spacing:0.5px;">當日現金小費 <span style="font-size:12px; font-weight:700;">(不計入總收入)</span></span>
          </div>
          <div style="background: #ffffff; padding: 3px 16px; display:flex; align-items:center;">
            <span style="font-family:var(--mono); font-size:18px; font-weight:800; color:#16a34a;"><span style="font-size:10px;">$</span> ${fmt(cashTips)}</span>
          </div>
        </div>`;
    }
    sumEl.innerHTML = sumHtml;
  } else { 
    sumEl.innerHTML = ''; 
  }
  
  const listEl = document.getElementById('hist-rec-list');
  if (!recs.length) { 
    listEl.innerHTML = `<div class="empty-tip">✨ 這天沒有記錄</div>`; 
    return; 
  }
  listEl.innerHTML = recs.slice().sort((a,b)=>(a.time||'').localeCompare(b.time||'')).map(r => buildRecItem(r)).join('');
}

/* ══ 修正：記錄詳情彈窗 (修復刪除與編輯按鈕失效問題) ══ */
function openDetailOverlay(id) {
  const r = S.records.find(r => r.id === id); 
  if (!r) return;
  
  const plat = getPlatform(r.platformId); 
  const total = recTotal(r);
  
  const isOnline = r.isPunchOnly && r.punchOut === '';
  const punchDisplay = r.punchIn ? (r.punchOut ? `${safeText(r.punchIn)} → ${safeText(r.punchOut)}` : `${safeText(r.punchIn)} → <span style="color:var(--green); font-weight:800;">上線中</span>`) : '—';
  const hourDisplay = isOnline ? '<span style="color:var(--green); font-weight:800;">計時中...</span>' : (r.hours > 0 ? fmtHours(r.hours) : '—');

  const rows = [ 
    ['🏪 平台', `<span style="color:${plat.color};font-weight:600">${safeText(plat.name)}</span>`], 
    ['📆 日期', safeText(r.date)], 
    ['⏱ 打卡', punchDisplay], 
    ['🕐 工時', hourDisplay], 
    ['📦 接單數', r.orders > 0 ? `${r.orders} 單` : '—'], 
    ['🛣️ 行駛里程', r.mileage > 0 ? `${r.mileage} km` : '—'], 
    ['💰 行程收入', `NT$ ${fmt(r.income)}`], 
    ['🎁 固定獎勵', r.bonus > 0 ? `NT$ ${fmt(r.bonus)}` : '—'], 
    ['⚡ 臨時獎勵', r.tempBonus > 0 ? `NT$ ${fmt(r.tempBonus)}` : '—'], 
    ['🤑 小費', r.tips > 0 ? `NT$ ${fmt(r.tips)}` : '—'], 
    ['📝 備註', r.note ? safeTextWithBr(r.note) : '—'] 
  ];

  let html = `
    <div style="text-align:center; padding:10px 0 16px; border-bottom:1px solid var(--border)">
      <div style="font-size:13px; color:var(--t3); margin-bottom:4px">本筆總收入</div>
      <div style="font-family:var(--mono); font-size:38px; font-weight:700; color:var(--green)">NT$ ${fmt(total)}</div>
    </div>
    <div style="margin-top:12px">
      ${rows.map(([l, v]) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border)">
          <span style="font-size:12px; color:var(--t3)">${l}</span>
          <span style="font-size:13px; font-weight:500">${v}</span>
        </div>`).join('')}
    </div>
    <div style="display:flex; gap:8px; margin-top:16px;">
      <button onclick="closeDetailOverlay(); openAddPage(S.records.find(x=>x.id==='${r.id}'))" style="flex:1; padding:12px; border-radius:var(--rs); background:var(--acc-d); color:var(--acc); border:1px solid rgba(255,107,53,.3); font-size:14px; cursor:pointer; font-weight:600">✎ 編輯</button>
      <button onclick="deleteRecord('${r.id}')" style="flex:1; padding:12px; border-radius:var(--rs); background:var(--red-d); color:var(--red); border:1px solid rgba(239,68,68,.3); font-size:14px; cursor:pointer; font-weight:600">🗑 刪除</button>
    </div>`;

  const ov = document.getElementById('detail-overlay');
  const box = document.getElementById('detail-box');
  document.getElementById('detail-body').innerHTML = html;

  // 🌟 準備開啟時的初始透明度與位置
  ov.style.opacity = '0';
  if (box) {
    box.style.transform = 'translate3d(0, 100%, 0) scale(0.96)';
    box.style.opacity = '0.5';
  }

  ov.classList.add('show');

  // 雙重幀動畫確保觸發流暢滑入
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ov.style.opacity = '1';
      ov.style.transition = 'opacity 0.25s ease-out';
      if (box) {
        box.style.transition = 'transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.15), opacity 0.25s ease-out';
        box.style.transform = 'translate3d(0, 0, 0) scale(1)';
        box.style.opacity = '1';
      }
    });
  });
}
async function deleteRecord(id) { closeDetailOverlay(); const ok = await customConfirm('確定要<span style="color:var(--red);"> 刪除 </span>這筆記錄嗎？<br><span style="color:var(--text-blue);font-weight:700;">此動作無法復原。</span>'); if (!ok) return; S.records = S.records.filter(r=>r.id!==id); saveRecords(); toast('已刪除'); if (S.tab==='home') renderHome(); if (S.tab==='history') renderHistory(); }

/* ══ 替換：搜尋功能 (保留快速標籤點擊與過濾，新增動態年份區間) ══ */
function openSearch() { 
  openOverlay('search-page');

  // 動態生成「年份快速選擇」標籤 (自動抓取記錄中的所有年份)
  let yearContainer = document.getElementById('dynamic-year-tags');
  if (!yearContainer) {
    // 安全地將年份按鈕區塊插入到搜尋結果列表的「正上方」
    const resultsDiv = document.getElementById('search-results');
    if (resultsDiv) {
      yearContainer = document.createElement('div');
      yearContainer.id = 'dynamic-year-tags';
      yearContainer.innerHTML = `
        <div style="color:#0083FF;font-size:14px;font-weight:700;margin-bottom:4px;margin-top:6px;">📅 快速選擇(全年區間)</div>
        <style>.hide-scroll-bar::-webkit-scrollbar { display: none; }</style>
        <div id="year-btn-wrap" class="hide-scroll-bar" style="display:flex; gap:8px; overflow-x:auto; padding-bottom:4px; margin-bottom:5px;border-bottom:2px solid #0083FF;"></div>
      `;
      resultsDiv.parentNode.insertBefore(yearContainer, resultsDiv);
    }
  }

  // 抓取記錄中含有的所有年份並渲染按鈕
  if (yearContainer) {
    let years = new Set();
    S.records.forEach(r => { if(r.date) years.add(r.date.substring(0,4)); });
    let yearArr = Array.from(years).sort((a,b) => b.localeCompare(a)); // 由大到小排列

    const wrap = document.getElementById('year-btn-wrap');
    if (wrap) {
      if (yearArr.length > 0) {
        wrap.innerHTML = yearArr.map(y =>
          `<div onclick="setSearchYear('${y}', this)" class="year-quick-btn" style="flex-shrink:0; padding:6px 16px; background:#f1f5f9; color:#475569; border:1.5px solid #cbd5e1; border-radius:12px; font-size:14px; font-family:var(--mono); font-weight:900; cursor:pointer; box-shadow:0 2px 4px rgba(0,0,0,0.02); transition:0.2s;">${y} 年</div>`
        ).join('');
      } else {
        wrap.innerHTML = '';
      }
    }
  }

  setTimeout(() => { document.getElementById('search-kw').focus(); }, 350); 
}

// 👇 點擊年份標籤時：自動填入全年的起迄日期並觸發搜尋
window.setSearchYear = function(year, el) {
  // 視覺反饋：將所有按鈕恢復預設，並將當前點擊的按鈕亮起 (藍色)
  document.querySelectorAll('.year-quick-btn').forEach(btn => {
    btn.style.background = '#f1f5f9';
    btn.style.color = '#475569';
    btn.style.borderColor = '#cbd5e1';
  });
  if (el) {
    el.style.background = '#eff6ff';
    el.style.color = '#2563eb';
    el.style.borderColor = '#93c5fd';
  }

  // 自動填入該年度的 1/1 到 12/31
  document.getElementById('search-from').value = `${year}-01-01`;
  document.getElementById('search-to').value = `${year}-12-31`;
  
  // 觸發搜尋
  doSearch();
}

// 點擊標籤時：自動填入輸入框並觸發搜尋
window.setSearchKw = function(kw) {
  document.getElementById('search-kw').value = kw;
  doSearch();
}

function doSearch() {
  const kw = document.getElementById('search-kw').value.trim().toLowerCase(); 
  const from = document.getElementById('search-from').value; 
  const to = document.getElementById('search-to').value; 
  const el = document.getElementById('search-results');
  const countEl = document.getElementById('search-count');
  
  const hasFrom = !!from;
  const hasTo = !!to;
  const hasBothDates = hasFrom && hasTo;
  const hasKw = !!kw;

  // 🌟 第一順位優先判斷：只要 2 個日期都選好了，立刻先檢查「開始是否大於結束」！
  if (hasBothDates && from > to) {
    el.innerHTML = `<div class="empty-tip" style="color: #85898d;">⚠️ 「<span style="color: #28a745;margin:0 4px;">開始日期</span>」<span style="color: #0083FF;font-size:17px;font-weight:800;">不能大於</span>「<span style="color: #ff3131;margin:0 4px;">結束日期</span>」</div>`;
    if (countEl) countEl.style.display = 'none';
    return; // 優先報錯，不需等關鍵字填寫
  }

  // 🌟 第二順位判斷：日期區間合規後，才檢查是否有缺選日期或缺關鍵字
  if (!hasBothDates || !hasKw) {
    let msg = '';
    if (!hasFrom && !hasTo && !hasKw) {
      msg = '請輸入「<span style="color: #0072E3;margin:0 4px;">時間範圍</span>」及「<span style="color: #e83e92;margin:0 4px;">關鍵字</span>」';
    } else if (!hasFrom && !hasTo) {
      msg = '請選擇「<span style="color: #0072E3;margin:0 4px;">時間範圍</span>」';
    } else if (!hasFrom) {
      msg = '請選擇「<span style="color: #28a745;margin:0 4px;">開始日期</span>」';
    } else if (!hasTo) {
      msg = '請選擇「<span style="color: #ff3131;margin:0 4px;">結束日期</span>」';
    } else {
      msg = '請<span style="color: #0072E3;margin:0 10px 0 4px;">輸入關鍵字</span>或<span style="color: #e83e92;margin-left:10px;">點選</span>【<span style="color: #e83e92;margin:0 3px;">關鍵字標籤</span>】';
    }
    
    el.innerHTML = `<div class="empty-tip">${msg}</div>`;
    if (countEl) countEl.style.display = 'none';
    return;
  }

  // 進行過濾（條件全數符合時執行搜尋）
  let recs = S.records.filter(r => { 
    if (r.date < from || r.date > to) return false; 
    
    if (kw === '現金小費' && r.isCashTip) return true;
    if (kw === '線上小費' && !r.isCashTip && !r.isPunchOnly && pf(r.tips) > 0) return true;

    const plat = getPlatform(r.platformId).name.toLowerCase(); 
    return plat.includes(kw) || 
           (r.note||'').toLowerCase().includes(kw) || 
           String(recTotal(r)).includes(kw) || 
           String(r.orders||'').includes(kw); 
  }).sort((a,b) => b.date.localeCompare(a.date));
  
  // 更新搜尋數量膠囊
  if (countEl) {
    countEl.style.display = 'inline-flex';
    countEl.innerHTML = `找到<span style="margin:0 5px;font-family:var(--mono);color: #0072E3;font-size:18px;font-weight:900;letter-spacing:0.9px;">${recs.length}</span>筆`;
  }

  if (!recs.length) { 
    el.innerHTML = `<div class="empty-tip">該時間範圍內，找不到符合「<span style="color:var(--red);margin:0 4px;">${escapeHtml(kw)}</span>」的記錄</div>`; 
    return; 
  }
  
  // 渲染列表內容
  const RENDER_LIMIT = 100;
  let listHtml = '';
  if (recs.length > RENDER_LIMIT) {
    const renderRecs = recs.slice(0, RENDER_LIMIT);
    listHtml = renderRecs.map(r => buildRecItem(r)).join('') + 
      `<div style="text-align:center;font-family:var(--mono);color:var(--red);font-size:16px;font-weight:700;background:#ffe1e1;border-radius:12px;padding:20px 10px;margin-top:8px;">
         ⚠️ 搜尋結果超過<span style="color:#0072E3;margin:0 4px;">${RENDER_LIMIT}</span>筆，僅顯示最新<span style="color:#0072E3;margin:0 4px;">${RENDER_LIMIT}</span>筆記錄。
       </div>`;
  } else {
    listHtml = recs.map(r => buildRecItem(r)).join('');
  }

  // 最下方 (回到最上面) 按鈕
  listHtml += `
    <div style="display:flex;justify-content:center;padding:20px 0 35px 0;">
      <button onclick="scrollSearchToTop()" style="padding:10px 22px;border-radius:20px;border:1.5px solid #cbd5e1;background:#ffffff;color:#2563eb;font-size:16px;font-weight:800;cursor:pointer;box-shadow:0 4px 4px rgba(37,99,235,0.4);display:inline-flex;align-items:center;gap:6px;transition:0.2s;">
        ↑ 回到最上面
      </button>
    </div>
  `;

  el.innerHTML = listHtml;
}
// 🌟 搜尋記錄：回到頂端平滑捲動函式
window.scrollSearchToTop = function() {
  const bodyEl = document.querySelector('#search-page .overlay-body');
  if (bodyEl) {
    bodyEl.scrollTo({ top: 0, behavior: 'smooth' });
  }
};
function resetSearch() {
  document.getElementById('search-kw').value = '';
  document.getElementById('search-from').value = '';
  document.getElementById('search-to').value = '';
  document.getElementById('search-results').innerHTML = `<div class="empty-tip">請輸入「<span style="color: #0072E3;margin:0 4px;">時間範圍</span>」及「<span style="color: #e83e92;margin:0 4px;">關鍵字</span>」</div>`;
  
  const countEl = document.getElementById('search-count');
  if (countEl) countEl.style.display = 'none';

  document.querySelectorAll('.year-quick-btn').forEach(btn => {
    btn.style.background = '#f1f5f9';
    btn.style.color = '#475569';
    btn.style.borderColor = '#cbd5e1';
    btn.classList.remove('on');
  });

  document.querySelectorAll('.search-quick-tag').forEach(btn => {
    btn.classList.remove('on');
  });
}
/* ══ 3. 查看記錄 結束 ════════════════════════════════════ */


/* ══ 4. 新增記錄 開始 ════════════════════════════════════ */
function openAddPage(record=null, prefill={}) {
  // 🌟 [防禦性程式碼]：防止從 Console 呼叫函式繞過權限
  /*
  if (!USER.loggedIn) {
    showLoginRequiredWarning();
    return;
  }
*/
  S.editingId = record ? record.id : null; 
  S.selPlatformId = record ? record.platformId : null;
  document.getElementById('add-page-title').textContent = record ? '編輯記錄' : '新增記錄';
  
  if (record && record.isPunchOnly) {
    switchAddTab('punch', 2);
    document.getElementById('f-pu-date').value = record.date || todayStr();
    document.getElementById('f-pu-in').value = record.punchIn || '';
    document.getElementById('f-pu-out').value = record.punchOut || '';
    
    if (document.getElementById('f-start-km')) document.getElementById('f-start-km').value = record.startKm !== undefined ? record.startKm : ''; 
    if (document.getElementById('f-end-km')) document.getElementById('f-end-km').value = record.endKm !== undefined ? record.endKm : ''; 
    if (document.getElementById('f-mileage')) document.getElementById('f-mileage').value = record.mileage || ''; 
    
    let totalHours = pf(record.hours || 0); 
    let h = Math.floor(totalHours); 
    let m = Math.round((totalHours - h) * 60);
    document.getElementById('f-pu-hrs').value = h > 0 ? h : '0'; 
    document.getElementById('f-pu-min').value = m > 0 ? m : '0';
  } else if (record && record.isCashTip) {
    switchAddTab('cashtip', 1);
    document.getElementById('f-ct-date').value = record.date || todayStr();
    document.getElementById('f-ct-time').value = record.time || nowTime();
    document.getElementById('f-ct-given').value = record.givenAmt || '';
    document.getElementById('f-ct-cost').value = record.costAmt || '';
    document.getElementById('f-ct-amount').value = record.cashTipAmt || '';
    document.getElementById('f-ct-note').value = record.note || '';
  } else {
    switchAddTab('regular', 0);
    const targetDate = record?.date || prefill.date || S.selDate || todayStr(); 
    
    document.getElementById('f-date').value = targetDate;
    document.getElementById('f-ct-date').value = targetDate;
    document.getElementById('f-pu-date').value = targetDate;
    
    document.getElementById('f-time').value = record?.time || nowTime();
    document.getElementById('f-orders').value = record?.orders || ''; 
    document.getElementById('f-income').value = record?.income || '';
    document.getElementById('f-bonus').value = record?.bonus || ''; 
    document.getElementById('f-temp-bonus').value = record?.tempBonus || '';
    document.getElementById('f-tips').value = record?.tips || ''; 
    document.getElementById('f-note').value = record?.note || '';

    // 🌟【新增此 3 列】載入專法報酬相關資料
    if (document.getElementById('f-law-start')) document.getElementById('f-law-start').value = record?.lawStart || '2026-07-20';
    if (document.getElementById('f-law-end')) document.getElementById('f-law-end').value = record?.lawEnd || '2026-08-02';
    if (document.getElementById('f-law-adj-amount')) document.getElementById('f-law-adj-amount').value = record?.lawAdjAmt || '';
  }
  
  renderPlatformChips(); calcAddTotal(); 
  syncTagsUI();

  if (S.addTab === 'expense' || !record) {
    updateExpSubTags(); 
  }

  goPage('add');
}

/* ══ 里程自動計算與警告邏輯 ══ */
window.calcMileage = function() {
  const startEl = document.getElementById('f-start-km');
  const endEl = document.getElementById('f-end-km');
  const mileageEl = document.getElementById('f-mileage');
  const warningEl = document.getElementById('mileage-warning');
  
  if (!startEl || !endEl || !mileageEl) return;
  
  // 只有當初始與結束都有值時，才自動計算
  if (startEl.value !== '' && endEl.value !== '') {
    const start = parseFloat(startEl.value);
    const end = parseFloat(endEl.value);
    const diff = end - start;
    
    // 四捨五入到小數點後兩位，避免浮點數過長
    mileageEl.value = Math.round(diff * 100) / 100;
    
    if (diff < 0) {
      warningEl.style.display = 'block';
      mileageEl.style.color = 'var(--red)';
    } else {
      warningEl.style.display = 'none';
      mileageEl.style.color = 'var(--text-blue)';
    }
  }
}
window.checkManualMileage = function() {
  const val = parseFloat(document.getElementById('f-mileage').value);
  const warningEl = document.getElementById('mileage-warning');
  if (val < 0) {
    warningEl.style.display = 'block';
    warningEl.textContent = '⚠️ 警告：行駛里程為負值！';
    document.getElementById('f-mileage').style.color = 'var(--red)';
  } else {
    warningEl.style.display = 'none';
    document.getElementById('f-mileage').style.color = 'var(--text-blue)';
  }
}
window.clearMileage = function() {
  document.getElementById('f-start-km').value = '';
  document.getElementById('f-end-km').value = '';
  document.getElementById('f-mileage').value = '';
  document.getElementById('mileage-warning').style.display = 'none';
  document.getElementById('f-mileage').style.color = 'var(--text-blue)';
}

/* ══ 替換：新增頁籤切換 (支援 4 個頁籤) ══ */
function switchAddTab(tab, idx) {
  S.addTab = tab;
  // 1. 移動背景滑塊
  const bg = document.getElementById('add-tab-bg');
  bg.style.transform = `translateX(${idx * 100}%)`;
  
  // 2. 設定滑塊顏色
  const colors = {
    regular: 'var(--acc)',
    cashtip: 'var(--green)',
    punch: '#0f766e',
    expense: '#dc2626'
  };
  bg.style.background = colors[tab];

  // 3. 更新按鈕文字顏色 (修正按鈕顏色不變的問題)
  const tabIds = ['btn-add-regular', 'btn-add-cashtip', 'btn-add-punch', 'btn-add-expense'];
  tabIds.forEach((id, i) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.classList.toggle('active', i === idx);
    }
  });

  // 4. 控制「選擇平台」區塊的顯隱 (修正支出花費不應出現平台的問題)
  const platArea = document.getElementById('add-platform-select-area');
  if (platArea) {
    platArea.style.display = (tab === 'expense') ? 'none' : 'block';
  }

  // 5. 顯示對應的表單內容
  ['regular', 'cashtip', 'punch', 'expense'].forEach(t => {
    const el = document.getElementById(`add-form-${t}`);
    if(el) el.style.display = (t === tab ? 'block' : 'none');
  });
  
  if(tab === 'expense' && !S.editingId) {
    document.getElementById('f-exp-date').value = document.getElementById('f-date').value || todayStr();
  }
}

/* ══ 替換：修復小費計算BUG與重置表單功能 ══ */
function calcCashTip() {
  const given = pf(document.getElementById('f-ct-given').value);
  const costStr = document.getElementById('f-ct-cost').value.trim();
  
  // 當應收金額被清空時，自動將小費歸零
  if (costStr === '') {
    document.getElementById('f-ct-amount').value = '';
    return;
  }
  
  const cost = pf(costStr);
  if (given > 0 && cost >= 0 && given >= cost) {
    document.getElementById('f-ct-amount').value = given - cost;
  } else {
    document.getElementById('f-ct-amount').value = '';
  }
}

window.calcPunchHours = function() {
  const inTime = document.getElementById('f-pu-in').value;
  const outTime = document.getElementById('f-pu-out').value;
  if (inTime && outTime) {
    const [h1, m1] = inTime.split(':').map(Number);
    const [h2, m2] = outTime.split(':').map(Number);
    let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (diff < 0) diff += 24 * 60; // 跨夜處理
    
    document.getElementById('f-pu-hrs').value = Math.floor(diff / 60);
    document.getElementById('f-pu-min').value = diff % 60;
  }
}

/* ══ 替換：重置新增記錄表單 (加入清除里程) ══ */
function resetAddForm() {
  const targetDate = S.selDate || todayStr();
  
  document.getElementById('f-date').value = targetDate;
  if (document.getElementById('f-time')) document.getElementById('f-time').value = nowTime();
  
  if (document.getElementById('f-start-km')) document.getElementById('f-start-km').value = '';
  if (document.getElementById('f-end-km')) document.getElementById('f-end-km').value = '';
  if (document.getElementById('f-mileage')) document.getElementById('f-mileage').value = ''; 
  if (document.getElementById('mileage-warning')) {
    document.getElementById('mileage-warning').style.display = 'none';
    document.getElementById('f-mileage').style.color = 'var(--text-blue)';
  }
  
  document.getElementById('f-orders').value = '';
  document.getElementById('f-income').value = '';
  document.getElementById('f-bonus').value = '';
  document.getElementById('f-temp-bonus').value = '';
  document.getElementById('f-tips').value = '';
  document.getElementById('f-note').value = '';
  document.getElementById('add-total-val').textContent = '0';

  // 🌟【新增此 3 列】重置專法報酬欄位回預設值
  if (document.getElementById('f-law-start')) document.getElementById('f-law-start').value = '2026-07-20';
  if (document.getElementById('f-law-end')) document.getElementById('f-law-end').value = '2026-08-02';
  if (document.getElementById('f-law-adj-amount')) document.getElementById('f-law-adj-amount').value = '';
  
  document.getElementById('f-ct-date').value = targetDate;
  document.getElementById('f-ct-time').value = nowTime();
  document.getElementById('f-ct-given').value = '';
  document.getElementById('f-ct-cost').value = '';
  document.getElementById('f-ct-amount').value = '';
  document.getElementById('f-ct-note').value = '';

  if (document.getElementById('f-pu-mileage')) document.getElementById('f-pu-mileage').value = '';
  document.getElementById('f-pu-date').value = targetDate;
  document.getElementById('f-pu-in').value = '';
  document.getElementById('f-pu-out').value = '';
  document.getElementById('f-pu-hrs').value = '';
  document.getElementById('f-pu-min').value = '';
  
  document.getElementById('f-exp-date').value = targetDate;
  document.getElementById('f-exp-amount').value = '';
  document.getElementById('f-exp-note').value = '';
  document.getElementById('f-exp-cat').value = '';
  const tagContainer = document.getElementById('exp-sub-tags');
  if (tagContainer) tagContainer.innerHTML = '';

  // 🌟 清空選取的平台狀態
  S.selPlatformId = null;
  S.editingId = null;
  
  document.querySelectorAll('.w-tag, .ct-tag, .search-quick-tag').forEach(el => el.classList.remove('on'));
  
  if (typeof syncTagsUI === 'function') syncTagsUI(); 

  switchAddTab('regular', 0); 
}

function renderPlatformChips() { 
  const container = document.getElementById('platform-chips'); 
  const active = Array.isArray(S.platforms) ? S.platforms.filter(p=>p.active) : []; 
  
  // 🌟 移除原本自動強預設第一項的邏輯，保持未選擇狀態
  container.innerHTML = active.map(p => 
    `<div class="platform-chip${S.selPlatformId===p.id?' on':''}" style="${S.selPlatformId===p.id?`background:${p.color};border-color:${p.color}`:''}" onclick="selectPlatform('${safeText(p.id)}')"><span>${safeText(p.name)}</span></div>`
  ).join(''); 
}
/* 替換原有的 selectPlatform */
function selectPlatform(id) { 
  S.selPlatformId = id; 
  renderPlatformChips(); 
  calcAddTotal(); // 👈 切換平台時，自動檢查是否有符合的獎勵
}
/* ══ 替換：帶入自動獎勵計算與總額 (支援即時連動更新) ══ */
function calcAddTotal() { 
  calcAutoReward();

  const income = pf(document.getElementById('f-income')?.value); 
  const lawAdj = pf(document.getElementById('f-law-adj-amount')?.value); // 專法調整金額
  const bonus = pf(document.getElementById('f-bonus')?.value); 
  
  const tempBonusStr = document.getElementById('f-temp-bonus')?.value;
  const tempBonus = safeEvalMath(tempBonusStr); 
  
  const tips = pf(document.getElementById('f-tips')?.value); 

  // 將差額調整金額計入淨收入與總金額中
  const total = income + lawAdj + bonus + tempBonus + tips; 
  document.getElementById('add-total-val').textContent = fmt(total); 
}

// 取得獎勵判斷的起迄日期與時間
function getRewardWindow(dStr, r) {
  if (!r.recurring) {
    // 若有設定時間，則回傳時分
    return { 
      start: r.startDate, end: r.endDate,
      startTime: r.startTime || '00:00', endTime: r.endTime || '23:59'
    };
  }
  
  const d = new Date(dStr);
  const day = d.getDay();
  const dWeekDay = day === 0 ? 7 : day;
  
  // 處理特定星期幾的循環 (如熊貓一到三)
  if (r.recurringDays && r.recurringDays.length > 0) {
      let minDay = 7, maxDay = 1;
      r.recurringDays.forEach(dw => { let w = dw === 0 ? 7 : dw; if(w < minDay) minDay = w; if(w > maxDay) maxDay = w; });
      const startD = new Date(d); startD.setDate(d.getDate() - (dWeekDay - minDay));
      const endD = new Date(d); endD.setDate(d.getDate() + (maxDay - dWeekDay));
      return { start: todayStr(startD), end: todayStr(endD), startTime: '00:00', endTime: '23:59' };
  }
  // 傳統整週循環
  const startD = new Date(d); startD.setDate(d.getDate() - dWeekDay + 1);
  const endD = new Date(startD); endD.setDate(startD.getDate() + 6);
  return { start: todayStr(startD), end: todayStr(endD), startTime: '00:00', endTime: '23:59' };
}

// 輔助函式：判斷日期+時間是否在範圍內
function isWithinWindow(testDate, testTime, w) {
  const tD = testDate;
  const tT = testTime || '00:00';
  
  const wStart = w.start;
  const wEnd = w.end;
  const wStartT = w.startTime || '00:00';
  const wEndT = w.endTime || '23:59';
  
  // 組合成 YYYY-MM-DD HH:MM 字串來比對大小最安全
  const testVal = `${tD} ${tT}`;
  const startVal = `${wStart} ${wStartT}`;
  const endVal = `${wEnd} ${wEndT}`;
  
  return testVal >= startVal && testVal <= endVal;
}

/* ══ 自動計算獎勵 (支援精準時間過濾) ══ */
function calcAutoReward() {
  const platId = S.selPlatformId;
  const dStr = document.getElementById('f-date') ? document.getElementById('f-date').value : todayStr();
  const tStr = document.getElementById('f-time') ? document.getElementById('f-time').value : nowTime();
  const curOrders = pf(document.getElementById('f-orders') ? document.getElementById('f-orders').value : 0);
  const bonusEl = document.getElementById('f-bonus');

  if(!platId || !dStr) return;

  if (curOrders <= 0) {
     if (bonusEl.dataset.lastAuto) {
         bonusEl.value = '';
         delete bonusEl.dataset.lastAuto;
         delete bonusEl.dataset.achieved;
     }
     return;
  }

  let totalAutoBonus = 0;
  
  (S.settings.rewards ||[]).forEach(r => {
    if (r.active === false) return;
    if (r.platformId !== platId) return;
    const rWindow = getRewardWindow(dStr, r);
    if (!rWindow) return;
    
    // 確保目前輸入的這筆單，落在這個獎勵的日期與時間區間內
    if (!isWithinWindow(dStr, tStr, rWindow)) return;

    let accum = 0;
    S.records.forEach(rec => {
        if(rec.id === S.editingId || rec.platformId !== platId || rec.isPunchOnly) return;
        // 使用精密比對
        if(isWithinWindow(rec.date, rec.time, rWindow)) accum += pf(rec.orders);
    });
    
    const newTotal = accum + curOrders;
    let achievedBonus = 0;
    let previousHighest = 0;

    (r.tiers ||[]).forEach(t => {
        if(accum >= pf(t.orders)) previousHighest = Math.max(previousHighest, pf(t.amount));
        if(newTotal >= pf(t.orders)) achievedBonus = Math.max(achievedBonus, pf(t.amount));
    });

    if (achievedBonus > previousHighest) {
        totalAutoBonus += (achievedBonus - previousHighest);
    }
  });

  if (totalAutoBonus > 0) {
      const currentAchieved = bonusEl.dataset.achieved;
      if (currentAchieved !== String(totalAutoBonus)) {
          bonusEl.value = totalAutoBonus;
          bonusEl.dataset.lastAuto = totalAutoBonus; 
          bonusEl.dataset.achieved = totalAutoBonus; 
          toast(`🎁 達標！自動帶入獎金差額 $ ${totalAutoBonus}`);
      }
  } else {
      delete bonusEl.dataset.achieved;
  }
}

/* ══ 智慧同步備註標籤 UI 狀態 ══ */
function syncTagsUI() {
  const noteVal = document.getElementById('f-note')?.value || '';
  document.querySelectorAll('.w-tag').forEach(el => {
    const txt = el.textContent.trim();
    if (txt && noteVal.includes(txt)) el.classList.add('on');
    else el.classList.remove('on');
  });

  const ctNoteVal = document.getElementById('f-ct-note')?.value || '';
  document.querySelectorAll('.ct-tag').forEach(el => {
    const txt = el.textContent.trim();
    if (txt && ctNoteVal.includes(txt)) el.classList.add('on');
    else el.classList.remove('on');
  });
}

function addWeatherTag(tag) { 
  const noteEl = document.getElementById('f-note'); 
  if (noteEl.value.includes(tag)) { 
    noteEl.value = noteEl.value.replace(tag, '').replace(/\s{2,}/g, ' ').trim(); 
  } else { 
    noteEl.value = (noteEl.value + ' ' + tag).trim(); 
  }
  syncTagsUI();
}

function addCashTipTag(tag) {
  const noteEl = document.getElementById('f-ct-note'); 
  if (noteEl.value.includes(tag)) { 
    noteEl.value = noteEl.value.replace(tag, '').replace(/\s{2,}/g, ' ').trim(); 
  } else { 
    noteEl.value = (noteEl.value + ' ' + tag).trim(); 
  } 
  syncTagsUI();
}

/* ══ 修正後：新增記錄儲存邏輯 (包含支出花費與自動跳轉) ══ */
async function confirmAddRecord() {
  const checkImg = document.getElementById('add-save-img'); 
  const checkBtn = document.getElementById('add-save-btn');
  if (checkBtn.disabled) return; 

  // 🌟 [新增點擊回饋]
  if (checkImg) checkImg.src = 'images/Check2.png';
  await new Promise(resolve => setTimeout(resolve, 200)); 

  // ... 檢查平台邏輯 ...
  if (!S.selPlatformId && S.addTab !== 'punch' && S.addTab !== 'expense') { 
    if (checkImg) checkImg.src = 'images/Check1.png'; // 失敗換回來
    toast('請先選擇平台'); return; 
  }
  
  // ── 處理 A：支出花費 ── (獨立邏輯，存入 generalExpenses)
  if (S.addTab === 'expense') {
    const amt = pf(document.getElementById('f-exp-amount').value);
    if (amt <= 0) {
      if (checkImg) checkImg.src = 'images/Check1.png';
      toast('⚠️ 請輸入金額');
      return;
    }
    if (!document.getElementById('f-exp-cat').value) {
      if (checkImg) checkImg.src = 'images/Check1.png';
      toast('⚠️ 請選擇支出類別');
      return;
    }
    
    const expDate = document.getElementById('f-exp-date').value || todayStr();
    const expRec = {
      id: S.editingId || newId(),
      date: expDate,
      category: document.getElementById('f-exp-cat').value,
      amount: amt,
      note: document.getElementById('f-exp-note').value.trim()
    };

    checkBtn.disabled = true; 
    runSaveProgress(async () => {
      try {
        if (S.editingId) {
          const idx = S.generalExpenses.findIndex(e => e.id === S.editingId);
          if (idx >= 0) S.generalExpenses[idx] = expRec;
        } else {
          S.generalExpenses.push(expRec);
        }

        await idbSet('generalExpenses', S.generalExpenses);
        localStorage.setItem('delivery_general_expenses', JSON.stringify(S.generalExpenses));

        // 同步年份與月份
        const dateParts = (expRec.date || todayStr()).split('-');
        S.rptY = parseInt(dateParts[0], 10) || new Date().getFullYear();
        S.rptM = parseInt(dateParts[1], 10) || (new Date().getMonth() + 1);
        S.rptExpFilter = '全部';

        // 跳轉到「收入分析 → 淨賺 → 支出總覽」並同步 UI
        S.rptView = 'netProfit';
        S.rptNetMode = 'expense_overview';
        S.rptExpTimeMode = 'month';

        // 同步報表頂部頁籤 UI（淨賺是第 5 個，index=4）
        const rptBg = document.getElementById('rpt-tab-bg');
        if (rptBg) rptBg.style.transform = 'translateX(400%)';
        document.querySelectorAll('#rpt-tabs .slide-btn').forEach((btn, i) => {
          btn.classList.toggle('active', i === 4);
        });
        // 顯示對應內容區塊
        ['overview', 'trend', 'compare', 'top3', 'netProfit'].forEach(v => {
          const el = document.getElementById(`rv-${v}`);
          if (el) el.style.display = (v === 'netProfit' ? '' : 'none');
        });
        const subTabsFixed = document.getElementById('net-profit-sub-tabs-fixed');
        if (subTabsFixed) subTabsFixed.style.display = 'block';

        resetAddForm();
        if (checkImg) checkImg.src = 'images/Check1.png';
        checkBtn.disabled = false;

        goPage('report');
        toast('支出已記錄，並跳轉 ✅');
      } catch (err) {
        console.error('支出儲存失敗:', err);
        if (checkImg) checkImg.src = 'images/Check1.png';
        checkBtn.disabled = false;
        toast('⚠️ 儲存失敗，請重試');
      }
    });
    return;
  }

  // ── 處理 B：原本的其他記錄 (存入 S.records) ──
  let rec = { id: S.editingId || newId(), platformId: S.selPlatformId };

  if (S.addTab === 'punch') {
    const puDate = (document.getElementById('f-pu-date').value || '').trim();
    const puIn = (document.getElementById('f-pu-in').value || '').trim();
    const puOut = (document.getElementById('f-pu-out').value || '').trim();
    const ph = pf(document.getElementById('f-pu-hrs').value);
    const pm = pf(document.getElementById('f-pu-min').value);
    const totalHours = ph + (pm / 60);

    const startKmVal = pf(document.getElementById('f-start-km')?.value);
    const endKmVal = pf(document.getElementById('f-end-km')?.value);
    const mileageVal = pf(document.getElementById('f-mileage')?.value);

    if (!puDate) { if (checkImg) checkImg.src = 'images/Check1.png'; toast('⚠️ 請選擇「打卡日期」'); return; }
    if (!puIn) { if (checkImg) checkImg.src = 'images/Check1.png'; toast('⚠️ 請填寫「上線時間」'); return; }
    if (!puOut) { if (checkImg) checkImg.src = 'images/Check1.png'; toast('⚠️ 請填寫「下線時間」'); return; }
    if (totalHours <= 0) { if (checkImg) checkImg.src = 'images/Check1.png'; toast('⚠️ 總工時，必須大於 0'); return; }

    let existingData = {};
    if (S.editingId) {
      existingData = S.records.find(x => x.id === S.editingId) || {};
    }

    rec = { 
      ...existingData,
      id: S.editingId || newId(),
      platformId: S.selPlatformId || '',
      isPunchOnly: true,
      isCashTip: false,
      date: document.getElementById('f-pu-date').value || todayStr(),
      time: document.getElementById('f-pu-in').value || nowTime(), 
      punchIn: document.getElementById('f-pu-in').value,
      punchOut: document.getElementById('f-pu-out').value,
      hours: totalHours, 
      startKm: startKmVal,
      endKm: endKmVal,
      mileage: mileageVal,
      orders: 0, income: 0, bonus: 0, tempBonus: 0, tips: 0, note: ''
    };
  } else if (S.addTab === 'cashtip') {
    const amt = pf(document.getElementById('f-ct-amount').value);
    if (amt <= 0) { toast('請輸入「現金小費」金額'); return; }
    rec = { ...rec, isCashTip: true, date: document.getElementById('f-ct-date').value, time: document.getElementById('f-ct-time').value, givenAmt: pf(document.getElementById('f-ct-given').value), costAmt: pf(document.getElementById('f-ct-cost').value), cashTipAmt: amt, note: document.getElementById('f-ct-note').value.trim() };
  } else {
    // ── 處理一般行程記錄 ──
    const income = pf(document.getElementById('f-income').value); 
    const lawAdjAmt = pf(document.getElementById('f-law-adj-amount')?.value);
    const bonus = pf(document.getElementById('f-bonus').value); 
    const temp = safeEvalMath(document.getElementById('f-temp-bonus').value); 
    const tips = pf(document.getElementById('f-tips').value);

    if (income + lawAdjAmt + bonus + temp + tips <= 0) { toast('請輸入「收入金額」'); return; }

    const lawStart = document.getElementById('f-law-start')?.value || '2026-07-20';
    const lawEnd = document.getElementById('f-law-end')?.value || '2026-08-02';
    const isSpecialLawAdj = lawAdjAmt > 0 && income === 0 && pf(document.getElementById('f-orders')?.value) === 0;

    rec = { 
      ...rec, 
      isCashTip: false, 
      isSpecialLawAdj,
      date: document.getElementById('f-date').value || todayStr(), 
      time: document.getElementById('f-time').value || nowTime(), 
      hours: 0, 
      orders: pf(document.getElementById('f-orders').value), 
      mileage: 0, 
      income: income + lawAdjAmt, // 將調整金額併入淨行程收入
      lawAdjAmt,
      lawStart,
      lawEnd,
      bonus, 
      tempBonus: temp, 
      tips, 
      note: document.getElementById('f-note').value.trim(), 
      updatedAt: Date.now() 
    };
  }
  
  if (S.editingId) {
    const ok = await customConfirm('是否確認要儲存，修改後的記錄？'); if (!ok) return;
  }

  checkBtn.disabled = true; 
  runSaveProgress(() => {
    if (S.editingId) { 
      const idx = S.records.findIndex(r => r.id === S.editingId); 
      if (idx >= 0) S.records[idx] = rec; 
      toast('記錄「已更新」✅'); 
    } else { 
      S.records.push(rec); 
      toast('已記錄 ✅'); 
    }
    saveRecords(); 
    resetAddForm(); 
    checkImg.src = 'images/Check1.png';
    checkBtn.disabled = false; 

    // 儲存後跳到「查看記錄」頁，並定位到該筆記錄的日期
    if (rec && rec.date) {
      S.selDate = rec.date;
      const parts = rec.date.split('-');
      if (parts.length >= 2) {
        S.calY = parseInt(parts[0], 10);
        S.calM = parseInt(parts[1], 10);
      }
      S.histTab = 'day';
      S.histShowList = true; // 展開當日清單
      // 同步日頁籤 UI
      const histBg = document.getElementById('hist-tab-bg');
      if (histBg) histBg.style.transform = 'translateX(0%)';
      document.querySelectorAll('#page-history .slide-btn').forEach((btn, i) => btn.classList.toggle('active', i === 0));
    }
    goPage('history');
  });
}
/* ══ 4. 新增記錄 結束 ════════════════════════════════════ */


/* ══ 5. 收入分析 開始 ════════════════════════════════════ */
/* ══ 浮水印：範圍與密度自訂版 ══ */
function renderReportWatermark() {
  const oldWM = document.getElementById('rpt-watermark-container');
  if (oldWM) oldWM.remove();

  if (S.tab !== 'report') return;

  // 🌟 修改判定：只要是 true 或 1 或 字串 "true"，都視為「要移除」
  const isRemoved = (
    USER.removeWatermark === true || 
    USER.removeWatermark === 1 || 
    USER.removeWatermark === "true"
  );

  if (!USER.loggedIn || !USER.uid || isRemoved) return;

  const wmContent = `UID: #${USER.uid}`;

  // --- 🎨 參數設定區：在這裡調整範圍與外觀 ---
  const config = {
    parent: document.getElementById('report-scroll-area'), // 👈 指定範圍：改為報表滾動區 (不會擋到導覽列)
    gapX: 190,      // 水平間距 (越小越密)
    gapY: 110,      // 垂直間距 (越小越密)
    angle: -22,     // 旋轉角度
    opacity: 0.15,  // 透明度 (0.1 ~ 0.2 較合適)
    fontSize: '13px',
    offsetTop: -30,  // 距離頂部邊界多少 px 開始畫
    offsetBottom: -30 // 距離底部邊界多少 px 停止 (預留給底部導覽列空間)
  };

  if (!config.parent) return;

  // 建立容器
  const container = document.createElement('div');
  container.id = 'rpt-watermark-container';
  
  // 🌟 關鍵：使用 absolute 讓它只在父層容器內活動
  container.style.cssText = `
    position: absolute; 
    inset: 0; 
    top: ${config.offsetTop}px;
    height: ${config.parent.scrollHeight - config.offsetBottom}px; 
    pointer-events: none; 
    z-index: 9999; 
    overflow: hidden;
  `;

  // 自動計算需要填滿範圍的數量 (網格演算法)
  const containerWidth = config.parent.clientWidth || window.innerWidth;
  const containerHeight = config.parent.scrollHeight || window.innerHeight;
  
  const cols = Math.ceil(containerWidth / config.gapX) + 1;
  const rows = Math.ceil(containerHeight / config.gapY) + 1;

  let html = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // 磚牆式排列：奇數行往右偏移半格，視覺上更均勻
      const shiftX = (r % 2 === 0) ? 0 : config.gapX / 2;
      const left = c * config.gapX + shiftX;
      const top = r * config.gapY;

      html += `
        <span class="wm-item" style="
          position: absolute; 
          left: ${left}px; 
          top: ${top}px; 
          color: rgba(0,0,0,${config.opacity}); 
          transform: translate(-50%, -50%) rotate(${config.angle}deg); 
          font-family: var(--mono, monospace); 
          font-weight: 900; 
          font-size: ${config.fontSize}; 
          white-space: nowrap; 
          user-select: none;
        ">
          ${wmContent}
        </span>
      `;
    }
  }

  container.innerHTML = html;
  config.parent.appendChild(container); // 👈 將它塞入滾動區域
}
// 螢幕轉向或視窗大小改變時，重新排列浮水印，避免留白或超出畫面
window.addEventListener('resize', () => {
  if (document.getElementById('rpt-watermark-container') && S.tab === 'report') renderReportWatermark();
});

/* ══ 修正：確保收入分析頁面可正常捲動 ══ */
function renderReport() {
  const reportPage = document.getElementById('page-report');
  
  // 1. 移除舊浮水印
  const oldContainer = document.getElementById('rpt-watermark-container');
  if (oldContainer) oldContainer.remove();

  // 2. 注入平鋪浮水印（改用 DOM 元素排版，見上方 renderReportWatermark）
  renderReportWatermark();

  // 2. 處理原本的捲軸邏輯
  const scrollArea = document.getElementById('report-scroll-area');
  if (scrollArea) {
    scrollArea.style.overflowY = 'auto';
    scrollArea.style.display = 'block';
  }
  
  // 👈 [修正] S.trendMode 之前沒有預設值，導致剛進入「月趨勢」還沒點過任何頁籤時，
  // navTrend() 裡的切換邏輯抓不到符合的模式、日期完全不會變化（見 navTrend 內的說明）
  if (!S.trendDate) S.trendDate = new Date();
  if (!S.trendMode) S.trendMode = 'month';
  if (S.rptView === 'overview') renderRptOverview(); 
  if (S.rptView === 'trend') renderRptTrend();
  if (S.rptView === 'compare') renderRptCompare(); 
  if (S.rptView === 'top3') renderRptTop3();
  if (S.rptView === 'netProfit') renderRptNetProfit();
}
// 專屬年總覽的年份切換器
window.navRptYear = function(dir) {
  S.rptY += dir;
  renderReport();
}




/* ══════════════════════════════   訂單計時模組（修正穩定版） ══════════════════════════════ */
const OT_KEYS = { trips: 'delivery_order_trips', wage: 'delivery_law_hourly_wage' };
const OT_DEFAULT_WAGE = 245;

// 1. 初始化環境
if (!S.otViewDate) S.otViewDate = todayStr();
if (!S.lawHourlyWage) S.lawHourlyWage = pf(localStorage.getItem(OT_KEYS.wage)) || OT_DEFAULT_WAGE;

// 確保資料載入且不會在記憶體更新時被舊 LocalStorage 資料覆蓋
window.__orderTripsLoaded = false;

function loadOrderTrips() {
    try {
        const raw = localStorage.getItem(OT_KEYS.trips);
        const parsed = raw ? JSON.parse(raw) : [];
        S.orderTrips = Array.isArray(parsed) ? parsed : [];
    } catch(e) {
        S.orderTrips = [];
    }
    window.__orderTripsLoaded = true;
}

function ensureOrderTripsLoaded() { 
    if (!window.__orderTripsLoaded || !Array.isArray(S.orderTrips)) {
        loadOrderTrips();
    }
}

function saveOrderTrips() { 
    localStorage.setItem(OT_KEYS.trips, JSON.stringify(S.orderTrips)); 
}

// 依日期重新編排行程序號（新增/刪除後呼叫）
function reindexOrderTrips() {
    ensureOrderTripsLoaded();
    const groups = {};
    S.orderTrips.forEach(t => { (groups[t.date] = groups[t.date] || []).push(t); });
    Object.values(groups).forEach(list => {
        list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        list.forEach((t, i) => { t.tripNo = i + 1; });
    });
    saveOrderTrips();
}

function calcOrderDurationMs(order) {
    if (!order || !order.startTs) return 0;
    return order.status === 'running' ? Date.now() - order.startTs : (pf(order.endTs) - pf(order.startTs) || 0);
}

// 計算專法薪資（30秒四捨五入進位制 + 11分鐘內保底 45 元）
function calcLawPay(durationMs) {
    if (!durationMs || durationMs <= 0) return 0;

    // 1. 計算總秒數，並依「未滿 30 秒不計，30 秒(含)以上以 1 分鐘計」規則轉換
    const totalSecs = Math.floor(durationMs / 1000);
    let roundedMins = Math.floor(totalSecs / 60);
    if (totalSecs % 60 >= 30) {
        roundedMins += 1;
    }

    // 未滿 30 秒不計，分鐘數為 0 則不給薪
    if (roundedMins <= 0) return 0;

    // 2. 依進位後的分鐘數計算專法薪資
    const calculatedPay = Math.round((roundedMins / 60) * S.lawHourlyWage);

    // 3. 11 分鐘 (含) 以內，最低保底金額為 45 元
    if (roundedMins <= 11) {
        return Math.max(45, calculatedPay);
    }

    return calculatedPay;
}

// 將毫秒格式化為計時器顯示文字 (HH:MM:SS 或 MM:SS)
function fmtOrderTimer(ms) {
    const totalSec = Math.max(0, Math.floor((ms || 0) / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// 切換「總編輯」模式（預設為 false 關閉，隱藏所有刪除按鈕）
window.toggleOtEditMode = function() {
    S.otEditMode = !S.otEditMode;
    updateOtUI();
    toast(S.otEditMode ? '已開啟 ✅' : '已關閉 🔴',500);
};

// 格式化總工時（未滿 1 小時顯示 MM:SS，滿 1 小時顯示 HH:MM:SS）
function fmtTotalWorkTime(ms) {
    if (!ms || ms <= 0) return '0';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;

    if (h > 0) {
        return `${pad(h)}:${pad(m)}:${pad(s)}`;
    }
    return `${pad(m)}:${pad(s)}`;
}

// 🌟 訂單計時：即時更新總覽數據 (含各平台單數看板)
function updateOtSummaryStats() {
    const viewDate = S.otViewDate || todayStr();
    const dayTrips = (S.orderTrips || []).filter(t => t.date === viewDate);

    let tMs = 0, tInc = 0, tLaw = 0, totalDayOrders = 0;
    const platOrderCounts = {};

    dayTrips.forEach(t => {
        const pId = t.platformId;
        const orders = [t.main, ...(t.bundled || []), ...(t.midway || [])].filter(Boolean);
        const count = orders.length;

        platOrderCounts[pId] = (platOrderCounts[pId] || 0) + count;
        totalDayOrders += count;

        orders.forEach(o => {
            const amount = Number(o.amount);
            tInc += Number(pf(amount));

            if (o.status === 'done') {
                if (!o.startTs) return;
                const span = (o.endTs ?? Date.now()) - o.startTs;
                tLaw += Number(pf(o.lawPay ?? calcLawPay(span)));
            }
        });

        const doneOrders = orders.filter(o => o.status === 'done' && o.startTs && o.endTs);
        if (doneOrders.length > 0) {
            const minStart = Math.min(...doneOrders.map(o => o.startTs));
            const maxEnd = Math.max(...doneOrders.map(o => o.endTs));
            if (maxEnd > minStart) {
                tMs += (maxEnd - minStart);
            }
        }
    });

    // 使用 querySelectorAll 同步更新主畫面與全螢幕的所有數據
    document.querySelectorAll('.ot-summary-total-orders, #ot-summary-total-orders').forEach(el => {
        el.textContent = totalDayOrders;
    });

    document.querySelectorAll('.ot-summary-plat-orders, #ot-summary-plat-orders').forEach(platOrdersEl => {
        const activePlats = (S.platforms || []).filter(p => p.active);
        platOrdersEl.innerHTML = activePlats.map(p => {
            const count = platOrderCounts[p.id] || 0;
            const color = p.color || '#3b82f6';
            return `
                <div style="display:flex;align-items:center;background:#fff;border:2px solid ${color}70;border-radius:10px;padding:3px 6px;gap:7px;">
                    <span style="font-size:13px;font-weight:800;color:${color};">${safeText(p.name)}</span>
                    <span style="font-family:var(--mono);font-size:18px;font-weight:900;color:#4da6ff;">${count}<span style="font-size:10px;font-weight:700;color:#000;margin-left:4px;">單</span></span>
                </div>
            `;
        }).join('');
    });

    document.querySelectorAll('#ot-summary-inc').forEach(incEl => {
        incEl.textContent = "";
        const sp = document.createElement("span");
        sp.style.fontSize = "11px";
        sp.style.marginRight = "3px";
        sp.textContent = "$";
        incEl.appendChild(sp);
        const text = document.createElement("span");
        text.textContent = fmt(tInc);
        incEl.appendChild(text);
    });

    document.querySelectorAll('#ot-summary-ms').forEach(msEl => {
        msEl.textContent = tMs > 0 ? fmtTotalWorkTime(tMs) : '0';
    });

    document.querySelectorAll('#ot-summary-law').forEach(lawEl => {
        lawEl.textContent = "";
        const sp = document.createElement("span");
        sp.style.fontSize = "11px";
        sp.style.marginRight = "3px";
        sp.textContent = "$";
        lawEl.appendChild(sp);
        const text = document.createElement("span");
        text.textContent = fmt(tLaw);
        lawEl.appendChild(text);
    });

    document.querySelectorAll('#ot-summary-diff').forEach(diffEl => {
        const diff = tInc - tLaw;
        diffEl.style.color = diff >= 0 ? '#4ade80' : '#ff2c2c';
        diffEl.textContent = `${diff >= 0 ? '+' : ''}${fmt(diff)}`;
    });
}

// 🌟 2. 背景計時器心跳 (每秒同步更新單單計時 + 頂部總覽卡片)
let orderTimerTicker = null;
function startOrderTimerTicker() {
    if (orderTimerTicker) return;
    orderTimerTicker = setInterval(() => {
        const isOtTab = S.tab === 'home' && S.homeSubTab === 'ordertime';
        const isFsOpen = document.getElementById('order-timer-full-page')?.classList.contains('show');
        if (!isOtTab && !isFsOpen) { clearInterval(orderTimerTicker); orderTimerTicker = null; return; }

        // A. 更新單筆訂單的獨立計時數字
        document.querySelectorAll('[data-order-timer]').forEach(el => {
            const trip = S.orderTrips.find(t => t.id === el.dataset.trip);
            if (!trip) return;
            const order = [trip.main, ...(trip.bundled || []), ...(trip.midway || [])].find(o => o.id === el.dataset.order);
            if (order && order.status === 'running') el.textContent = fmtOrderTimer(calcOrderDurationMs(order));
        });

        // B. 即時更新頂部總覽數據 (全部工時、專法薪資、差額)
        updateOtSummaryStats();
    }, 1000);
}

// 🌟 訂單計時頁面渲染
function getOrderTimerHtml() {
    ensureOrderTripsLoaded();
    const isFs = document.getElementById('order-timer-full-page')?.classList.contains('show');
    const viewDate = S.otViewDate || todayStr();
    const allTrips = S.orderTrips.filter(t => t.date === viewDate).sort((a, b) => (a.tripNo || 0) - (b.tripNo || 0));

    const isEditing = !!S.otEditMode;

    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(allTrips.length / perPage));
    if (!S.otPage || S.otPage < 1) S.otPage = 1;
    if (S.otPage > totalPages) S.otPage = totalPages;
    const startIdx = (S.otPage - 1) * perPage;
    const trips = allTrips.slice(startIdx, startIdx + perPage);

    // 計算當日初始統計
    let tMs = 0, tInc = 0, tLaw = 0, totalDayOrders = 0;
    const platOrderCounts = {};

    allTrips.forEach(t => {
        const pId = t.platformId;
        const orders = [t.main, ...(t.bundled || []), ...(t.midway || [])].filter(Boolean);
        const count = orders.length;

        platOrderCounts[pId] = (platOrderCounts[pId] || 0) + count;
        totalDayOrders += count;

        orders.forEach(o => {
            tInc += pf(o.amount);
            if (o.status === 'done') {
                tLaw += pf(o.lawPay || calcLawPay((o.endTs || Date.now()) - o.startTs));
            }
        });

        const doneOrders = orders.filter(o => o.status === 'done' && o.startTs && o.endTs);
        if (doneOrders.length > 0) {
            const minStart = Math.min(...doneOrders.map(o => o.startTs));
            const maxEnd = Math.max(...doneOrders.map(o => o.endTs));
            if (maxEnd > minStart) {
                tMs += (maxEnd - minStart);
            }
        }
    });

    const activePlats = (S.platforms || []).filter(p => p.active);
    const platChipsHtml = activePlats.map(p => {
        const count = platOrderCounts[p.id] || 0;
        const color = p.color || '#3b82f6';
        return `
            <div style="display:flex;align-items:center;background:#fff;border:2px solid ${color}70;border-radius:10px;padding:3px 6px;gap:7px;">
                <span style="font-size:13px;font-weight:800;color:${color};">${safeText(p.name)}</span>
                <span style="font-family:var(--mono);font-size:18px;font-weight:900;color:#4da6ff;">${count}<span style="font-size:10px;font-weight:550;color:#000;margin-left:4px;">單</span></span>
            </div>
        `;
    }).join('');

    let html = `
    <div style="background:linear-gradient(135deg,#1e293b,#0f172a);border-radius:20px;padding:4px 12px 4px;color:#fff;margin-bottom:-2px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-weight:900;font-size:18px;letter-spacing:1px;">📊 訂單計時總覽</span>
            <div style="display:flex;align-items:center;">
                <div style="display:flex;align-items:center;background:rgba(255,255,255,0.1);border-radius:10px;border:1px solid rgba(255, 255, 255, 0.8);padding:4px 10px;gap:5px;">
                    <span style="font-size:15px;font-weight:750;color:#0083FF;">專法時薪</span>
                    <input type="number" value="${S.lawHourlyWage}" onchange="S.lawHourlyWage=pf(this.value); localStorage.setItem(OT_KEYS.wage, this.value); updateOtUI();" style="width:38px;background:transparent;border:none;color:#fbbf24;font-size:15px;font-weight:800;font-family:var(--mono);text-align:center;letter-spacing:0.8px;">
                </div>
            </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; grid-gap:5px 20px;">
            <div class="ot-stat-box"><div class="lbl">平台總報酬</div><div class="val" id="ot-summary-inc" style="color:#fbbf24;"><span style="font-size:11px;margin-right:3px;">$</span>${fmt(tInc)}</div></div>
            <div class="ot-stat-box"><div class="lbl">全部工時</div><div class="val" id="ot-summary-ms" style="color:#38bdf8;">${tMs > 0 ? fmtTotalWorkTime(tMs) : '0'}</div></div>
            <div class="ot-stat-box"><div class="lbl">專法薪資總額</div><div class="val" id="ot-summary-law" style="color:#4ade80;"><span style="font-size:11px;margin-right:3px;">$</span>${fmt(tLaw)}</div></div>
            <div class="ot-stat-box"><div class="lbl">報酬差額</div><div class="val" id="ot-summary-diff" style="color:${tInc-tLaw>=0?'#4ade80':'#ff2c2c'}">${tInc-tLaw>=0?'+':''}${fmt(tInc-tLaw)}</div></div>
        </div>
    </div>

    <!-- 🌟 各平台單數 (含夾單) 及全部總計看板 (支援全螢幕折疊) -->
    <div style="background:#a0b3d6;border:1.5px solid rgba(255,255,255,0.2);border-radius:14px;padding:2px 10px 4px;margin-top:5px;margin-bottom:5px;">
        <div onclick="toggleOtPlatOrders(this)" style="display:flex;justify-content:flex-start;align-items:center;cursor:pointer;user-select:none;gap:10px;">
            <span style="display:inline;align-items:center;font-size:16px;font-weight:800;color:#1e3a63;padding:2px 1px 2px 20px;">
                <span>📦</span> 今日單數
            </span>

            <div style="display:flex;align-items:center;gap:8px;">
                <div style="display:inline;background:rgba(255, 255, 255, 0.8);border:2px solid rgba(255,255,255,0.15);padding:1px 8px;border-radius:8px;box-shadow:inset 0 1px 4px rgba(0,0,0,0.2);backdrop-filter:blur(4px);font-family:var(--mono);font-size:14px;font-weight:750;color:#f4712a;">
                    <span class="ot-summary-total-orders" style="font-size:19px;font-weight:900;color:#1a4d99;">${totalDayOrders}</span><span style="font-size:10px;font-weight:550;color:#000;margin-left:4px;">單</span>
                </div>
                <!-- 🌟 折疊箭頭按鈕 -->
                <div class="ot-plat-orders-btn" style="display:flex;align-items:center;align-content:center;justify-content:center;font-size:16px;font-weight:900;color: #509dfc;width:27px;height:27px;border-radius:50%;background:var(--sf);border:1.5px solid var(--border);transition:transform 0.3s ease;padding:2px;margin-left:150px;">▼</div>
            </div>
        </div>

        <span style="display:flex;flex-direction:row;border-bottom:2px dashed rgba(255,255,255,0.6);margin:4px 0 -3px 0;"></span>

        <!-- 可折疊的各平台單數清單 -->
        <div class="ot-plat-orders-col" style="max-height:0px; overflow:hidden; transition:max-height 0.35s ease;">
            <div class="ot-summary-plat-orders" style="display:flex;justify-content:space-between;gap:6px;padding-top:8px;margin-top:2px;">
                ${platChipsHtml}
            </div>
        </div>
    </div>

    <div style="display:grid;grid-template-columns:1.5fr 1fr;align-items:center; gap:12px; margin-bottom:12px;">
        <div style="display:flex; align-items:center; justify-content:space-between; background:#fff; border:1.5px solid #e2e8f0; border-radius:18px; padding:3px 6px; box-sizing:border-box; width:100%;">
            <!-- 左切換按鈕 -->
            <button class="btn btn3" onclick="navOtDate(-1)" style="font-size:20px; width:38px; height:38px; cursor:pointer; flex-shrink:0;margin-right:7px;">◀</button>
            
            <!-- 中間日期與▼：點擊開啟統一的快速日期彈窗 -->
            <div onclick="openOtDatePicker()" style="display:inline-flex; align-items:center; justify-content:center; gap:4px; cursor:pointer; flex:1; text-align:center; padding:0 6px;">
              <span style="font-family:var(--mono); font-size:16px; font-weight:900; color:var(--t1); letter-spacing:1px;margin:7px;">${viewDate.replace(/-/g,'/')}</span>
              <span style="color:#94a3b8;font-size:14px;vertical-align:middle;">▼</span>
            </div>
            
            <!-- 右切換按鈕 -->
            <button class="btn btn3" onclick="navOtDate(1)" style="font-size:20px; width:38px; height:38px; cursor:pointer; flex-shrink:0;margin-left:14px;">▶</button>
        </div>
        ${!isFs ? `<button onclick="openAddOrderTripPanel()" style="height:44px;background:var(--acc);border-radius:16px;border:none;color:#fff;font-size:20px;font-weight:800;cursor:pointer;">＋ 新增行程</button>` : ''}
    </div>

    <span style="display:flex;flex-direction:row;border-bottom:2px solid #003366;margin-bottom:4px;"></span>

    <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:8px;">
        <!-- 🌟 一體成型三色膠囊 (上一頁 | 頁數 | 下一頁) -->
        <div style="display:inline-flex;align-items:stretch;border-radius:14px;border:1.5px solid #ffffff;overflow:hidden;background: #ffffff;box-shadow:0 2px 4px rgba(0,0,0,0.4);">
            <!-- 1. 上一頁 (藍色系) -->
            <button onclick="if(${S.otPage}>1) navOtPage(-1)" ${S.otPage<=1?'disabled':''} style="background:${S.otPage<=1?'#f8fafc':'#e0eeff'};color:${S.otPage<=1?'#cbd5e1':'#2563eb'};border:none;padding:6px 14px;font-size:14px;font-weight:800;cursor:${S.otPage<=1?'default':'pointer'};display:flex;align-items:center;transition:0.15s;">
                ◀ 上一頁
            </button>

            <!-- 2. 頁數顯示 (暖橘系) -->
            <div style="background: hsl(33, 100%, 94%);padding:6px 14px;display:flex;align-items:center;font-family:var(--mono);user-select:none;margin:0 1.5px;">
                <span style="font-size:20px;font-weight:900;color: #ff5900;">${S.otPage}</span>
                <span style="font-size:18px;font-weight:900;color:#fdba74;margin:0 4px;">/</span>
                <span style="font-size:14px;font-weight:800;color:#c2410c;">${totalPages}</span>
            </div>

            <!-- 3. 下一頁 (翠綠系) -->
            <button onclick="if(${S.otPage}<${totalPages}) navOtPage(1)" ${S.otPage>=totalPages?'disabled':''} style="background:${S.otPage>=totalPages?'#f8fafc':'#dafbec'};color:${S.otPage>=totalPages?'#cbd5e1':'#16a34a'};border:none;padding:6px 14px;font-size:14px;font-weight:800;cursor:${S.otPage>=totalPages?'default':'pointer'};display:flex;align-items:center;transition:0.15s;">
                下一頁 ▶
            </button>
        </div>

        <button onclick="toggleOtEditMode()" style="
            background:${isEditing ? '#10b981' : '#ffffff'}; 
            color:${isEditing ? '#ffffff' : '#475569'}; 
            border:1.5px solid ${isEditing ? '#10b981' : '#cbd5e1'};
            border-radius:${isEditing ? '12px' : '16px'};
            padding:6px;font-size:13px;font-weight:800;
            cursor:pointer; box-shadow:${isEditing ? '0 4px 2px rgba(16,185,129,0.5)' : '0'}; 
            transition:all 0.2s ease;">
            ${isEditing ? '✅ 完成' : '<span style="display:flex;align-items:center;align-content:center;padding:1px 5px;">✎ 編輯</span>'}
        </button>
        ${!isFs ? `<button onclick="openOrderTimerFullscreen()" style="background:#2563eb;color:#fff;padding:6px;border-radius:12px;border:1.5px solid #f27bc2;font-size:13px;font-weight:800;cursor:pointer;">⤢ 全螢幕</button>` : ''}
    </div>`;

    trips.forEach(trip => {
        const plat = getPlatform(trip.platformId);
        const batchCount = (trip.bundled?.length || 0) + 1;

        const bundledHtml = (trip.bundled || [])
          .map((o, i) => renderCompactOrderRow(trip.id, o, `初始夾單 ${i + 1}`, false, true))
          .join('');
        const midwayHtml = (trip.midway || [])
          .map(o => renderCompactOrderRow(trip.id, o, '中途夾單', true))
          .join('');

        const extrasCount = (trip.bundled?.length || 0) + (trip.midway?.length || 0);
        const hasExtras = !!(bundledHtml || midwayHtml);

        const tripOrders = [trip.main, ...(trip.bundled || []), ...(trip.midway || [])].filter(Boolean);

        const doneOrders = tripOrders.filter(o =>
          o.status === 'done' &&
          o.startTs != null && o.endTs != null &&
          Number.isFinite(Number(o.startTs)) &&
          Number.isFinite(Number(o.endTs))
        );

        let tripLaw = 0;
        let tripDurationMs = 0;

        if (doneOrders.length > 0) {
          doneOrders.forEach(o => {
            const span = Number(o.endTs) - Number(o.startTs);
            const rawLaw = (o.lawPay ?? calcLawPay(span));
            tripLaw += Number(pf(rawLaw));
          });

          const minStart = Math.min(...doneOrders.map(o => Number(o.startTs)));
          const maxEnd = Math.max(...doneOrders.map(o => Number(o.endTs)));
          if (maxEnd > minStart) {
            tripDurationMs = maxEnd - minStart;
          }
        }

        const tripTimeStr = tripDurationMs > 0 ? fmtTotalWorkTime(tripDurationMs) : '0';

        const tripDelBtn = isEditing
            ? `<button onclick="deleteOrderTrip('${trip.id}')" style="background:#fef2f2; color:#ef4444; border:1px solid #fecdd3; width:26px; height:26px; border-radius:50%; cursor:pointer; font-size:14px; font-weight:900; display:flex; align-items:center; justify-content:center; flex-shrink:0;">✕</button>`
            : '';

        html += `
        <div data-trip-card="${trip.id}" style="background:#fff; border:2.5px solid ${plat.color}; border-radius:18px; padding:4px 4px; margin-bottom:12px;">
            <div style="display:grid;grid-template-columns:1fr 1.8fr;align-items:center;margin-bottom:6px;gap:3px;">
                <div style="display:flex; align-items:center; gap:3px;">
                    <span style="background:${plat.color}; color:#fff; padding:2px 6px; border-radius:4px; font-size:15px; font-weight:900;"># ${trip.tripNo}</span>
                    <span style="font-weight:900; font-size:17px; color:var(--t1);">${plat.name}</span>
                </div>
                
                <div style="display:grid;grid-template-columns:1.1fr 0.6fr 0.2fr;align-items:center;gap:4px;justify-content:space-between;">
                    <span style="background:#fff7ed;color: #111110;border:1.5px solid #fdba74;font-size:14px;font-weight:700;padding:2px 1px;border-radius:8px;font-family:var(--mono);display:flex;align-content:center;align-items:center;justify-content:center;">初派<span style="background:#fff7ed;color:var(--text-blue);font-size:18px;font-weight:850;margin:3px;border-radius:50%;width:12px;height:12px;display:flex;align-content:center;align-items:center;justify-content:center;">${batchCount}</span>單：<span style="font-size:11px;font-weight:900;color: #ff5900;margin:3px 5px 0 0;">$</span><span id="ot-main-amt-${trip.id}" style="color:#ff5900;font-size:16px;font-weight:800;">${trip.main.amount}</span>
                    </span>
                    ${hasExtras ? `<button onclick="toggleOrderExtras('${trip.id}', event)" style="background:#e2e8f0;border:2px solid #0a6be9;border-radius:14px;color:var(--t2);font-size:14px;font-weight:900;cursor:pointer;padding:3px 3px;display:inline-flex;align-items:center;gap:4px;align-content:center;-webkit-font-smoothing:antialiased;backface-visibility:hidden;transform:translateZ(0);"><span class="ot-extras-icon" style="font-size:18px;font-weight:900;margin-right:1px;display:inline-block;transition:transform 0.35s cubic-bezier(0.4,0,0.2,1);transform:${trip.extrasOpen ? 'rotate(180deg)' : 'rotate(0deg)'};">▼</span> 夾( ${extrasCount} )</button>` : ''}
                    ${tripDelBtn}
                </div>
            </div>
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:2px 4px;">
                ${renderCompactOrderRow(trip.id, trip.main, '主要訂單')}
                ${hasExtras ? `<div id="ot-midway-${trip.id}" style="max-height:${trip.extrasOpen ? '2000px' : '0'}; overflow:hidden; transition:max-height 0.4s ease;">
                    ${bundledHtml}${midwayHtml}
                </div>` : ''}
            </div>
            
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:3px; padding:0 4px;">           
                <div style="display:flex; align-items:center; gap:8px;">
                    ${!isFs ? `<button onclick="addOrderMidway('${trip.id}')" style="background:#f3e8ff;color:#7c3aed;border:1.5px solid #d8b4fe;border-radius:10px;padding:4px 14px;font-size:13px;font-weight:800;cursor:pointer;">＋ 中途夾單</button></div>` : ''}

                    <div style="background:#eff6ff; color:#1d4ed8; padding:2px 8px; border-radius:8px; border:1px solid #bfdbfe; display:flex; align-items:baseline; gap:3px;">
                        <span style="font-size:12px; color:#64748b; font-weight:700;">總時間：</span>
                        <span style="font-family:var(--mono); font-size:15px; font-weight:900; color:#2563eb;letter-spacing:0.5px;">${tripTimeStr}</span>
                    </div>
                    <div style="background:#f0fdf4; color:#15803d; padding:2px 8px; border-radius:8px; border:1px solid #86efac; display:flex; align-items:baseline; gap:3px;">
                        <span style="font-size:12px; color:#64748b; font-weight:700;">總專法：</span>
                        <span style="font-family:var(--mono); font-size:15px; font-weight:900; color:#16a34a;letter-spacing:0.5px;"><span style="font-size:10px;font-weight:900;margin-right:5px;">$</span>${fmt(tripLaw)}</span>
                    </div>
                </div>
            </div>
        </div>`;
    });
    return html || '<div class="empty-tip" style="padding:40px 0;">無計時記錄</div>';
}

// 🌟 訂單計時：單數看板獨立折疊函式 (支援全螢幕與主畫面相對控制)
window.toggleOtPlatOrders = function(headerEl) {
    if (!headerEl) return;
    const card = headerEl.parentElement;
    const col = card ? card.querySelector('.ot-plat-orders-col') : null;
    const btn = card ? card.querySelector('.ot-plat-orders-btn') : null;

    if (!col || !btn) return;
    if (navigator.vibrate) try { navigator.vibrate(12); } catch(e){}

    requestAnimationFrame(() => {
        if (col.style.maxHeight === '0px' || col.style.maxHeight === '') {
            col.style.maxHeight = col.scrollHeight + 'px';
            btn.style.transform = 'rotate(180deg)';
        } else {
            col.style.maxHeight = '0px';
            btn.style.transform = 'rotate(0deg)';
        }
    });
};

// 渲染單筆訂單（主單／夾單）的精簡列，支援編輯模式動態修改時間
function renderCompactOrderRow(tripId, order, label, isMidway, hideAmount) {
    if (!order) return '';
    const isEditing = !!S.otEditMode;

    const dur = calcOrderDurationMs(order);
    const timeStr = fmtOrderTimer(dur);
    const statusColor = order.status === 'running' ? '#ff6a00' : (order.status === 'done' ? '#0088ff' : '#94a3b8');
    
    const startVal = order.startTs ? new Date(order.startTs).toTimeString().slice(0,5) : '';
    const endVal = order.endTs ? new Date(order.endTs).toTimeString().slice(0,5) : '';

    let actionHtml = '';
    if (order.status === 'idle') {
        actionHtml = `<button onclick="startOrderTimer('${tripId}','${order.id}')" style="background: #ff6a00;color:#fff;border:none;padding:5px 10px;border-radius:8px;font-size:14px;font-weight:800;cursor:pointer;white-space:nowrap;">▶ 開始</button>`;
    } else if (order.status === 'running') {
        actionHtml = `<button onclick="finishOrderTimer('${tripId}','${order.id}')" style="background: #10b981;color:#fff;border:none;padding:5px 10px;border-radius:8px;font-size:14px;font-weight:800;cursor:pointer;white-space:nowrap;">✔ 完成</button>`;
    } else {
        // 🌟 加上 id="ot-lawpay-${order.id}"，以便靜默更新數字
        actionHtml = `<span style="background: #2c3f68;color: #22e96b;font-size:14px;font-weight:650;white-space:nowrap;border-radius:16px;padding:2px 8px;margin-right:3px;"><span style="margin:0 4px 0 1px;">專$</span><span id="ot-lawpay-${order.id}" style="font-weight:750;">${fmt(order.lawPay || 0)}</span></span>`;
    }

    const delHtml = (isMidway && isEditing)
        ? `<button onclick="deleteExtraOrder('${tripId}','${order.id}')" style="background:#fef2f2;color:#ef4444;border:1px solid #fecdd3;width:24px;height:24px;border-radius:50%;font-size:14px;font-weight:900;cursor:pointer;padding:0;flex-shrink:0;display:flex;align-items:center;justify-content:center;">✕</button>`
        : '';

    const amtBg = isMidway ? '#fdf0ff' : '#fff7ed';
    const amtBorder = isMidway ? '#f59eff' : '#fdba74';
    const amtColor = isMidway ? '#e927ff' : '#ff5900';
    const amtSymbolColor = isMidway ? '#e927ff' : '#ff5100';

    const amountHtml = hideAmount ? '' : `<div style="position:relative;display:inline-flex;align-items:center;width:38px;flex:0.35;min-width:30px;">
      <span style="position:absolute;left:4px;bottom:4px;font-size:11px;color:${amtSymbolColor};font-weight:800;font-family:var(--mono);pointer-events:none;z-index:1;${order.amount ? '' : 'display:none;'}">$</span>
      <input type="number" value="${(order.amount || '')}" placeholder="金額" oninput="this.previousElementSibling.style.display = this.value ? 'inline' : 'none';updateOrderField('${tripId}','${order.id}','amount',this.value)" style="width:55px;flex:0.5;background:${amtBg};border:1.5px solid ${amtBorder};border-radius:99px;padding:2px 2px 2px 11px;font-family:var(--mono);color:${amtColor};font-size:15px;font-weight:750;text-align:center;letter-spacing:0.5px;">
    </div>`;

    // 🌟 時間顯示區：編輯模式顯示時間選擇框，非編輯模式顯示純文字
    const timeDisplayHtml = isEditing ? `
      <div style="display:flex; align-items:center; gap:8px; margin-top:4px; padding-left:8px; font-size:12px; font-family:var(--mono);">
        <div style="display:flex; align-items:center; gap:4px; background:#f0fdf4; border:1px solid #bbf7d0; padding:2px 8px; border-radius:8px;">
          <span style="color:#15803d; font-weight:800;">開始</span>
          <input type="time" value="${startVal}" onchange="updateOrderTime('${tripId}','${order.id}','start',this.value)" style="border:none; background:transparent; font-family:var(--mono); font-size:13px; font-weight:900; color:#15803d; outline:none; cursor:pointer;">
        </div>
        <div style="display:flex; align-items:center; gap:4px; background:#fef2f2; border:1px solid #fecdd3; padding:2px 8px; border-radius:8px;">
          <span style="color: #ff2828; font-weight:800;">結束</span>
          <input type="time" value="${endVal}" onchange="updateOrderTime('${tripId}','${order.id}','end',this.value)" style="border:none; background:transparent; font-family:var(--mono); font-size:13px; font-weight:900; color: #ff2828; outline:none; cursor:pointer;">
        </div>
      </div>
    ` : `
      <div style="display:flex; gap:20px; padding-left:12px; margin-top:2px; font-size:14px; font-weight:650; font-family:var(--mono);">
        <span style="color:#16a34a;">開始<span style="color:#000;">〔</span><span style="font-weight:800;margin:0 5px;">${startVal || '--:--'}</span><span style="color:#000;">〕</span></span>
        <span style="color:#ff2e2e;">結束<span style="color:#000;">〔</span><span style="font-weight:800;margin:0 5px;">${endVal || '--:--'}</span><span style="color:#000;">〕</span></span>
      </div>
    `;

    return `
    <div style="padding:3px 0px;border-bottom:1px solid #6ab5ff;">
        <div style="display:flex;align-items:center;gap:4px;">
            <div style="flex-shrink:0;font-size:15px;color:${isMidway ? '#7c3aed' : '#ff50a8'};font-weight:700;width:75px;">${label}</div>
            <input type="text" value="${safeText(order.orderNo || '')}" placeholder="單號" oninput="this.value = this.value.toUpperCase();updateOrderField('${tripId}','${order.id}','orderNo',this.value)" style="width:33px;flex:0.4;min-width:29px;background: #ecfdff;border:1.5px solid #41c5d4;border-radius:12px;padding:2px;font-size:15px;font-family:var(--mono);color:#2563eb;font-weight:600;text-align:center;text-transform:uppercase;letter-spacing:0.5px;">
            ${amountHtml}
            <div data-order-timer data-trip="${tripId}" data-order="${order.id}" style="display:flex;background: #e7f1ff;border:1.5px solid #bfdbfe;border-radius:16px;padding:2px 5px;flex:0.45;justify-content:center;text-align:center;font-family:var(--mono);font-size:15px;font-weight:800;color:${statusColor};">${timeStr}</div>
            ${actionHtml}
            ${delHtml}
        </div>
        ${timeDisplayHtml}
    </div>`;
}

// 4. 行程控制（主要供「中途夾單」點擊 ▶ 開始 時使用）
window.startOrderTimer = function(tripId, orderId) {
    const trip = S.orderTrips.find(t => t.id === tripId);
    if (!trip) return;
    const order = [trip.main, ...(trip.bundled || []), ...(trip.midway || [])].find(o => o?.id === orderId);
    if (!order) return;
    
    // 啟動該筆單計時
    order.status = 'running'; 
    order.startTs = Date.now();
    
    saveOrderTrips(); 
    updateOtUI(); 
    startOrderTimerTicker();
    
    toast('🚀 「中途夾單」，開始計時 ✅');
};

window.finishOrderTimer = async function(tripId, orderId) {
    const trip = S.orderTrips.find(t => t.id === tripId);
    const order = [trip?.main, ...(trip?.bundled || []), ...(trip?.midway || [])].find(o => o?.id === orderId);
    if (order && order.status === 'running') {
        if (!(await customConfirm('確定完成此訂單？'))) return;
        order.status = 'done'; order.endTs = Date.now();
        order.lawPay = calcLawPay(order.endTs - order.startTs);
        saveOrderTrips(); updateOtUI();
    }
};

window.addOrderMidway = function(tripId) {
    const trip = S.orderTrips.find(t => t.id === tripId);
    if (trip) { 
        if (!trip.midway) trip.midway = [];
        trip.midway.push({id:newId(),orderNo:'',amount:0,startTs:null,endTs:null,status:'idle',lawPay:0,isMain:false}); 
        trip.extrasOpen = true; saveOrderTrips(); updateOtUI(); 
    }
};

function updateOtUI() { 
    if (document.getElementById('order-timer-full-page')?.classList.contains('show')) renderFullscreenOrderTimer(); 
    else renderHome(); 
}
window.navOtDate = function(dir) { const d = new Date(S.otViewDate); d.setDate(d.getDate() + dir); S.otViewDate = todayStr(d); S.otPage = 1; updateOtUI(); };
window.navOtPage = function(dir) { S.otPage = (S.otPage || 1) + dir; updateOtUI(); };
window.openOrderTimerFullscreen = function() { document.getElementById('order-timer-full-page').classList.add('show'); renderFullscreenOrderTimer(); };
window.renderFullscreenOrderTimer = function() { document.getElementById('ot-full-body').innerHTML = getOrderTimerHtml(); startOrderTimerTicker(); };

// 🌟 訂單計時：開啟 APP 統一的快速日期選擇彈窗
window.openOtDatePicker = function() {
  const curDate = new Date((S.otViewDate || todayStr()) + 'T00:00:00');
  const curY = curDate.getFullYear();
  const curM = curDate.getMonth() + 1;
  const curD = curDate.getDate();

  openQuickDatePicker({
    mode: 'month',
    year: curY,
    curY: curY,
    curM: curM,
    onSelect: (y, m) => {
      // 防呆：確保選擇新月份時，日期不超過該月最大天數 (例如 2/31 自動修正為 2/28)
      const maxDays = new Date(y, m, 0).getDate();
      const targetD = Math.min(curD, maxDays);
      S.otViewDate = `${y}-${pad(m)}-${pad(targetD)}`;
      S.otPage = 1;
      updateOtUI();
    }
  });
};

// 訂單計時夾單摺疊 (GPU 0 延遲順暢旋轉與展開)
window.toggleOrderExtras = function(tId, event) { 
    if (navigator.vibrate) try { navigator.vibrate(12); } catch(e){}
    const t = S.orderTrips.find(x => x.id === tId); 
    if (!t) return; 

    t.extrasOpen = !t.extrasOpen; 

    const container = document.getElementById(`ot-midway-${tId}`);
    const btnIcon = event?.currentTarget?.querySelector('.ot-extras-icon');

    // 🌟 使用 requestAnimationFrame 避開切頁繪圖高峰，防止箭頭卡住
    requestAnimationFrame(() => {
        if (container) {
            container.style.maxHeight = t.extrasOpen ? '2000px' : '0px';
        }
        if (btnIcon) {
            btnIcon.style.transform = t.extrasOpen ? 'rotate(180deg)' : 'rotate(0deg)';
        }
    });

    saveOrderTrips();
};

window.deleteOrderTrip = function(id) { customConfirm('確定刪除？編號將重排。').then(ok => { if (ok) { S.orderTrips = S.orderTrips.filter(t => t.id !== id); reindexOrderTrips(); updateOtUI(); } }); };
window.deleteExtraOrder = async function(tId, oId) { if (await customConfirm('確定刪除夾單？')) { const t = S.orderTrips.find(x => x.id === tId); if (t) { t.midway = t.midway.filter(o => o.id !== oId); saveOrderTrips(); updateOtUI(); } } };
// 即時更新訂單欄位（靜默存檔，同步連動金額）
window.updateOrderField = function(tId, oId, f, v) { 
    const t = S.orderTrips.find(x => x.id === tId); 
    const o = [t?.main, ...(t?.bundled || []), ...(t?.midway || [])].find(x => x?.id === oId);
    if (o) { 
        if (f === 'orderNo') o.orderNo = v; 
        if (f === 'amount') {
            o.amount = pf(v); 
            // 🌟 即時連動：若修改主要訂單金額，立刻更新卡片上的「初派X單：$金額」
            if (o.isMain) {
                const mainAmtEl = document.getElementById(`ot-main-amt-${tId}`);
                if (mainAmtEl) mainAmtEl.textContent = o.amount;
            }
            // 🌟 即時連動：更新頂部總覽卡片的數據
            if (typeof updateOtSummaryStats === 'function') updateOtSummaryStats();
        }
        if (o.status === 'done') o.lawPay = calcLawPay(calcOrderDurationMs(o)); 
        saveOrderTrips(); // 靜默寫入 LocalStorage 存檔，不刷新 DOM 避免輸入框失去焦點
    }
};

// 🌟 訂單計時：編輯模式下修改時間 (採用靜默更新，防範 iOS 滾輪被強制彈關)
window.updateOrderTime = function(tripId, orderId, type, timeStr, el) {
    const trip = S.orderTrips.find(t => t.id === tripId);
    if (!trip || !timeStr) return;
    const o = [trip.main, ...(trip.bundled || []), ...(trip.midway || [])].find(x => x?.id === orderId);
    if (!o) return;

    const dateStr = trip.date; // 行程日期 YYYY-MM-DD
    const newTs = new Date(`${dateStr}T${timeStr}:00`).getTime();

    if (isNaN(newTs)) return;

    if (type === 'start') {
        o.startTs = newTs;
    } else if (type === 'end') {
        o.endTs = newTs;
    }

    // 當開始與結束時間皆存在時，驗證並計算專法薪資
    if (o.startTs && o.endTs) {
        if (o.endTs >= o.startTs) {
            o.status = 'done';
            o.lawPay = calcLawPay(o.endTs - o.startTs);
        } else {
            toast('⚠️ 結束時間不能小於開始時間');
            return;
        }
    }

    // 1. 靜默寫入 LocalStorage，絕不重繪 DOM，讓 iOS 滾輪順暢關閉
    saveOrderTrips();

    // 2. 靜默更新該列的專法薪資數字
    const lawPayEl = document.getElementById(`ot-lawpay-${orderId}`);
    if (lawPayEl && o.lawPay !== undefined) {
        lawPayEl.textContent = fmt(o.lawPay);
    }

    // 3. 靜默更新頂部總覽卡片 (總工時、專法薪資總額與差額)
    if (typeof updateOtSummaryStats === 'function') {
        updateOtSummaryStats();
    }
};

// 6. 新增行程面板（1.選擇平台[預設無選擇+置中] 2.出發時間 3.一次派幾單 4.主要訂單總金額）
window.openAddOrderTripPanel = function() {
    ensureOrderTripsLoaded();
    const activePlatforms = (S.platforms || []).filter(p => p.active);
    if (!activePlatforms.length) { toast('請先到設定啟用至少一個平台'); return; }

    // 🌟 預設重置為無選擇任何平台
    S.otAddPlatformId = null;

    if (![1,2,3].includes(S.otAddBatchCount)) S.otAddBatchCount = 1;

    document.getElementById('ot-add-trip-overlay')?.remove();

    // 平台按鈕 HTML（預設全未選中）
    const chipsHtml = activePlatforms.map(p => {
        const on = S.otAddPlatformId === p.id;
        const color = p.color || '#2563eb';
        const style = on
            ? `background:${color}; border-color:${color}; color:#ffffff; font-weight:800; box-shadow:0 4px 10px ${color}40;`
            : `background:${color}15; border-color:${color}50; color:${color}; font-weight:800;`;
        return `<div class="platform-chip${on ? ' on' : ''}" data-plat-color="${color}" style="${style}" onclick="selectOtAddPlatform(this,'${p.id}')"><span>${safeText(p.name)}</span></div>`;
    }).join('');

    const batchHtml = [1,2,3].map(n => {
        const on = S.otAddBatchCount === n;
        return `<div class="platform-chip${on ? ' on' : ''}" style="${on ? 'background:var(--acc);border-color:var(--acc);' : ''}flex:1;justify-content:center;" onclick="selectOtAddBatch(this,${n})">${n}單</div>`;
    }).join('');

    const currentTimeStr = nowTime(); // 預設帶入目前時間 (HH:MM)

    const panelHtml = `
    <div id="ot-add-trip-overlay" style="position:fixed;inset:0;z-index:999995;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:flex;align-items:flex-end;" onclick="if(event.target===this) closeAddOrderTripPanel()">
      <div style="background:#ffffff;width:100%;border-radius:28px 28px 0 0;padding:12px 20px calc(24px + env(safe-area-inset-bottom)) 20px;box-shadow:0 -10px 40px rgba(0,0,0,0.15);box-sizing:border-box;max-height:90vh;overflow-y:auto;">
        
        <!-- 頂部把手指示條 -->
        <div style="width:56px;height:4px;background:#cbd5e1;border-radius:2px;margin:0 auto 12px auto;"></div>

        <!-- 標頭區塊 -->
        <div style="display:flex;align-items:center;justify-content:center;;margin-bottom:15px;padding-bottom:10px;border-bottom:1.5px dashed #e2e8f0;">
          <div style="display:flex;align-items:center;">
            <div style="font-size:26px;font-weight:900;color: #0e4fbf;letter-spacing:0.8px;margin:0 70px 0 110px;">建立派單行程</div>
          </div>
          <button onclick="closeAddOrderTripPanel()" class="bar-btn" style="width:32px;height:32px;"><img src="images/close1.png" style="width:100%;height:100%;object-fit:contain;"></button>
        </div>

        <!-- 🌟 步驟 1: 選擇平台 (置中對齊) -->
        <div style="margin-bottom:22px;">
          <div style="font-size:28px;font-weight:800;color:var(--t1);margin-bottom:1px;display:flex;align-items:center;gap:6px;letter-spacing:0.8px;">
            <span style="background:#0284c7;color:#fff;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;">1</span>
            外送平台
          </div>
          <div id="ot-add-platform-chips" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">${chipsHtml}</div>
        </div>

        <!-- 步驟 2: 派單時間 -->
        <div style="margin-bottom:22px;">
          <div style="font-size:28px;font-weight:800;color:var(--t1);margin-bottom:1px;display:flex;align-items:center;gap:6px;letter-spacing:0.8px;">
            <span style="background:#0284c7;color:#fff;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;">2</span>
            派單時間
          </div>
          <div style="position:relative;display:flex;align-items:center;">
            <span style="position:absolute;left:14px;font-size:16px;pointer-events:none;">⏰</span>
            <input id="ot-add-time" type="time" value="${currentTimeStr}" style="width:100%;box-sizing:border-box;border:2px solid #e2e8f0;border-radius:16px;padding:10px 14px 10px 40px;font-size:18px;font-weight:900;font-family:var(--mono, monospace);color:var(--t1);outline:none;background:#f8fafc;cursor:pointer;transition:all 0.2s;" onfocus="this.style.borderColor='#0284c7';this.style.background='#ffffff'" onblur="this.style.borderColor='#e2e8f0';this.style.background='#f8fafc'">
          </div>
        </div>

        <!-- 步驟 3: 一次派幾單 -->
        <div style="margin-bottom:22px;">
          <div style="font-size:28px;font-weight:800;color:var(--t1);margin-bottom:1px;display:flex;align-items:center;gap:6px;letter-spacing:0.8px;">
            <span style="background:#0284c7;color:#fff;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;">3</span>
            一次派幾單？
          </div>
          <div id="ot-add-batch-chips" style="display:flex;gap:8px;">${batchHtml}</div>
        </div>

        <!-- 步驟 4: 金額輸入 -->
        <div style="margin-bottom:32px;">
          <div style="font-size:28px;font-weight:800;color:var(--t1);margin-bottom:1px;display:flex;align-items:center;gap:6px;letter-spacing:0.8px;">
            <span style="background:#0284c7;color:#fff;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;">4</span>
            派單總金額
          </div>
          <div style="position:relative;display:flex;align-items:center;">
            <span style="position:absolute;left:14px;font-size:18px;font-weight:900;color:#0284c7;font-family:var(--mono, monospace);">$</span>
            <input id="ot-add-amount" type="number" placeholder="0" inputmode="decimal" style="width:100%;box-sizing:border-box;border:2px solid #e2e8f0;border-radius:16px;padding:12px 14px 12px 34px;font-size:22px;font-weight:900;font-family:var(--mono, monospace);
              color:var(--green);letter-spacing:1px;outline:none;background:#f8fafc;transition:all 0.2s;" onfocus="this.style.borderColor='#0284c7';this.style.background='#ffffff'" onblur="this.style.borderColor='#e2e8f0';this.style.background='#f8fafc'">
          </div>
        </div>

        <!-- 底部操作按鈕 -->
        <div style="display:flex;gap:12px;margin-bottom:50px;">
          <button onclick="closeAddOrderTripPanel()" style="flex:1;background:#f1f5f9;color:#64748b;border:none;padding:14px;border-radius:16px;font-weight:800;font-size:15px;cursor:pointer;transition:0.2s;">取消</button>
          <button onclick="confirmAddOrderTrip()" style="flex:2;background:linear-gradient(135deg, #0284c7 0%, #0369a1 100%);color:#ffffff;border:none;padding:14px;border-radius:16px;font-weight:900;font-size:15px;cursor:pointer;box-shadow:0 4px 5px rgba(2,132,199,0.5);display:flex;align-items:center;justify-content:center;gap:6px;transition:0.2s;">🚀 新增，並開始計時</button>
        </div>

      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', panelHtml);
};

// 點擊選擇平台 (維持各自平台的專屬色彩)
window.selectOtAddPlatform = function(el, id) {
    S.otAddPlatformId = id;

    // 1. 將所有平台按鈕恢復為「各自平台的專屬未選取顏色」
    document.querySelectorAll('#ot-add-platform-chips .platform-chip').forEach(c => {
        const color = c.dataset.platColor || '#94a3b8';
        c.classList.remove('on');
        c.style.background = color + '15';  // 淡色背景
        c.style.borderColor = color + '50'; // 專屬邊框
        c.style.color = color;              // 專屬文字顏色
        c.style.boxShadow = 'none';
    });

    // 2. 將點選的平台切換為「實心主色 + 亮白字 + 專屬光暈」
    const p = getPlatform(id);
    const color = p.color || '#2563eb';
    el.classList.add('on');
    el.style.background = color;
    el.style.borderColor = color;
    el.style.color = '#ffffff';
    el.style.boxShadow = `0 4px 10px ${color}40`;
};

window.selectOtAddBatch = function(el, n) {
    S.otAddBatchCount = n;
    document.querySelectorAll('#ot-add-batch-chips .platform-chip').forEach(c => {
        c.classList.remove('on'); c.style.background = ''; c.style.borderColor = '';
    });
    el.classList.add('on'); el.style.background = 'var(--acc)'; el.style.borderColor = 'var(--acc)';
};

window.closeAddOrderTripPanel = function() {
    document.getElementById('ot-add-trip-overlay')?.remove();
};

// 🌟 確認新增：自動將選定的出發時間轉為時間戳記，並立即啟動主要訂單與初始夾單計時
window.confirmAddOrderTrip = function() {
    const platformId = S.otAddPlatformId;
    if (!platformId) { toast('請選擇平台'); return; }
    const batchCount = [1,2,3].includes(S.otAddBatchCount) ? S.otAddBatchCount : 1;
    const amount = pf(document.getElementById('ot-add-amount')?.value);
    const timeVal = document.getElementById('ot-add-time')?.value || nowTime();

    ensureOrderTripsLoaded();

    const dateStr = S.otViewDate || todayStr();
    
    // 🌟 精確設定本地當天時間，解決一開始顯示 24:00:00 的問題
    const [h, m] = timeVal.split(':').map(Number);
    const startDateObj = new Date();
    if (!isNaN(h) && !isNaN(m)) {
        startDateObj.setHours(h, m, 0, 0);
    }
    const startTs = startDateObj.getTime();

    // 主要訂單
    const mainOrder = {
        id: newId(),
        orderNo: '',
        amount,
        startTs,
        endTs: null,
        status: 'running', // 立即啟動計時
        lawPay: 0,
        isMain: true
    };

    // 初始夾單
    const bundled = [];
    for (let i = 0; i < batchCount - 1; i++) {
        bundled.push({
            id: newId(),
            orderNo: '',
            amount: 0,
            startTs,
            endTs: null,
            status: 'running', // 同步啟動計時
            lawPay: 0,
            isMain: false
        });
    }

    const trip = {
        id: newId(),
        date: dateStr,
        platformId,
        createdAt: Date.now(),
        tripNo: 0,
        main: mainOrder,
        bundled,
        midway: [],
        extrasOpen: false
    };

    // 1. 推入記憶體
    S.orderTrips.push(trip);
    
    // 2. 重新編排行程序號並寫入 LocalStorage 存檔
    reindexOrderTrips();

    // 3. 自動跳轉到該日期的最後一頁，確保使用者能直接看到新新增的項目
    const currentDayTrips = S.orderTrips.filter(t => t.date === dateStr);
    const perPage = 10;
    S.otPage = Math.max(1, Math.ceil(currentDayTrips.length / perPage));

    // 4. 關閉彈窗並更新畫面
    closeAddOrderTripPanel();
    updateOtUI();
    startOrderTimerTicker();
    toast('🚀 行程已新增，並同步啟動計時！');
};
/* ══════════════════════════════════════   訂單計時模組（結束） ══════════════════════════════════════ */



/* ══ 替換：獎勵進度 (改移至首頁，並回傳 HTML 字串) ══ */
function getRewardsHtml() {
  // 🌟 [修改]：移除原本這裡生成的頁籤 HTML 與提示文字
  let html = ''; 

  // 同步 HTML 上的滑動狀態
  const isCurrent = S.rewardSubTab === 'current';
  const tabsEl = document.getElementById('reward-tabs-el');
  if (tabsEl) {
    tabsEl.setAttribute('data-active', S.rewardSubTab);
    document.getElementById('rsb-current').classList.toggle('active', isCurrent);
    document.getElementById('rsb-upcoming').classList.toggle('active', !isCurrent);
  }

  // 加入原本按鈕下方的提示文字 (保持在列表上方)
  html += `<div style="font-size:13px; color:var(--hint-color); margin-bottom:12px; text-align:center; font-weight:700;">
    ${isCurrent ? '「今日」生效中之獎勵進度' : '「下一個獎勵起」之即將到來獎勵'}
  </div>`;

  const today = new Date(); today.setHours(0,0,0,0);
  const dayOfWeek = today.getDay() || 7;
  const dStrToday = todayStr(today);
  
  const currentMon = new Date(today); currentMon.setDate(today.getDate() - dayOfWeek + 1);
  const nextSunday = new Date(today); nextSunday.setDate(today.getDate() + (7 - dayOfWeek) + 7);
  const dStrNextSun = todayStr(nextSunday);

  let activeRewards = [];

  (S.settings.rewards ||[]).forEach(r => {
    if (r.active === false) return; // 👈 新增：忽略已停用的獎勵
    let windowsToCheck =[];
    if (r.recurring) {
        windowsToCheck.push(getRewardWindow(todayStr(currentMon), r));
        let nextWeekD = new Date(currentMon); nextWeekD.setDate(currentMon.getDate() + 7);
        windowsToCheck.push(getRewardWindow(todayStr(nextWeekD), r));
    } else {
        windowsToCheck.push({start: r.startDate, end: r.endDate});
    }

    let uniqueWindows =[];
    windowsToCheck.filter(Boolean).forEach(w => {
        if(!uniqueWindows.find(uw => uw.start === w.start && uw.end === w.end)) uniqueWindows.push(w);
    });

    uniqueWindows.forEach(w => {
        let isValid = false;
        if (S.rewardSubTab === 'current') {
            if (w.start <= dStrToday && w.end >= dStrToday) isValid = true;
        } else {
            if (w.start > dStrToday && w.start <= dStrNextSun) isValid = true;
        }

        if (isValid) {
            let accum = 0;
            S.records.forEach(rec => {
                if(rec.isPunchOnly || rec.platformId !== r.platformId) return;
                if(rec.date >= w.start && rec.date <= w.end) accum += pf(rec.orders);
            });
            activeRewards.push({ ...r, window: w, accum });
        }
    });
  });

  activeRewards.sort((a,b) => a.window.start.localeCompare(b.window.start));

  if (activeRewards.length === 0) {
    return html + `<div class="empty-tip">本區間無相符的獎勵設定</div>`;
  }

  activeRewards.forEach(r => {
    const plat = getPlatform(r.platformId);
    let nextTierOrders = null; let prevTierOrders = 0; let achievedBonus = 0;
    
    let tiersHtml = `<div style="display:flex; align-items:center; gap:3px; flex-wrap:wrap; margin-top:12px;">`;
    const sortedTiers =[...(r.tiers || [])].sort((a,b) => a.orders - b.orders);
    sortedTiers.forEach((t, i) => {
      const isPassed = r.accum >= t.orders;
      if (isPassed) { achievedBonus = Math.max(achievedBonus, t.amount); prevTierOrders = t.orders; }
      if (!isPassed && nextTierOrders === null) nextTierOrders = t.orders;
      
      const bgColor = isPassed ? plat.color : 'var(--bg-input)';
      const textColor = isPassed ? '#fff' : 'var(--t3)';
      const arrowColor = isPassed ? plat.color : 'var(--t3)';
      
      tiersHtml += `<span style="background:${bgColor}; color:${textColor}; padding:2px 4px; border-radius:6px; font-size:14px; font-weight:800; font-family:var(--mono); transition:0.3s; letter-spacing:0.4px;">${t.orders}<span style="font-size:10px;font-weight:600;">單 $</span>${t.amount}</span>`;
      if (i < sortedTiers.length - 1) tiersHtml += `<span style="color:${arrowColor}; font-size:10px; font-weight:900; margin: 0 -1px;">➔</span>`;
    });
    tiersHtml += `</div>`;

    let progressPct = 100;
    if (nextTierOrders !== null) {
      progressPct = Math.max(0, Math.min(100, Math.round(((r.accum - prevTierOrders) / (nextTierOrders - prevTierOrders)) * 100)));
    }
    
    let statusText = nextTierOrders !== null 
      ? `差 <span style="color:var(--red); font-size:16px;">${nextTierOrders - r.accum}</span> 單晉級` 
      : `<span style="color:var(--green);">🎉 已達成最高階！</span>`;

    html += `
      <div class="card" style="border: 2px solid ${plat.color}40; margin-bottom:8px;padding:5px 6px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
          <div>
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
              <span style="background:${plat.color}; color:#fff; font-size:10px; font-weight:800; padding:2px 6px; border-radius:4px;">${safeText(plat.name)}</span>
              <span style="font-size:14px; font-weight:800; color:var(--t1);">${safeText(r.name)}</span>
            </div>
            <div style="font-size:15px;font-weight:750;color:#30a553;font-family:var(--mono);letter-spacing:0.8px;">📅 ${fmtDateDisp(r.window.start)}<span style="color: #000;font-size:12px;font-weight:900;margin:0 5px;">～</span>${fmtDateDisp(r.window.end)}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px; color:var(--t3); font-weight:700;">目前累積獎金</div>
            <div style="font-family:var(--mono); font-size:20px; font-weight:900; color:var(--acc);">$${achievedBonus}</div>
          </div>
        </div>
        
        <div style="margin:12px 0;">
          <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700; margin-bottom:6px;">
            <span style="color:var(--t1);">目前單數：<span style="font-family:var(--mono); font-size:16px; color:var(--blue);">${r.accum}</span> 單</span>
            <span style="font-weight:800;">${statusText}</span>
          </div>
          <div class="progress-track" style="height:12px; background:var(--bg-input); border-radius:12px;">
            <div class="progress-fill" style="width:${progressPct}%; background:linear-gradient(90deg, ${plat.color}80, ${plat.color}); border-radius:12px;"></div>
          </div>
        </div>
        ${tiersHtml}
      </div>
    `;
  });
  
  return html;
}
// 2. 加入子按鈕點擊處理函式
window.setRewardSubTab = function(tab) {
  S.rewardSubTab = tab;
  
  // 更新 HTML 上的屬性，觸發 CSS 動畫
  const tabsEl = document.getElementById('reward-tabs-el');
  if (tabsEl) {
    tabsEl.setAttribute('data-active', tab);
    document.getElementById('rsb-current').classList.toggle('active', tab === 'current');
    document.getElementById('rsb-upcoming').classList.toggle('active', tab === 'upcoming');
  }
  
  renderHome(); // 重新渲染列表內容
};

window.navRptMonth = function(dir) {
  S.rptM += dir;
  if(S.rptM < 1) { S.rptM = 12; S.rptY--; }
  if(S.rptM > 12) { S.rptM = 1; S.rptY++; }
  renderReport();
}

/* 👈 [新增] TOP5 頁面的快速選日期入口 */
function openTop3DatePicker() {
  openQuickDatePicker({
    mode: 'month', year: S.rptY, curY: S.rptY, curM: S.rptM,
    onSelect: (y, m) => { S.rptY = y; S.rptM = m; renderReport(); }
  });
}

/* 👈 [新增] 淨賺頁面的快速選日期入口 */
function openNetProfitDatePicker() {
  const isMonth = S.rptNetMode === 'month';
  if (isMonth) {
    openQuickDatePicker({
      mode: 'month', year: S.rptY, curY: S.rptY, curM: S.rptM,
      onSelect: (y, m) => { S.rptY = y; S.rptM = m; renderReport(); }
    });
  } else {
    openQuickDatePicker({
      mode: 'year', year: S.rptY, curY: S.rptY,
      onSelect: (y) => { S.rptY = y; renderReport(); }
    });
  }
}

/* ══ 替換：圖表區間切換 ══ */
window.navTrend = function(dir) {
  let d = new Date(S.trendDate || new Date());
  const mode = S.trendMode || 'month';
  const m = S.trendMode || 'month';

  if (m === 'week') {
    const platId = (S.trendFilter && S.trendFilter !== 'all') ? S.trendFilter : null;
    if (platId && typeof shiftPayPeriod === 'function') {
      S.trendDate = shiftPayPeriod(platId, d, dir);
    } else {
      d.setDate(d.getDate() + dir * 7);
      S.trendDate = d;
    }
  } else if (m === 'month') {
    d.setMonth(d.getMonth() + dir);
    S.trendDate = d;
  } else if (m === 'year') {
    d.setFullYear(d.getFullYear() + dir);
    S.trendDate = d;
  } else {
    S.trendDate = d;
  }

  renderRptTrend();
};

const globalRptPrev = document.getElementById('rpt-prev');
const globalRptNext = document.getElementById('rpt-next');
if (globalRptPrev) {
  globalRptPrev.onclick = () => { 
    S.rptM--; 
    if (S.rptM < 1) { S.rptM = 12; S.rptY--; } 
    renderReport(); 
  };
}
if (globalRptNext) {
  globalRptNext.onclick = () => { 
    S.rptM++; 
    if (S.rptM > 12) { S.rptM = 1; S.rptY++; } 
    renderReport(); 
  };
}

/* ══ 替換：收入總覽頁面 (修復空白問題、套用淨行程與同排佔比) ══ */
/* ══ 合併：總覽頁面（週總覽／月總覽／年總覽 三合一，含滑動特效切換） ══ */
function switchOvPeriod(period, index) {
  S.ovPeriod = period;
  const bg = document.getElementById('ov-period-bg');
  if (bg) {
    const grads = {
      week:  'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
      month: 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)',
      year:  'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)'
    };
    bg.style.transform = `translateX(${index * 100}%)`;
    bg.style.background = grads[period];
  }
  document.querySelectorAll('#ov-period-tabs .slide-btn').forEach((btn, i) => btn.classList.toggle('active', i === index));
  renderRptOverview();
}

window.navRptPeriod = function(dir) {
  const period = S.ovPeriod || 'month';
  if (period === 'week') {
    if (!S.rptWeekDate) S.rptWeekDate = new Date();
    const platId = (S.rptOverviewFilter && S.rptOverviewFilter !== 'all') ? S.rptOverviewFilter : null;
    if (platId) {
      S.rptWeekDate = shiftPayPeriod(platId, S.rptWeekDate, dir);
    } else {
      const d = new Date(S.rptWeekDate);
      d.setDate(d.getDate() + dir * 7);
      S.rptWeekDate = d;
    }
  } else if (period === 'year') {
    S.rptY += dir;
  } else {
    S.rptM += dir;
    if (S.rptM < 1) { S.rptM = 12; S.rptY--; }
    if (S.rptM > 12) { S.rptM = 1; S.rptY++; }
  }
  renderRptOverview();
};

/* 👈 [新增] 總覽頁面專屬的快速選日期入口 */
function openOverviewDatePicker() {
  const period = S.ovPeriod || 'month';
  if (period === 'week') {
    if (!S.rptWeekDate) S.rptWeekDate = new Date();
    openQuickDatePicker({
      mode: 'week',
      weekAnchor: S.rptWeekDate,
      onSelectWeek: (d) => { S.rptWeekDate = d; renderRptOverview(); }
    });
  } else if (period === 'year') {
    openQuickDatePicker({
      mode: 'year', year: S.rptY, curY: S.rptY,
      onSelect: (y) => { S.rptY = y; renderRptOverview(); }
    });
  } else {
    openQuickDatePicker({
      mode: 'month', year: S.rptY, curY: S.rptY, curM: S.rptM,
      onSelect: (y, m) => { S.rptY = y; S.rptM = m; renderRptOverview(); }
    });
  }
}

function renderRptOverview() {
  if (!S.rptOverviewFilter) S.rptOverviewFilter = 'all';
  if (!S.ovPeriod) S.ovPeriod = 'month';
  if (!S.rptWeekDate) S.rptWeekDate = new Date();

  const period = S.ovPeriod;
  const periodIdx = { week: 0, month: 1, year: 2 }[period];

  // 1. 依三種區間取得對應原始資料與導覽標籤
  let allRecs, navLabel, totalTitle, emptyTip, weekNotice = '';
  const isAll = S.rptOverviewFilter === 'all';

  if (period === 'week') {
    if (!isAll && S.rptOverviewFilter) {
      const pay = getPayPeriod(S.rptOverviewFilter, S.rptWeekDate);
      allRecs = S.records.filter(r => r.date >= pay.startStr && r.date <= pay.endStr);
      navLabel = `<span style="color:#006eff; font-size:20px;">${pay.startStr.slice(0,4)}</span> 年 <span style="color:#006eff; font-size:18px;">${_fmtMD(pay.startStr)} ~ ${_fmtMD(pay.endStr)}</span>`;
      if (pay.notice) weekNotice = pay.notice;  // 只留 Uber 提示
    } else {
      // 收入分析-週總覽
      allRecs = getWeekRecs(S.rptWeekDate);
      const { start, end } = getWeekRange(S.rptWeekDate);
      navLabel = `<span style="color:#006eff; font-size:20px;">${start.getFullYear()}</span> 年 <span style="color:#006eff; font-size:18px;">${start.getMonth()+1}/${start.getDate()} ~ ${end.getMonth()+1}/${end.getDate()}</span>`;
    }
    totalTitle = '區間總收入';
    emptyTip = '所選平台，本區間無記錄';
  } else if (period === 'year') {
    allRecs = S.records.filter(r => r.date && r.date.startsWith(`${S.rptY}-`));
    navLabel = `<span style="color: #006eff; font-size: 24px;">${S.rptY}</span> 年全年總覽`;
    totalTitle = '全年總收入';
    emptyTip = '所選平台，本年度無記錄';
  } else {
    allRecs = getMonthRecs(S.rptY, S.rptM);
    navLabel = `<span style="color: #006eff; font-size: 22px;">${S.rptY}</span> 年 <span style="color: #006eff; font-size: 22px;">${S.rptM}</span> 月`;
    totalTitle = '本月總收入';
    emptyTip = '所選平台，本區間無記錄';
  }

  const recs = isAll ? allRecs : allRecs.filter(r => r.platformId === S.rptOverviewFilter || r.isPunchOnly);

  const total = recs.reduce((s,r) => s+recTotal(r), 0);
  const income = recs.reduce((s,r) => s+pf(r.income), 0); // 這是淨行程
  const bonus = recs.reduce((s,r) => s+pf(r.bonus)+pf(r.tempBonus), 0);
  const tips = recs.reduce((s,r) => s+pf(r.tips), 0);
  const orders = recs.reduce((s,r) => s+pf(r.orders), 0);
  const mileage = recs.reduce((s,r) => s+pf(r.mileage), 0);
  const hours = calcTotalHours(recs);
  const cashTipTotal = recs.filter(r=>r.isCashTip).reduce((s,r)=>s+pf(r.cashTipAmt), 0);

  const activePlats = S.platforms.filter(p=>p.active);
  let filterName = isAll ? '全部平台' : safeText(activePlats.find(p=>p.id===S.rptOverviewFilter)?.name || '');

  const avgOrd = orders > 0 ? Math.round(total / orders) : 0;
  const ordHr = hours > 0 ? (orders / hours).toFixed(1) : 0;
  const avgHr = hours > 0 ? Math.round(total / hours) : 0;

  const wageHtml = getWageBadge(hours, total);
  // 總覽頁，一體成型三色膠囊（缺資料也顯示，數字留––）
  const ordText = orders > 0 ? fmt(orders) : '––';
  const milText = mileage > 0 ? fmt(mileage) : '––';
  const hrText  = hours > 0 ? fmtHours(hours) : '––';

  const tagsHtml = `
    <div style="display:inline-flex;align-items:stretch;border-radius:8px;border:1.5px solid #e2e8f0;overflow:hidden;margin-bottom:4px;background:#e2e8f0;gap:2px;">
      <div style="background:#fff7ed;padding:1.5px 8px;display:flex;align-items:baseline;gap:3px;min-width:42px;">
        <span style="font-size:15px;font-family:var(--mono);font-weight:800;color:#ff0000;">${ordText}</span>
        <span style="font-size:10px;font-weight:600;color:#f97316;">單</span>
      </div>
      <div style="background:#e1ffff;padding:2px 8px;display:flex;align-items:baseline;gap:3px;min-width:48px;">
        <span style="font-size:15px;font-family:var(--mono);font-weight:800;color:#b23dff;">${milText}</span>
        <span style="font-size:10px;font-weight:800;color:#000;">km</span>
      </div>
      <div style="background:#eff6ff;padding:2px 8px;display:flex;align-items:center;gap:4px;min-width:52px;">
        <span style="font-size:11px;">⏱️</span>
        <span style="font-size:13px;font-family:var(--mono);font-weight:800;color:#2563eb;">${hrText}</span>
      </div>
    </div>`;

  // 2. 最上方：週總覽／月總覽／年總覽 滑動特效切換按鈕（漸層背景）
  const periodGrads = {
    week:  'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
    month: 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)',
    year:  'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)'
  };
  let html = `
    <div class="slide-tabs tabs-3" id="ov-period-tabs" style="margin-bottom:10px;">
      <div class="slide-bg" id="ov-period-bg" style="transform:translateX(${periodIdx*100}%); background:${periodGrads[period]};"></div>
      <button class="slide-btn ${period==='week'?'active':''}" onclick="switchOvPeriod('week',0)">週總覽</button>
      <button class="slide-btn ${period==='month'?'active':''}" onclick="switchOvPeriod('month',1)">月總覽</button>
      <button class="slide-btn ${period==='year'?'active':''}" onclick="switchOvPeriod('year',2)">年總覽</button>
    </div>`;

  html += `
    <div style="display:flex; justify-content:space-between; align-items:center; background: #ffffff; padding: 5px 10px; border-radius: 20px; border: 1px solid #cbd5e1; margin-bottom: 10px;">
      <button class="btn btn1" onclick="navRptPeriod(-1)" style="width: 42px; height: 42px;">◀</button>
      <span onclick="openOverviewDatePicker()" style="font-family:var(--mono); font-size: 18px; font-weight: 900; color: #1e293b; letter-spacing: 0px; text-align: center; flex: 1; cursor:pointer;">${navLabel} <span style="color:#94a3b8; font-size:13px; vertical-align:middle;">▼</span></span>
      <button class="btn btn1" onclick="navRptPeriod(1)" style="width: 42px; height: 42px;">▶</button>
    </div>`;

  if (period === 'week' && weekNotice) {
    html += `<div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:12px;padding:10px 12px;margin-bottom:10px;font-size:12px;font-weight:700;color:#9a3412;line-height:1.55;">${weekNotice}</div>`;
  }

  const pcts = getExactPercentages([income, bonus, tips]);
  const incPct = pcts[0]; const bonPct = pcts[1]; const tipPct = pcts[2];

  html += `
    <div style="background: var(--sf); border:2px solid var(--card-border); border-radius:12px; position:relative; box-shadow:0 4px 12px rgba(0,0,0,0.03); margin-bottom:10px; overflow:hidden;">

      <div id="rpt-overview-col-btn" onclick="toggleSummaryCard('rpt-overview-col')" style="position:absolute;top:2px;right:12px;width:40px;height:40px;background:hsla(320,75%,34%,0.3);border-radius:50%;color:hsl(320,100%,34%);display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:900;cursor:pointer;transition:transform 0.3s;z-index:2;">▼</div>
      
      <div onclick="toggleSummaryCard('rpt-overview-col')" style="padding:4px 0px; cursor:pointer; text-align:center;">
        <div style="margin-bottom:6px;">
          ${isAll ? `<span style="font-size:16px; font-weight:900; color:var(--t2);">全部平台</span>` : `<span class="plat-badge" style="background:${activePlats.find(p=>p.id===S.rptOverviewFilter)?.color}; font-size:14px; padding:4px 14px;">${filterName}</span>`}
          <span style="font-size:18px; font-weight:800; color: var(--t2); margin-left:6px;">${totalTitle}</span>
        </div>
        <div style="font-family:var(--mono); font-size:36px; font-weight:800; color: #0db3e6; line-height:1; margin-bottom:8px;"><span style="font-size:18px;">$ </span> ${fmt(total)}</div>
        ${tagsHtml}
        
        <div style="display:flex; justify-content:space-between; gap:6px; margin-top:4px; padding: 0 4px 0px 4px;">
          
          <div style="flex:1; display:flex; flex-direction:column; gap:3px; border:2px solid rgba(34, 197, 94, 0.15); border-radius:12px;">
            <div style="background: rgba(34, 197, 94, 0.15); padding:0 6px 1px; border-radius:10px; display:flex; justify-content:flex-end; align-items:center; gap:4px;">
              <span style="color: #1f9c4d; font-size:13px; font-weight:700; font-family:var(--mono);">淨行程</span>
              <span style="display:inline-flex; align-items:center; border-radius:4px; padding:1px 4px; background: #ffffff; border:1px solid rgba(34, 197, 94, 0.3);">
                <span style="color: #1f9c4d; font-size:12px; font-weight:700;">${incPct}<span style="font-size:8px;">%</span></span>
              </span>
            </div>
            <div style="background: #ffffff; border-radius:10px; text-align:center;">
              <span style="color: #1f9c4d; font-size:16px; font-weight:800;"><span style="font-size:10px;">$ </span>${fmt(income)}</span>
            </div>
          </div>

          <div style="flex:1; display:flex; flex-direction:column; gap:3px; border:2px solid rgba(245, 158, 11, 0.15); border-radius:12px;">
            <div style="background: rgba(245, 158, 11, 0.15); padding:0 6px 1px; border-radius:10px; display:flex; justify-content:flex-end; align-items:center; gap:4px;">
              <span style="color: hsl(25, 100%, 55%); font-size:13px; font-weight:700; font-family:var(--mono);">獎勵</span>
              <span style="display:inline-flex; align-items:center; border-radius:4px; padding:1px 4px; background: #ffffff; border:1px solid rgba(245, 158, 11, 0.3);">
                <span style="color: hsl(25, 100%, 55%); font-size:12px; font-weight:700;">${bonPct}<span style="font-size:8px;">%</span></span>
              </span>
            </div>
            <div style="background: #ffffff; border-radius:10px; text-align:center;">
              <span style="color: hsl(25, 100%, 55%); font-size:16px; font-weight:800;"><span style="font-size:10px;">$ </span>${fmt(bonus)}</span>
            </div>
          </div>

          <div style="flex:1; display:flex; flex-direction:column; gap:3px; border:2px solid rgba(190, 59, 246, 0.15); border-radius:12px;">
            <div style="background: rgba(190, 59, 246, 0.15); padding:0 6px 1px; border-radius:10px; display:flex; justify-content:flex-end; align-items:center; gap:4px;">
              <span style="color: rgba(137, 43, 226, 0.9); font-size:13px; font-weight:700; font-family:var(--mono);">小費</span>
              <span style="display:inline-flex; align-items:center; border-radius:4px; padding:1px 4px; background: #ffffff; border:1px solid rgba(190, 59, 246, 0.3);">
                <span style="color: rgba(137, 43, 226, 0.9); font-size:12px; font-weight:700;">${tipPct}<span style="font-size:8px;">%</span></span>
              </span>
            </div>
            <div style="background: #ffffff; border-radius:10px; text-align:center;">
              <span style="color: rgba(137, 43, 226, 0.9); font-size:16px; font-weight:800;"><span style="font-size:10px;">$ </span>${fmt(tips)}</span>
            </div>
          </div>

        </div>
      </div> 
      <div style="border-top:2px dashed var(--blue); margin-bottom:1px;"></div>

      <div id="rpt-overview-col" style="max-height:0px; overflow:hidden; transition: max-height 0.35s ease; background: #ffffff;">
        <div style="padding:5px 3px 5px 3px; display:flex; justify-content:center; align-items:flex-start; font-size:12px; font-weight:700; color: #000000; width:100%;">
          <div style="flex:1; text-align:center; padding-top:2px; font-family:var(--mono)">
            一單：<span style="font-family:var(--mono); color: var(--text-cyan); font-size:20px; font-weight:800;"><span style="font-size:12px;"> $ </span>${fmt(avgOrd)}</span>
          </div>
          <div class="h-div" style="height:49px; align-self:center;"></div>
          <div style="flex:1; text-align:center; padding-top:2px; font-family:var(--mono)">
            1 h： <span style="font-family:var(--mono); color: var(--text-red); font-size:20px; font-weight:800;">${ordHr}<small style="color: rgb(185, 56, 255);font-size:11px; font-weight:500;"> 單</small></span>
          </div>
          <div class="h-div" style="height:49px; align-self:center;"></div>
          <div style="flex:1; text-align:center; padding-top:2px; font-family:var(--mono)">
            時薪： <span style="font-family:var(--mono); color: var(--text-blue); font-size:20px; font-weight:800;"><span style="font-size:12px;">$ </span>${fmt(avgHr)}</span>
            ${wageHtml}
          </div>
        </div>
        ${cashTipTotal > 0 ? `
        <div style="border-top:2px dashed var(--border);"></div>
        <div style="display:flex; justify-content:flex-start; align-items:center; padding:5px 16px;">
          <span style="background: #d6ffe5; color: #129943; font-size:13px; padding:4px 10px; border-radius:15px; font-weight:700;">現金小費 (不算總收入)</span>：
          <span style="font-family:var(--mono); font-size:21px; font-weight:800; color: #009921;"><span style="font-size:10px;margin:0 5px 0 10px;">$</span>${fmt(cashTipTotal)}</span>
        </div>` : ''}
      </div>
    </div>`;

  // 🌟 結構佔比分析卡片 (右上角新增旋轉折疊按鈕)
  html += `<div style="border:1.5px solid var(--card-border);background:var(--sf);border-radius:var(--r);padding:2px 12px 10px 16px;">
    <div style="display:flex; justify-content:space-between; align-items:center;margin-bottom:4px;">
      <div style="font-size:15px; font-weight:800; color:var(--t2);">📊 結構佔比分析</div>
      <div id="pie-list-col-btn" onclick="toggleSummaryCard('pie-list-col')" class="btn btn4" style="cursor:pointer;transition:transform 0.3s;width:40px;height:40px;">▼</div>
    </div>`;

  html += `<div style="display:flex; gap:8px; margin-bottom:16px; overflow-x:auto; padding-bottom:4px;">
    <button onclick="S.rptOverviewFilter='all'; renderRptOverview()" style="flex-shrink:0; padding:6px 14px; border-radius:8px; font-size:12px; font-weight:700; border:none; cursor:pointer; transition:0.2s; ${isAll ? 'background:var(--acc); color:#fff; box-shadow:0 2px 6px rgba(255,107,53,0.3);' : 'background:var(--sf2); color:var(--t2);'}">全部</button>`;
  activePlats.forEach(p => {
    let isActive = S.rptOverviewFilter === p.id;
    html += `<button onclick="S.rptOverviewFilter='${safeText(p.id)}'; renderRptOverview()" style="flex-shrink:0; padding:6px 14px; border-radius:8px; font-size:12px; font-weight:700; border:none; cursor:pointer; transition:0.2s; ${isActive ? `background:${p.color}; color:#fff; box-shadow:0 2px 6px ${p.color}50;` : `background:${p.color}15; color:${p.color};`}">${safeText(p.name)}</button>`;
  });
  html += `</div>`;

  let pieLabels = [], pieData = [], pieColors = [], listHtml = '';

  if (isAll && total > 0) {
    const platData = activePlats.map(p => ({ name: p.name, color: p.color, val: recs.filter(r=>r.platformId===p.id).reduce((s,r)=>s+recTotal(r),0) })).filter(p=>p.val>0);
    pieLabels = platData.map(p=>p.name); pieData = platData.map(p=>p.val); pieColors = platData.map(p=>p.color);

    const platPcts = getExactPercentages(pieData);

    listHtml = platData.map((p, idx) => {
      const pct = platPcts[idx];
      return `
        <div style="display:grid;grid-template-columns: 1fr 1fr 1.5fr; align-items:center; padding:10px 10px; border-bottom:1.5px solid #f1f5f9;">
          <div style="display:flex; align-items:center; justify-content:flex-start;">
            <div style="width:10px; height:10px; border-radius:3px; background:${p.color}; margin-right:8px; flex-shrink:0;"></div>
            <span style="font-size:13px; font-weight:800; color:var(--t1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${safeText(p.name)}</span>
          </div>
          <span style="font-family:var(--mono); font-size:15px; font-weight:800; color:var(--blue); text-align:right;">${pct} <span style="font-size:9px;">%</span></span>
          <span style="font-family:var(--mono); font-size:15px; font-weight:900; color:var(--t1); text-align:right;">
            <span style="font-size:10px; color:#94a3b8; margin-right:2px; font-weight:700;">$ </span>${fmt(p.val)}
          </span>
        </div>`;
    }).join('');
  } else if (!isAll && total > 0) {
    pieLabels = ['行程', '獎勵', '小費']; pieData = [income, bonus, tips]; pieColors = ['#22c55e', '#f59e0b', '#3b82f6'];

    const details = [
      { name: '行程收入', val: income, color: '#22c55e', pct: incPct },
      { name: '獎勵金額', val: bonus, color: '#f59e0b', pct: bonPct },
      { name: 'APP小費', val: tips, color: '#3b82f6', pct: tipPct }
    ].filter(d => d.val > 0);

    listHtml = details.map(d => {
      return `
        <div style="display:grid; grid-template-columns: 1fr 1fr 1.5fr; align-items:center; padding:10px 10px; border-bottom:1.5px solid #f1f5f9;">
          <div style="display:flex; align-items:center; justify-content:flex-start;">
            <div style="width:10px; height:10px; border-radius:3px; background:${d.color}; margin-right:8px; flex-shrink:0;"></div>
            <span style="font-size:13px; font-weight:800; color:var(--t1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${safeText(d.name)}</span>
          </div>
          <span style="font-family:var(--mono); font-size:15px; font-weight:800; color:var(--blue); text-align:right;">${d.pct} <span style="font-size:9px;">%</span></span>
          <span style="font-family:var(--mono); font-size:15px; font-weight:900; color:var(--t1); text-align:right;">
            <span style="font-size:10px; color:#94a3b8; margin-right:2px; font-weight:700;">$ </span>${fmt(d.val)}
          </span>
        </div>`;
    }).join('');
  }

  if (total > 0) {
    html += `
      <div style="position:relative; height:180px; margin-bottom:16px;">
        <canvas id="plat-pie"></canvas>
      </div>
      
      <!-- 🌟 預設折疊外框 (max-height: 0px) -->
      <div id="pie-list-col" style="max-height:0px; overflow:hidden; transition:max-height 0.35s ease;">
        <div style="display:flex; flex-direction:column;">
          
          <!-- 三等分表頭 -->
          <div style="display:grid; grid-template-columns: 1fr 1fr 1.5fr; align-items:center; padding:10px 10px; border-bottom:1.5px solid var(--border);">
            <span style="font-size:12px; font-weight:800; color:var(--t3); text-align:left;">項目</span>
            <span style="font-size:12px; font-weight:800; color:var(--t3); text-align:right;">佔比</span>
            <span style="font-size:12px; font-weight:800; color:var(--t3); text-align:right;">金額</span>
          </div>
          
          ${listHtml}
          
          <!-- 三等分總計列 -->
          <div style="position:relative; display:grid; grid-template-columns: 1fr 1fr 1.5fr; align-items:center; padding:12px 10px; margin: 6px -14px 4px -14px; z-index:1;">
            <svg viewBox="0 0 1000 40" preserveAspectRatio="none" style="position:absolute; inset:0; width:100%; height:100%; z-index:-1; filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.15));">
              <defs>
                <linearGradient id="darkGoldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#3b3b3f" />
                  <stop offset="40%" stop-color="#353535" />
                  <stop offset="50%" stop-color="#282828" />
                  <stop offset="100%" stop-color="#18181b" />
                </linearGradient>
                <linearGradient id="goldLineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#fbbf24" />
                  <stop offset="50%" stop-color="#fef08a" />
                  <stop offset="100%" stop-color="#d97706" />
                </linearGradient>
              </defs>
              <polygon points="25,0 975,0 1000,20 975,40 25,40 0,20" fill="url(#darkGoldGrad)" />
              <polygon points="28,3 972,3 995,20 972,37 28,37 5,20" fill="none" stroke="url(#goldLineGrad)" stroke-width="1.5" />
              <polygon points="30,6 970,6 991,20 970,34 30,34 9,20" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.5" />
            </svg>
            
            <span style="font-size:16px; font-weight:800; color: #00eeff; letter-spacing:1px; text-align:left; padding-left:14px;">🔷 總計</span>
            <span style="font-family:var(--mono); font-size:15px; font-weight:800; color: #FFD700; text-align:right; margin-right:2px;">100 <span style="font-size:9px;">%</span></span>
            <span style="font-family:var(--mono); font-size:16px; font-weight:900; color: #ffffff; text-align:right; text-shadow:0 2px 4px rgba(0,0,0,0.5); padding-right:10px;">
              <span style="font-size:10px; opacity:0.8; margin-right:2px;">$ </span>${fmt(total)}
            </span>
          </div>
        </div>
      </div>`;

  } else {
    html += `<div class="empty-tip" style="padding:16px 0;">${emptyTip}</div>`;
  }

  html += `</div>`;

  document.getElementById('rv-overview').innerHTML = html;

  if (total > 0 && pieData.length > 0) {
    drawPie('plat-pie', pieLabels, pieData, pieColors);
  }
}

/* ══ 圖表 ══ */
function openTrendDatePicker() {
  if (!S.trendDate) S.trendDate = new Date();
  const mode = S.trendMode === '4week' ? 'week' : (S.trendMode || 'month');
  const td = new Date(S.trendDate);
  if (mode === 'week') {
    openQuickDatePicker({
      mode: 'week', weekAnchor: td,
      onSelectWeek: (d) => { S.trendDate = d; renderRptTrend(); }
    });
  } else if (mode === 'year') {
    openQuickDatePicker({
      mode: 'year', year: td.getFullYear(), curY: td.getFullYear(),
      onSelect: (y) => { const d = new Date(S.trendDate); d.setFullYear(y); S.trendDate = d; renderRptTrend(); }
    });
  } else {
    openQuickDatePicker({
      mode: 'month', year: td.getFullYear(), curY: td.getFullYear(), curM: td.getMonth()+1,
      onSelect: (y, m) => { const d = new Date(S.trendDate); d.setFullYear(y); d.setMonth(m-1, 1); S.trendDate = d; renderRptTrend(); }
    });
  }
}

function renderRptTrend() {
  const el = document.getElementById('rv-trend');
  if (!S.trendDate) S.trendDate = new Date();
  const td = new Date(S.trendDate);
  let navLabel = '';

  // 👈 「趨勢」字樣移除，僅保留區間名稱（週／4週／月／年）
  const trends =[
    { key:'week',  label:'週',   getDays: () => {
        const platId = (S.trendFilter && S.trendFilter !== 'all') ? S.trendFilter : null;
        if (platId && typeof getPayPeriod === 'function') {
          const pay = getPayPeriod(platId, td);
          navLabel = `${+pay.startStr.slice(5,7)}/${+pay.startStr.slice(8,10)} ~ ${+pay.endStr.slice(5,7)}/${+pay.endStr.slice(8,10)}`;
          // 展開區間內每一天
          const days = [];
          const c = new Date(pay.start); c.setHours(12,0,0,0);
          const end = new Date(pay.end); end.setHours(12,0,0,0);
          while (c <= end) {
            days.push(todayStr(c));
            c.setDate(c.getDate() + 1);
          }
          return days;
        }
        // 未選平台：維持日曆週一～週日
        const day = td.getDay() || 7;
        const start = new Date(td); start.setDate(start.getDate() - day + 1);
        const end = new Date(start); end.setDate(end.getDate() + 6);
        navLabel = `${start.getMonth()+1}/${start.getDate()} ~ ${end.getMonth()+1}/${end.getDate()}`;
        return Array.from({length:7}, (_,i)=>{
           const nd = new Date(start); nd.setDate(nd.getDate() + i);
           return todayStr(nd);
        });
      }
    },
    { key:'month', label:'月',   getDays: () => { 
        navLabel = `${td.getFullYear()} 年 ${td.getMonth()+1} 月`;
        const n=new Date(td.getFullYear(), td.getMonth()+1, 0).getDate(); 
        return Array.from({length:n},(_,i)=>`${td.getFullYear()}-${pad(td.getMonth()+1)}-${pad(i+1)}`); 
      } 
    },
    { key:'year',  label:'年',    getDays: () => { 
        navLabel = `${td.getFullYear()} 年`;
        return Array.from({length:12},(_,i)=>null); 
      } 
    }
  ];
  
  const curT = S.trendMode || 'month'; 
  const trend = trends.find(t=>t.key===curT) || trends[2]; // 預設使用月
  const days = trend.getDays(); 

  if (!S.trendFilter) S.trendFilter = 'all';

  // 👇 導入加大加粗的新版導航列 與 圓潤頁籤
  let html = `<div style="display:flex;gap:6px;margin-bottom:12px">
    ${trends.map(t=>`<button onclick="S.trendMode='${t.key}';renderRptTrend()" style="flex:1;padding:8px 6px;border-radius:14px;border:1.5px solid ${curT===t.key?'var(--acc)':'#b9bec4'};background:${curT===t.key?'#fff':'var(--bg-input)'};color:${curT===t.key?'var(--acc)':'var(--t2)'};font-size:18px;cursor:pointer;font-family:var(--sans);font-weight:${curT===t.key?'750':'600'}">${t.label}</button>`).join('')}
  </div>
  <div style="display:flex; justify-content:space-between; align-items:center; background: #ffffff; padding: 5px 10px; border-radius: 20px; border: 1px solid #cbd5e1; margin-bottom: 10px;">
    <button class="btn btn1" onclick="navTrend(-1)" style="width: 42px; height: 42px;">◀</button>
    <span onclick="openTrendDatePicker()" style="font-family:var(--mono); font-size: 22px; font-weight: 900; color: #006eff; letter-spacing: 0px; text-align: center; flex: 1; cursor:pointer;">${navLabel} <span style="color:#94a3b8; font-size:13px; vertical-align:middle;">▼</span></span>
    <button class="btn btn1" onclick="navTrend(1)" style="width: 42px; height: 42px;">▶</button>
  </div>`;

  // 🌟 [新增] 全部／各平台 篩選按鈕組（樣式參考「結構佔比分析」），按下各平台可顯示單一平台圖表
  const allPlats = S.platforms.filter(p=>p.active);
  html += `<div style="display:flex; gap:8px; margin-bottom:12px; overflow-x:auto; padding-bottom:4px;">
    <button onclick="S.trendFilter='all'; renderRptTrend()" style="flex-shrink:0; padding:6px 14px; border-radius:8px; font-size:12px; font-weight:700; border:none; cursor:pointer; transition:0.2s; ${S.trendFilter==='all' ? 'background:var(--acc); color:#fff; box-shadow:0 2px 6px rgba(255,107,53,0.3);' : 'background:var(--sf2); color:var(--t2);'}">全部</button>
    ${allPlats.map(p => {
      const isActive = S.trendFilter === p.id;
      return `<button onclick="S.trendFilter='${safeText(p.id)}'; renderRptTrend()" style="flex-shrink:0; padding:6px 14px; border-radius:8px; font-size:12px; font-weight:700; border:none; cursor:pointer; transition:0.2s; ${isActive ? `background:${p.color}; color:#fff; box-shadow:0 2px 6px ${p.color}50;` : `background:${p.color}15; color:${p.color};`}">${safeText(p.name)}</button>`;
    }).join('')}
  </div>`;

  const plats = allPlats.filter(p => S.trendFilter === 'all' || p.id === S.trendFilter);
  
  if (curT === 'year') {
    // 👈 年：「橫條圖」
    const labels = Array.from({length:12},(_,i)=>`${i+1}月`);
    const datasets =[];
    plats.forEach(p => {
      const data = Array.from({length:12}, (_,i)=> getMonthRecs(td.getFullYear(), i+1).filter(r=>r.platformId===p.id).reduce((s,r)=>s+recTotal(r),0));
      if (data.some(v => v > 0)) datasets.push({ label: p.name, data, backgroundColor: p.color, borderRadius: 4 });
    });
    const allTotal = S.records.filter(r=>r.date.startsWith(`${td.getFullYear()}-`)).reduce((s,r)=>s+recTotal(r),0);
    
    // 👇 全新設計的「全年總收入」精美漸層卡片
    html += `
      <div class="card">
        <div style="height:340px; position:relative;">
          <canvas id="trend-chart"></canvas>
        </div>
        
        <div style="margin-top:14px; background: #ffffff; border: 1.5px solid #bfdbfe; border-radius: 16px; padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 6px 16px rgba(37, 99, 235, 0.08); position: relative; overflow: hidden;">
          <div style="position:absolute; left:0; top:0; bottom:0; width:6px; background: #3b82f6;"></div>
          <div style="display: flex; align-items: center; gap: 12px; padding-left: 6px;">
            <div style="width:40px; height:40px; background:#eff6ff; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:20px; border: 1.5px solid #93c5fd;">🚀</div>
            <div style="display:flex; flex-direction:column; gap:2px;">
              <span style="font-size: 15px; font-weight: 900; color: #1e3a8a; letter-spacing: 0.5px;">全年總收入</span>
              <span style="font-size:11px; font-weight:700; color:#60a5fa; font-family:var(--mono);"><span style="font-size:13px;font-weight:900;color: #ec2c9c;">${td.getFullYear()}</span> Year Total</span>
            </div>
          </div>
          <div style="display:flex; align-items:baseline; gap:4px; margin-top: 16px;">
            <span style="font-size:12px; font-weight:900; color: #3b82f6;">$</span>
            <span style="font-family: var(--mono); font-size: 22px; font-weight: 800; color: #2563eb;"> ${fmt(allTotal)}</span>
          </div>
        </div>

      </div>`;
      
    el.innerHTML = html; drawTrendBar('trend-chart', labels, datasets, true, null, true);
  }
  else if (curT === 'month') {
    // 👈 月：「橫條圖」
    const labels = days.map(d=>{const parts=d.split('-');return `${parseInt(parts[2])}日`;});
    const datasets = [];
    plats.forEach(p => {
      const data = days.map(d=> getDayRecs(d).filter(r=>r.platformId===p.id).reduce((s,r)=>s+recTotal(r),0));
      if (data.some(v => v > 0)) datasets.push({ label: p.name, data, backgroundColor: p.color, borderRadius: 3 });
    });
    const chartHeight = Math.max(320, labels.length * 26);
    html += `<div class="card"><div style="height:${chartHeight}px; position:relative;"><canvas id="trend-chart"></canvas></div></div>`;
    el.innerHTML = html; drawTrendBar('trend-chart', labels, datasets, true, null, true);
  }
  else {
    // 週：「直條圖」
    const labels = days.map(d=>{const parts=d.split('-');return `${parseInt(parts[2])}日`;});
    const datasets =[];
    plats.forEach(p => {
      const data = days.map(d=> getDayRecs(d).filter(r=>r.platformId===p.id).reduce((s,r)=>s+recTotal(r),0));
      if (data.some(v => v > 0)) datasets.push({ label: p.name, data, backgroundColor: p.color, borderRadius: 4 });
    });
    html += `<div class="card"><div style="height:260px; position:relative;"><canvas id="trend-chart"></canvas></div></div>`;
    el.innerHTML = html; drawTrendBar('trend-chart', labels, datasets, true, null, false);
  }
}

/* ══ 支援直條圖／橫條圖雙方向，白色分隔線與藍字粗體金額) ══ */
function drawTrendBar(canvasId, labels, datasets, showLegend = true, maxScale = null, horizontal = false) {
  const ctx = document.getElementById(canvasId)?.getContext('2d'); if (!ctx) return;
  if (S.charts[canvasId]) { S.charts[canvasId].destroy(); }
  
  const style = getComputedStyle(document.documentElement);
  const textColor = style.getPropertyValue('--chart-text').trim() || '#1C1917';
  
  // 不同顏色間加入白色細線分隔
  datasets.forEach(ds => { ds.order = 1; ds.borderColor = '#ffffff'; ds.borderWidth = 1; });

  const combinedDatasets = [...datasets];

  // 金額標示：藍字粗體，並依直條圖／橫條圖方向調整位置（橫條圖移至柱尾右側，直條圖移至柱頂上方）
  const topTotalPlugin = {
    id: 'topTotalPlugin',
    afterDatasetsDraw: (chart) => {
      const ctx = chart.ctx;
      chart.data.labels.forEach((_, i) => {
        let total = 0; let meta;
        chart.data.datasets.forEach((dataset, j) => {
          if (dataset.type === 'line') return;
          meta = chart.getDatasetMeta(j);
          if (!meta.hidden) total += dataset.data[i];
        });
        if (total > 0 && meta) {
          const finalModel = meta.data[i];
          ctx.save();
          ctx.fillStyle = '#1d4ed8';
          ctx.font = 'bold 11px sans-serif';
          if (horizontal) {
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText('$' + fmt(total), finalModel.x + 6, finalModel.y);
          } else {
            ctx.textAlign = 'center';
            ctx.fillText('$' + fmt(total), finalModel.x, finalModel.y - 8);
          }
          ctx.restore();
        }
      });
    }
  };

  // 👇 解決 Chart.js 無法調整下方間距的核心外掛
  const legendMarginPlugin = {
    id: 'legendMargin',
    beforeInit(chart) {
      if (!chart.legend || !chart.legend.fit) return;
      const originalFit = chart.legend.fit;
      chart.legend.fit = function fit() {
        originalFit.bind(chart.legend)();
        // 這裡就是「標籤」與「圖表」之間的距離，25px 是一個很舒適的視覺寬度
        this.height += 25; 
      };
    }
  };

  const valueAxisOpts = { 
    stacked: true, beginAtZero: true, suggestedMax: maxScale || 500, 
    ticks: { color: textColor, callback: v => v >= 1000 ? (v / 1000).toFixed(1).replace('.0', '') + 'k' : v, font: { size: 10 } }, 
    grid: { color: 'rgba(0,0,0,.05)', drawBorder: false } 
  };
  if (maxScale) valueAxisOpts.max = maxScale;
  
  const categoryAxisOpts = { 
    stacked: true, 
    ticks: { color: textColor, font: { size: 9 }, maxRotation: 0, autoSkip: false }, 
    grid: { display: false } 
  };

  const scales = horizontal ? { x: valueAxisOpts, y: categoryAxisOpts } : { x: categoryAxisOpts, y: valueAxisOpts };

  S.charts[canvasId] = new Chart(ctx, { 
    type: 'bar', 
    data: { labels, datasets: combinedDatasets }, 
    // 👇 記得把 legendMarginPlugin 放進外掛陣列中啟用
    plugins: [topTotalPlugin, legendMarginPlugin], 
    options: { 
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true, maintainAspectRatio: false, 
      layout: { padding: { top: 10, right: horizontal ? 46 : 10 } }, 
      plugins: { 
        legend: { display: showLegend, position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } }, 
        tooltip: { mode: 'index', intersect: false, callbacks: { label: c => `${c.dataset.label}: NT$ ${fmt(horizontal ? c.parsed.x : c.parsed.y)}` } } 
      }, 
      scales, 
      animation: { duration: 400 } 
    } 
  });
}

// 全域比較頁面時間與設定控制
window.navCmpTime = function(dir) {
  // 👉 修正：讓 "month" 與 "prev_month" (大數據) 都能正常切換「月份」
  if (S.cmpType === 'month' || S.cmpType === 'prev_month') {
    S.cmpBaseMonth += dir;
    if(S.cmpBaseMonth < 1) { S.cmpBaseMonth = 12; S.cmpBaseYear--; }
    if(S.cmpBaseMonth > 12) { S.cmpBaseMonth = 1; S.cmpBaseYear++; }
  } else {
    S.cmpBaseYear += dir;
  }
  renderReport();
}

/* 👈 [新增] 比較頁面的快速選日期入口 */
function openCompareDatePicker() {
  const isYearOnly = !(S.cmpType === 'month' || S.cmpType === 'prev_month');
  if (isYearOnly) {
    openQuickDatePicker({
      mode: 'year', year: S.cmpBaseYear, curY: S.cmpBaseYear,
      onSelect: (y) => { S.cmpBaseYear = y; renderReport(); }
    });
  } else {
    openQuickDatePicker({
      mode: 'month', year: S.cmpBaseYear, curY: S.cmpBaseYear, curM: S.cmpBaseMonth,
      onSelect: (y, m) => { S.cmpBaseYear = y; S.cmpBaseMonth = m; renderReport(); }
    });
  }
}

function _initCmpPeriods() {
  if (!S.cmpBaseYear) S.cmpBaseYear = new Date().getFullYear();
  if (!S.cmpBaseMonth) S.cmpBaseMonth = new Date().getMonth() + 1;
  if (!S.cmpOffset) S.cmpOffset = 1; // 預設跟前1年比
  
  const y = S.cmpBaseYear;
  
  // 建立年份陣列，從「今年」排到「前 N 年」(最新在最前面)
  // 例: 今年2026, 前3年 -> [2026, 2025, 2024, 2023]
  const targetYears = [];
  for (let i = 0; i <= S.cmpOffset; i++) {
    targetYears.push(y - i);
  }
  
  if (S.cmpType === 'month') {
    S.cmpPeriods = targetYears.map(yr => `${yr}-${pad(S.cmpBaseMonth)}`);
  } else {
    S.cmpPeriods = targetYears.map(String);
  }
}

/* ══ 替換：比較頁面 (全新大數據前月比較，含自訂比較對象) ══ */
function renderRptCompare() {
  const el = document.getElementById('rv-compare');
  _initCmpPeriods();

  const isMonth = S.cmpType === 'month';
  const isPrevMonth = S.cmpType === 'prev_month';
  
  let navLabel = '';
  if (isMonth) navLabel = `${S.cmpBaseYear} 年 ${S.cmpBaseMonth} 月`;
  else if (isPrevMonth) {
    navLabel = `${S.cmpBaseYear} 年 ${S.cmpBaseMonth} 月 (基準)`;
  }
  else navLabel = `${S.cmpBaseYear} 年`;

  // 產生可選的年月份下拉選單 (大數據模式專用)
  let prevMonthOptions = '';
  if (isPrevMonth) {
    // 預設為上個月
    if (!S.cmpTargetYM) {
      let pY = S.cmpBaseYear, pM = S.cmpBaseMonth - 1;
      if (pM < 1) { pM = 12; pY--; }
      S.cmpTargetYM = `${pY}-${pad(pM)}`;
    }
    
    // 抓出有資料的所有月份
    let yms = new Set();
    S.records.forEach(r => { if(r.date) yms.add(r.date.substring(0,7)); });
    let ymArr = Array.from(yms).sort((a,b) => b.localeCompare(a)); // 由大到小
    
    // 如果沒有資料，至少塞一個當前月份
    if (ymArr.length === 0) ymArr = [`${S.cmpBaseYear}-${pad(S.cmpBaseMonth)}`];

    ymArr.forEach(ym => {
      const isSel = S.cmpTargetYM === ym ? 'selected' : '';
      prevMonthOptions += `<option value="${ym}" ${isSel}>${ym.replace('-', ' 年 ')} 月</option>`;
    });
  }

  let html = `
    <div class="card" style="padding: 14px; margin-bottom: 12px; background: linear-gradient(135deg, var(--sf), var(--sf2)); box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px dashed var(--border); padding-bottom: 10px; margin-bottom: 10px;">
        <div style="display:flex; flex-direction:column; gap:4px; width:48%;">
          <label style="font-size:11px; color:var(--t3); font-weight:800; letter-spacing:0.5px;">📊 比較類型</label>
          <select class="fsel" style="padding:6px; font-weight:800; border-color:transparent; background:var(--bg-input); color:var(--t1); font-size:13px;" onchange="S.cmpType=this.value; _initCmpPeriods(); renderReport();">
            <option value="prev_month" ${isPrevMonth ? 'selected' : ''}>大數據月份比較</option>
            <option value="month" ${isMonth ? 'selected' : ''}>歷史同月比較</option>
            <option value="year" ${!isMonth && !isPrevMonth ? 'selected' : ''}>歷史全年比較</option>
          </select>
        </div>
        
        <div style="display:flex; flex-direction:column; gap:4px; width:48%;">
          <label style="font-size:11px; color:var(--t3); font-weight:800; letter-spacing:0.5px;">⏳ 比較對象</label>
          ${isPrevMonth 
            ? `<select class="fsel" style="padding:6px; font-weight:800; border-color:transparent; background:var(--bg-input); color:var(--text-blue); font-size:13px;" onchange="S.cmpTargetYM=this.value; renderReport();">${prevMonthOptions}</select>`
            : `<select class="fsel" style="padding:6px; font-weight:800; border-color:transparent; background:var(--bg-input); color:var(--t1); font-size:13px;" onchange="S.cmpOffset=parseInt(this.value); _initCmpPeriods(); renderReport();">
                <option value="1" ${S.cmpOffset===1 ? 'selected' : ''}>與 前 1 年</option>
                <option value="3" ${S.cmpOffset===3 ? 'selected' : ''}>與 前 3 年</option>
                <option value="5" ${S.cmpOffset===5 ? 'selected' : ''}>與 前 5 年</option>
              </select>`
          }
        </div>
      </div>
      
      <div style="display:flex; justify-content:space-between; align-items:center; background: #ffffff; padding: 5px 10px; border-radius: 20px; border: 1px solid #cbd5e1; margin-bottom: 10px;">
        <button class="btn btn3" onclick="navCmpTime(-1)" style="width: 42px; height: 42px;">◀</button>
        <span onclick="openCompareDatePicker()" style="font-family:var(--mono); font-size: 18px; font-weight: 900; color: #006eff; letter-spacing: 0px; text-align: center; flex: 1; cursor:pointer;">${navLabel} <span style="color:#94a3b8; font-size:13px; vertical-align:middle;">▼</span></span>
        <button class="btn btn3" onclick="navCmpTime(1)" style="width: 42px; height: 42px;">▶</button>
      </div>
    </div>
  `;

  // 👇 ================== 1. 大數據前月比較專屬 UI ==================
  if (isPrevMonth) {
    if (!S.rptCmpFilter) S.rptCmpFilter = 'all';
    const activePlats = S.platforms.filter(p => p.active);
    
    // 平台切換器 (縮小下邊距)
    html += `<div style="display:flex; gap:8px; margin-bottom:6px; overflow-x:auto; padding-bottom:4px;">
      <button onclick="S.rptCmpFilter='all'; renderReport()" style="flex-shrink:0; padding:6px 14px; border-radius:18px; font-size:13px; font-weight:800; border:none; cursor:pointer; transition:0.2s; ${S.rptCmpFilter === 'all' ? 'background:var(--acc); color:#fff; box-shadow:0 2px 6px rgba(255,107,53,0.3);' : 'background:var(--sf); color:var(--t2); border:1px solid var(--border);'}">全部平台</button>`;
    
    activePlats.forEach(p => {
      let isActive = S.rptCmpFilter === p.id;
      html += `<button onclick="S.rptCmpFilter='${safeText(p.id)}'; renderReport()" style="flex-shrink:0; padding:6px 14px; border-radius:18px; font-size:13px; font-weight:800; border:none; cursor:pointer; transition:0.2s; ${isActive ? `background:${p.color}; color:#fff; box-shadow:0 2px 6px ${p.color}50;` : `background:var(--sf); color:${p.color}; border:1px solid ${p.color}50;`}">${safeText(p.name)}</button>`;
    });
    html += `</div>`;

    // 🌟 全新設計：電競對戰風 VS 資訊框 (左紅 vs 右藍)
    const targetYMStr = S.cmpTargetYM.replace('-', '/');
    const baseYMStr = `${S.cmpBaseYear}/${pad(S.cmpBaseMonth)}`;
    
    html += `
      <div style="display:flex; justify-content:center; align-items:center; margin-bottom:10px; padding: 0 4px;">
        
        <!-- 左側：比較目標 (熱情紅) -->
        <div style="flex:1; background:linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border-radius:16px 4px 4px 16px; padding:8px 6px; text-align:center; box-shadow:0 4px 10px rgba(220,38,38,0.2); position:relative; overflow:hidden;">
          <div style="font-size:10px; color:#fecdd3; font-weight:900; letter-spacing:1px; margin-bottom:2px;">比較對象</div>
          <div style="font-size:15px; color:#ffffff; font-weight:900; font-family:var(--mono); letter-spacing:0.5px;">${targetYMStr}</div>
        </div>
        
        <!-- 中間：閃電 VS 圖示 -->
        <div style="background:#ffffff; border:3px solid #1e293b; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:900; font-family:var(--mono); color:#1e293b; z-index:2; margin: 0 -12px; box-shadow:0 0 0 3px #f8fafc;">
          VS
        </div>
        
        <!-- 右側：基準月 (科技藍) -->
        <div style="flex:1; background:linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border-radius:4px 16px 16px 4px; padding:8px 6px; text-align:center; box-shadow:0 4px 10px rgba(37,99,235,0.2); position:relative; overflow:hidden;">
          <div style="font-size:10px; color:#bfdbfe; font-weight:900; letter-spacing:1px; margin-bottom:2px;">當前基準</div>
          <div style="font-size:15px; color:#ffffff; font-weight:900; font-family:var(--mono); letter-spacing:0.5px;">${baseYMStr}</div>
        </div>
        
      </div>
    `;

    // 取得 本月(基準A) 與 比較月(B) 資料
    let recsA = getMonthRecs(S.cmpBaseYear, S.cmpBaseMonth);
    let recsB = S.records.filter(r => r.date && r.date.startsWith(S.cmpTargetYM));
    if (S.rptCmpFilter !== 'all') {
      recsA = recsA.filter(r => r.platformId === S.rptCmpFilter);
      recsB = recsB.filter(r => r.platformId === S.rptCmpFilter);
    }

    // 計算數據
    const calcData = (recs) => {
      const total = recs.reduce((s, r) => s + recTotal(r), 0);
      const orders = recs.reduce((s, r) => s + pf(r.orders), 0);
      const hours = calcTotalHours(recs);
      const mileage = recs.reduce((s, r) => s + pf(r.mileage), 0);
      const workDays = new Set(recs.map(r => r.date)).size;
      return { total, orders, hours, mileage, workDays };
    };

    const dA = calcData(recsA);
    const dB = calcData(recsB);

    // 👇 1. 定義符號精細化樣式函式
    const sSym = (txt) => `<span style="font-size:9px; font-weight:500; opacity:0.9; margin:5px 2.5px 0 2.5px;">${txt}</span>`;
    const sIcon = (icon) => `<span style="font-size:14px; font-weight:normal; margin-right:2px;">${icon}</span>`;

    // 👇 2. 修改後的漲跌標籤函式 (符號全縮小變細)
    const getDiffBadge = (valA, valB, formatType, isReverseLogic = false) => {
      // 1. 先做四捨五入到小數第一位，避免 3.1 - 2.9 = 0.3 的問題
      const vA = Math.round(valA * 10) / 10;
      const vB = Math.round(valB * 10) / 10;
      const diff = vA - vB;
      const absDiff = Math.abs(diff);

      if (absDiff === 0 || valB === 0) return `<span style="font-size:11px; color:var(--t3); font-weight:400;">—</span>`;
      const isUp = diff > 0;
      const color = isReverseLogic ? (isUp ? '#dc2626' : '#16a34a') : (isUp ? '#16a34a' : '#dc2626'); 
      const bg = isReverseLogic ? (isUp ? '#fee2e2' : '#dcfce7') : (isUp ? '#dcfce7' : '#fee2e2');
      const icon = isReverseLogic ? (isUp ? '▼' : '▲') : (isUp ? '▲' : '▼'); // 里程增加用▼顯示警告
      
      // 修改 prefix 定義（此處 12px 可自行調整大小）
      const prefix = (formatType === 'km') ? (diff > 0 ? '<span style="font-size:10px;margin-right:2px;">+</span>':'<span style="font-size:10px;margin-right:2px;">-</span>'):'';

      if (formatType === '$') diffStr = `${sSym(prefix + '$')}${fmt(absDiff)}`; 
      else if (formatType === '$2') diffStr = `${sSym(prefix + '$')}${absDiff.toFixed(2)}`; 
      else if (formatType === '%') diffStr = `${prefix}${absDiff.toFixed(1)}${sSym('%')}`;
      else if (formatType === 'hr') diffStr = `${prefix}${absDiff.toFixed(1)}${sSym('hr')}`;
      else if (formatType === '單') diffStr = `${prefix}${fmt(absDiff)}${sSym('單')}`;
      else if (formatType === 'km') diffStr = `${prefix}${fmt(absDiff)}${sSym('km')}`;
      else if (formatType === '單/h') diffStr = `${absDiff.toFixed(1)}${sSym('單/h')}`;
      else diffStr = prefix + absDiff.toFixed(1);

      return `
        <span style="background:${bg}; color:${color}; padding:2px 10px; border-radius:12px; font-size:13px; font-weight:800; font-family:var(--mono); border:1px solid ${color}20; white-space:nowrap; display:inline-flex; align-items:center;">
          ${sIcon(icon)}${diffStr}
        </span>
      `;
    };

    // 計算均值
    const avgIncomeA = dA.workDays > 0 ? (dA.total / dA.workDays) : 0;
    const avgIncomeB = dB.workDays > 0 ? (dB.total / dB.workDays) : 0;
    const avgHrA = dA.hours > 0 ? (dA.total / dA.hours) : 0;
    const avgHrB = dB.hours > 0 ? (dB.total / dB.hours) : 0;
    const avgOrdKmA = dA.mileage > 0 ? (dA.total / dA.mileage) : 0;
    const avgOrdKmB = dB.mileage > 0 ? (dB.total / dB.mileage) : 0;
    const avgOrdHrA = dA.hours > 0 ? (dA.orders / dA.hours) : 0;
    const avgOrdHrB = dB.hours > 0 ? (dB.orders / dB.hours) : 0;
    const avgOrdPriceA = dA.orders > 0 ? (dA.total / dA.orders) : 0;
    const avgOrdPriceB = dB.orders > 0 ? (dB.total / dB.orders) : 0;

    // 👇 3. 建立數據卡片清單 (月收入改為 '$' 比較)
    const cards = [
      { t: '月收入', v: `${sSym('$')} ${fmt(dA.total)}`, c: '#3b82f6', diff: getDiffBadge(dA.total, dB.total, '$') },
      { t: '總單量', v: `${fmt(dA.orders)} ${sSym('單')}`, c: '#10b981', diff: getDiffBadge(dA.orders, dB.orders, '單') },
      { t: '均單價', v: `${sSym('$')} ${avgOrdPriceA.toFixed(1)}`, c: '#f59e0b', diff: getDiffBadge(avgOrdPriceA, avgOrdPriceB, '$2') }, 

      { t: '總工時', v: `${dA.hours.toFixed(1)} ${sSym('hr')}`, c: '#ef4444', diff: getDiffBadge(dA.hours, dB.hours, 'hr') },
      { t: '時薪', v: `${sSym('$')} ${avgHrA.toFixed(1)}`, c: '#8b5cf6', diff: getDiffBadge(avgHrA, avgHrB, '$2') }, 
      { t: '均單量', v: `${avgOrdHrA.toFixed(1)} ${sSym('單/h')}`, c: '#06b6d4', diff: getDiffBadge(avgOrdHrA, avgOrdHrB, '單/h') }, 

      { t: '日均收入', v: `${sSym('$')} ${avgIncomeA.toFixed(1)}`, c: '#ec4899', diff: getDiffBadge(avgIncomeA, avgIncomeB, '$2') },
      { t: '里程', v: `${fmt(dA.mileage)} ${sSym('km')}`, c: '#f97316', diff: getDiffBadge(dA.mileage, dB.mileage, 'km', true) },
      { t: '公里均價', v: `${sSym('$')} ${avgOrdKmA.toFixed(1)}`, c: '#64748b', diff: getDiffBadge(avgOrdKmA, avgOrdKmB, '$2') } 
    ];

    // 👇 4. 渲染 3x3 信封網格
    const envColors = cards.map(c => c.c);
    html += `<div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin-bottom:12px; padding:0 2px;">`;

    cards.forEach((c, i) => {
      const themeColor = envColors[i];
      html += `
        <div style="background:#ffffff; border-radius:12px; position:relative; overflow:hidden; border:1px solid #e2e8f0; box-shadow:0 4px 10px rgba(0,0,0,0.05); display:flex; flex-direction:column; min-height:95px; transition:0.2s;">
          
          <!-- 👇 信封蓋 (Envelope Flap) -->
          <div style="height:22px; background:${themeColor}; display:flex; align-items:center; justify-content:center; position:relative; z-index:2;">
            <span style="color:#ffffff; font-size:12px; font-weight:750; letter-spacing:0.5px; text-shadow:0 1px 2px rgba(0,0,0,0.1); padding-bottom:2px;">${c.t}</span>
            
            <!-- 信封尖角裝飾 (利用 CSS 三角形) -->
            <div style="position:absolute; bottom:-8px; left:50%; transform:translateX(-50%); width:0; height:0; border-left:10px solid transparent; border-right:10px solid transparent; border-top:8px solid ${themeColor};"></div>
          </div>

          <!-- 👇 信封內容 (Envelope Body) -->
          <div style="padding:14px 4px 6px 4px; flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; background:linear-gradient(to bottom, #fcfcfc, #ffffff);">
            <!-- 數值 -->
            <div style="font-family:var(--mono); font-size:16px; font-weight:900; color:#1e293b; line-height:1.2; margin-bottom:4px; text-align:center;">
              ${c.v}
            </div>
            <!-- 漲跌標籤 -->
            <div style="transform: scale(0.9);">
              ${c.diff}
            </div>
          </div>
          
          <!-- 底部裝飾線 (讓它更像實體信封) -->
          <div style="height:5px; background:${themeColor}; opacity:0.3;"></div>
        </div>
      `;
    });

    html += `</div>`;
    
    el.innerHTML = html;
    return; // 大數據模式畫完就結束
  }

  // 👇 ================== 2. 歷史同月/全年比較 (保留原本的進度條設計) ==================
  let comparisons = S.cmpPeriods.map((p, i) => {
    let total = 0; 
    if(isMonth) {
      const parts = p.split('-'); 
      if(parts.length===2) {
         total = getMonthRecs(parts[0], parts[1]).reduce((s,r)=>s+recTotal(r),0);
      }
    } else {
      total = S.records.filter(r=>r.date.startsWith(`${p}-`)).reduce((s,r)=>s+recTotal(r),0);
    }
    const isCurrent = (i === 0);
    const label = isCurrent ? '當前設定' : (isMonth ? '歷史同月' : '歷史全年');
    return { label, periodStr: p, total, isCurrent };
  });

  const maxV = Math.max(...comparisons.map(c => c.total), 1);

  html += `<div class="card" style="margin-bottom:12px;">`;
  
  comparisons.forEach((c, index) => {
    let diffStr = '基準';
    let diffColor = 'var(--t3)';
    let barColor = c.isCurrent ? 'var(--acc)' : 'var(--blue)';

    if (index < comparisons.length - 1) {
      const prevYearData = comparisons[index + 1];
      const diff = c.total - prevYearData.total;
      
      if (diff === 0) {
          diffStr = '—';
          diffColor = 'var(--t3)';
      } else if (diff > 0) {
          diffStr = `+$ ${fmt(diff)}`;
          diffColor = 'var(--green)';
      } else {
          diffStr = `-$ ${fmt(Math.abs(diff))}`;
          diffColor = 'var(--red)';
      }
    }

    const pct = Math.round((c.total / maxV) * 100);
    const mBot = index === comparisons.length - 1 ? '4px' : '16px';
    
    html += `
    <div style="margin-bottom:${mBot};">
      <!-- 👇 改用 Grid 網格，強制 3 等分 (1fr 1fr 1fr) -->
      <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; align-items:baseline; margin-bottom:6px; width:100%;">
        
        <!-- 1. 左邊：標題與時間 (靠左對齊) -->
        <div style="text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          <span style="font-weight:800; font-size:12px; color:${c.isCurrent ? 'var(--acc)' : 'var(--t2)'}">${c.label} <span style="font-size:11px; color:var(--t3); font-family:var(--mono);">(${c.periodStr})</span></span>
        </div>
        
        <!-- 2. 中間：總金額 (置中對齊) -->
        <div style="text-align:center;">
          <span style="font-family:var(--mono); font-size:16px; font-weight:900; color:${c.isCurrent ? 'var(--acc)' : 'var(--t1)'}">$ ${fmt(c.total)}</span>
        </div>
        
        <!-- 3. 右邊：比較差異 (靠右對齊) -->
        <div style="text-align:right;">
          <span style="font-size:12px; color:${diffColor}; font-weight:800;">${diffStr}</span>
        </div>
        
      </div>
      <div class="progress-track" style="height:10px; background:var(--bg-input);"><div class="progress-fill" style="width:${pct}%;background:${barColor}"></div></div>
    </div>`;
  });
  
  html += `</div>`;

  html += `
    <div class="card">
      <div style="font-size:13px; font-weight:800; color:var(--t2); margin-bottom:12px;">📈 區間歷史走勢圖</div>
      <div style="height:220px; position:relative;"><canvas id="cmp-line-chart"></canvas></div>
    </div>
  `;

  el.innerHTML = html;

  const ctx = document.getElementById('cmp-line-chart')?.getContext('2d');
  if (ctx) {
    if (S.charts['cmp-line-chart']) { S.charts['cmp-line-chart'].destroy(); }
    
    const chartDataReversed = [...comparisons].reverse();
    const labels = chartDataReversed.map(c => c.periodStr);
    const data = chartDataReversed.map(c => c.total);

    S.charts['cmp-line-chart'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: '總收入',
          data: data,
          borderColor: '#FF6B35',
          backgroundColor: 'rgba(255, 107, 53, 0.1)',
          borderWidth: 3,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#FF6B35',
          pointRadius: 5,
          pointHoverRadius: 7,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10, weight: 'bold' } } },
          y: { 
            beginAtZero: true, 
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { callback: v => v >= 1000 ? (v/1000).toFixed(1)+'k' : v, font: { size: 10 } }
          }
        }
      }
    });
  }
}

/* 替換：TOP 5 競賽排行榜 (已修復：去除單純只有打卡與現金小費的日子) */
function renderRptTop3() {
  const el = document.getElementById('rv-top3'); 
  const monthRecs = getMonthRecs(S.rptY, S.rptM); 
  
  // 1. 預先整理每日的完整數據
  const dayStats = {};
  
  monthRecs.forEach(r => {
    if (!dayStats[r.date]) {
      const d = new Date(r.date + 'T00:00:00');
      dayStats[r.date] = {
        date: r.date,
        dateStr: `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`,
        dowStr: ['日','一','二','三','四','五','六'][d.getDay()],
        total: 0,
        orders: 0,
        rawRecs: [],
        hasValidTrip: false // 👈 新增標記：用來判斷這天有沒有「一般行程」
      };
    }
    
    // 💡 將所有記錄（含打卡、小費）都塞進去，供智慧工時系統分析
    dayStats[r.date].rawRecs.push(r);
    
    // 💡 只有「非打卡 且 非現金小費」的實質行程，才計算收入與單數，並標記為有效日
    if (!r.isPunchOnly && !r.isCashTip) {
      dayStats[r.date].total += recTotal(r);
      dayStats[r.date].orders += pf(r.orders);
      dayStats[r.date].hasValidTrip = true;
    }
  });

  // 2. 嚴格過濾：只保留有「實際跑單」的日子，並計算精準工時
  const validDays = Object.values(dayStats).filter(ds => ds.hasValidTrip);
  
  validDays.forEach(ds => {
    ds.hours = calcTotalHours(ds.rawRecs);
  });

  // 3. 排序邏輯：總收入(降冪) > 總工時(升冪) > 單數(升冪)
  const sortedDays = validDays.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total; // 錢多者勝
    if (a.hours !== b.hours) return a.hours - b.hours; // 時間短者勝
    return a.orders - b.orders; // 單數少者勝
  });

  // 4. 處理「完全平手」的並列邏輯
  let groupedRanks = [];
  let currentGroup = [];
  
  sortedDays.forEach(day => {
    if (currentGroup.length === 0) {
      currentGroup.push(day);
    } else {
      const prev = currentGroup[0];
      if (day.total === prev.total && day.hours === prev.hours && day.orders === prev.orders) {
        currentGroup.push(day);
      } else {
        groupedRanks.push(currentGroup);
        currentGroup = [day];
      }
    }
  });
  if (currentGroup.length > 0) groupedRanks.push(currentGroup);
  
  // 只取前 5 名
  groupedRanks = groupedRanks.slice(0, 5);

  // 渲染導航列
  let html = `
    <div style="display:flex; justify-content:space-between; align-items:center; background: #ffffff; padding: 5px 10px; border-radius: 20px; border: 1px solid #cbd5e1; margin-bottom: 10px;">
      <button class="btn btn1" onclick="navRptMonth(-1)" style="width: 42px; height: 42px;">◀</button>
      <span onclick="openTop3DatePicker()" style="font-family:var(--mono); font-size: 18px; font-weight: 900; color: #1e293b; letter-spacing: 0px; text-align: center; flex: 1; cursor:pointer;">
        <span style="color: #006eff; font-size: 22px;">${S.rptY}</span> 年 
        <span style="color: #006eff; font-size: 22px;">${S.rptM}</span> 月
        <span style="color:#94a3b8; font-size:13px; vertical-align:middle;">▼</span>
      </span>
      <button class="btn btn1" onclick="navRptMonth(1)" style="width: 42px; height: 42px;">▶</button>
    </div>`;

  if (!groupedRanks.length) { 
    html += `<div class="empty-tip" style="margin-top:40px;">本月暫無有效行程記錄</div>`; 
    el.innerHTML = html;
    return;
  }

  html += `
    <div style="display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:8px;">
      <span style="font-size:20px;">🏆</span>
      <span style="font-size:16px; font-weight:900; color:var(--t1); letter-spacing:1px;">本月 TOP5 榜單</span>
      <span style="font-size:20px;">🏆</span>
    </div>
    <div style="display:flex; flex-direction:column; gap:8px; padding-bottom:24px;">
  `;

  // 5. 渲染各名次卡片
  groupedRanks.forEach((group, i) => {
    const stats = group[0];
    const total = stats.total;
    const orders = stats.orders;
    const hours = stats.hours;

    const datesHtml = group.map(d => 
      `<div style="margin-bottom:2px;">${d.dateStr} (週${d.dowStr})</div>`
    ).join('');

    let bgStyle, borderLeft, dateColor, valueColor;
    let medalBox = ''; 
    let pillBorder, pillLeftBg, pillLeftText, pillRightBg, pillRightText;

    if (i === 0) { // 🥇 冠軍
      bgStyle = 'linear-gradient(135deg, #fde68a 0%, #fef3c7 100%)';
      borderLeft = '#f59e0b'; dateColor = '#b45309'; valueColor = '#b45309';
      medalBox = `<div style="width:56px; height:56px; border-radius:16px; background:rgba(255,255,255,0.9); backdrop-filter:blur(2px); -webkit-backdrop-filter:blur(8px); border:1.5px solid rgba(255,255,255,0.9); display:flex; align-items:center; justify-content:center; box-shadow:0 4px 12px rgba(0,0,0,0.06); font-size:36px; flex-shrink:0;">🥇</div>`;
      pillBorder = '#fde047'; pillLeftBg = '#fff9c9'; pillLeftText = '#c66b03'; pillRightBg = '#ffffff'; pillRightText = '#d97706';
    } else if (i === 1) { // 🥈 亞軍
      bgStyle = 'linear-gradient(135deg, #f1f5f9 0%, #f8fafc 100%)';
      borderLeft = '#94a3b8'; dateColor = '#475569'; valueColor = '#475569';
      medalBox = `<div style="width:56px; height:56px; border-radius:16px; background:rgba(255,255,255,0.9); backdrop-filter:blur(2px); -webkit-backdrop-filter:blur(8px); border:1.5px solid rgba(255,255,255,0.9); display:flex; align-items:center; justify-content:center; box-shadow:0 4px 12px rgba(0,0,0,0.06); font-size:36px; flex-shrink:0;">🥈</div>`;
      pillBorder = '#e2e8f0'; pillLeftBg = '#f1f5f9'; pillLeftText = '#64748b'; pillRightBg = '#ffffff'; pillRightText = '#475569';
    } else if (i === 2) { // 🥉 季軍
      bgStyle = 'linear-gradient(135deg, #ffedd5 0%, #fff7ed 100%)';
      borderLeft = '#f97316'; dateColor = '#c2410c'; valueColor = '#c2410c';
      medalBox = `<div style="width:56px; height:56px; border-radius:16px; background:rgba(255,255,255,0.9); backdrop-filter:blur(2px); -webkit-backdrop-filter:blur(8px); border:1.5px solid rgba(255,255,255,0.9); display:flex; align-items:center; justify-content:center; box-shadow:0 4px 12px rgba(0,0,0,0.06); font-size:36px; flex-shrink:0;">🥉</div>`;
      pillBorder = '#fed7aa'; pillLeftBg = '#ffedd5'; pillLeftText = '#ea580c'; pillRightBg = '#ffffff'; pillRightText = '#c2410c';
    } else { // 4️⃣ & 5️⃣ 第四、第五名
      bgStyle = '#ffffff';
      borderLeft = '#cbd5e1'; dateColor = '#64748b'; valueColor = '#475569';
      const numColor = i === 3 ? '#64748b' : '#94a3b8';
      medalBox = `<div style="width:40px; height:40px; border-radius:50%; background:#f8fafc; border:2px solid ${numColor}; display:flex; align-items:center; justify-content:center; font-family:var(--mono); font-size:18px; font-weight:900; color:${numColor}; flex-shrink:0;">${i + 1}</div>`;
      pillBorder = '#e2e8f0'; pillLeftBg = '#f8fafc'; pillLeftText = '#64748b'; pillRightBg = '#ffffff'; pillRightText = '#475569';
    }

    let pillsHtml = '';
    if (orders > 0 || hours > 0) {
      pillsHtml = `
        <div style="display:inline-flex; align-items:stretch; border-radius:6px; border:2px solid ${pillBorder}; overflow:hidden; box-shadow:0 1px 2px rgba(0,0,0,0.03); margin-top:2px;">
          ${orders > 0 ? `<span style="padding:2px 8px; background:${pillLeftBg}; font-size:11px; font-weight:800; color:${pillLeftText}; font-family:var(--mono); border-right:2px solid ${pillBorder}; letter-spacing:0.7px;">${orders}<span style="font-size:9px; font-weight:600;"> 單</span></span>` : ''}
          ${hours > 0 ? `<span style="padding:2px 8px; background:${pillRightBg}; font-size:11px; font-weight:800; color:${pillRightText}; font-family:var(--mono); letter-spacing:1px;">${fmtHours(hours)}</span>` : ''}
        </div>
      `;
    }

    html += `
      <div style="background: ${bgStyle}; border-radius:20px; padding:8px 13px; display:flex; align-items:center; justify-content:space-between; border:3px solid ${pillBorder}; position:relative; overflow:hidden;">
        <div style="position:absolute; left:0; top:0; bottom:0; width:8px; background:${borderLeft};"></div>
        <div style="display:flex; align-items:center; gap:12px; padding-left:6px; flex:1;">
          ${medalBox}
          <div style="display:flex; flex-direction:column; justify-content:center;">
            <div style="font-size:14px; font-weight:900; color:${dateColor}; line-height:1.4; margin-bottom:2px;">
              ${datesHtml}
            </div>
            <div>${pillsHtml}</div>
          </div>
        </div>
        <div style="font-family:var(--mono); font-size:22px; font-weight:800; color:${valueColor}; text-align:right; flex-shrink:0; padding-left:10px;">
          <span style="font-size:11px; opacity:0.85;">$ </span>${fmt(total)}
        </div>
      </div>
    `;
  });

  html += `</div>`;
  el.innerHTML = html;
}

/* 👈 不同顏色間白色細線分隔、金額藍字粗體標示於柱頂 */
function drawStructBar(canvasId, labels, data, colors) {
  const ctx = document.getElementById(canvasId)?.getContext('2d'); if (!ctx) return;
  if (S.charts[canvasId]) { S.charts[canvasId].destroy(); }

  const style = getComputedStyle(document.documentElement);
  const textColor = style.getPropertyValue('--chart-text').trim() || '#1C1917';
  const totalSum = data.reduce((a,b)=>a+b,0);

  // 金額標示（藍字粗體），置於上方，避免與柱體重疊
  const valueLabelPlugin = {
    id: 'structValueLabel',
    afterDatasetsDraw(chart) {
      const cctx = chart.ctx;
      const meta = chart.getDatasetMeta(0);
      meta.data.forEach((bar, i) => {
        const val = chart.data.datasets[0].data[i];
        if (!val) return;
        cctx.save();
        cctx.fillStyle = '#1d4ed8';
        cctx.font = 'bold 12px sans-serif';
        cctx.textAlign = 'center';
        cctx.fillText('$' + fmt(val), bar.x, bar.y - 10);
        cctx.restore();
      });
    }
  };

  S.charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#ffffff', borderWidth: 2, borderRadius: 6, maxBarThickness: 56 }] },
    plugins: [valueLabelPlugin],
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 26 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => { const pct = totalSum > 0 ? ((c.parsed.y/totalSum)*100).toFixed(1).replace('.0','') : '0'; return ` NT$ ${fmt(c.parsed.y)} (${pct}%)`; } } }
      },
      scales: {
        x: { ticks: { color: textColor, font: { size: 11, weight: '700' } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: textColor, callback: v => v >= 1000 ? (v/1000).toFixed(1).replace('.0','')+'k' : v, font: { size: 10 } }, grid: { color: 'rgba(0,0,0,.05)' } }
      },
      animation: { duration: 400 }
    }
  });
}

function drawPie(canvasId, labels, data, colors) {
  const ctx = document.getElementById(canvasId)?.getContext('2d'); if (!ctx) return;
  if (S.charts[canvasId]) { S.charts[canvasId].destroy(); }
  
  // 計算總金額供 Tooltip 計算 % 數
  const totalSum = data.reduce((a, b) => a + b, 0);

  S.charts[canvasId] = new Chart(ctx, { 
    type: 'doughnut', 
    data: { labels, datasets:[{ data, backgroundColor:colors, borderWidth:2, borderColor:'#fff' }] }, 
    options: { 
      responsive:true, 
      maintainAspectRatio:false, 
      cutout:'60%', 
      plugins:{ 
        legend:{ display:true, position:'bottom', labels:{font:{size:11},padding:8} },
        tooltip:{
          callbacks:{
            // 🌟 新增：% 數值顯示邏輯
            label: function(context) {
              const label = context.label || '';
              const val = context.raw || 0;
              const pct = totalSum > 0 ? ((val / totalSum) * 100).toFixed(1).replace('.0', '') : '0';
              return ` ${label}: NT$ ${fmt(val)} (${pct}%)`;
            }
          }
        }
      }, 
      animation:{ duration:400 } 
    } 
  });
}

function drawBar(canvasId, labels, data, color) {
  const ctx = document.getElementById(canvasId)?.getContext('2d'); if (!ctx) return;
  if (S.charts[canvasId]) { S.charts[canvasId].destroy(); }
  S.charts[canvasId] = new Chart(ctx, { type: 'bar', data: { labels, datasets:[{ data, backgroundColor:color+'99', borderRadius:6, borderWidth:0 }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>`NT$ ${fmt(c.parsed.y)}` }} }, scales:{ x:{ticks:{font:{size:10}},grid:{display:false}}, y:{ticks:{callback:v=>v>=1000?(v/1000).toFixed(1).replace('.0','')+'k':v,font:{size:9}},grid:{color:'rgba(0,0,0,.05)'}} }, animation:{ duration:400 } } });
}

/* ══ 完整替換：淨賺分析 (包含三段式切換與精確淨利計算) ══ */
// 補上全域狀態初始化 (若 S 中沒有的話)
if (!S.rptExpTimeMode) S.rptExpTimeMode = 'year'; 
S.rptExpFilter = '全部';

function renderRptNetProfit() {
  const scrollArea = document.getElementById('rv-netProfit');
  const fixedArea = document.getElementById('net-profit-sub-tabs-fixed');

  // 定義三種模式的配色與陰影
  const modes = [
    { key: 'month', label: '月結算', grad: 'linear-gradient(135deg, #3b82f6, #2563eb)', shadow: 'rgba(37, 99, 235, 0.4)' },
    { key: 'year', label: '年結算', grad: 'linear-gradient(135deg, #10b981, #059669)', shadow: 'rgba(16, 185, 129, 0.4)' },
    { key: 'expense_overview', label: '支出總覽', grad: 'linear-gradient(135deg, #f43f5e, #be123c)', shadow: 'rgba(244, 63, 94, 0.4)' }
  ];
  const curIdx = modes.findIndex(m => m.key === S.rptNetMode);
  const curConfig = modes[curIdx];

  // 1. 初始化按鈕外殼 (只在不存在時建立一次)
  if (!document.getElementById('net-profit-sub-tabs-container')) {
    fixedArea.innerHTML = `
      <div id="net-profit-sub-tabs-container" class="slide-tabs tabs-3" style="margin-bottom:0; background:rgba(0,0,0,0.06); padding:4px; border-radius: 999px;">
        <div id="net-profit-slide-bg" class="slide-bg" style="width:calc(33.33% - 4px); border-radius: 999px; transition:0.35s cubic-bezier(0.4, 0, 0.2, 1);"></div>
        ${modes.map((m, i) => `
          <button class="slide-btn" id="btn-net-mode-${m.key}" onclick="setRptNetMode('${m.key}', ${i})">${m.label}</button>
        `).join('')}
      </div>
    `;
  }
  fixedArea.style.display = 'block';

  // 2. 獲取滑塊元素並強制套用顏色 (使用 setProperty 確保 !important 生效)
  const slideBg = document.getElementById('net-profit-slide-bg');
  if (slideBg) {
    slideBg.style.transform = `translateX(${curIdx * 100}%)`;
    // 👈 核心修正：強制指定背景與陰影，壓過 CSS 設定
    slideBg.style.setProperty('background', curConfig.grad, 'important');
    slideBg.style.setProperty('box-shadow', `0 4px 12px ${curConfig.shadow}`, 'important');
  }
  
  // 更新按鈕文字狀態
  modes.forEach(m => {
    const btn = document.getElementById(`btn-net-mode-${m.key}`);
    if (btn) {
      const isActive = S.rptNetMode === m.key;
      btn.style.color = isActive ? '#fff' : '#475569';
      btn.style.fontWeight = isActive ? '800' : '600';
      btn.classList.toggle('active', isActive);
    }
  });

  // 3. 處理內容區域外殼
  if (!document.getElementById('net-profit-framed-box')) {
    scrollArea.innerHTML = `
      <div id="net-profit-framed-box" style="border: 2.5px solid #cbd5e1; border-radius: 24px; background: #ffffff; padding: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.03);">
        <div id="sub-nav-area"></div>
        <div id="sub-total-card-area"></div>
        <div id="sub-list-area"></div>
      </div>
      <div style="height:100px;"></div>
    `;
  }

  renderNetProfitSubContent();
}
// 切換模式的入口 (供按鈕點擊)
window.setRptNetMode = function(mode, idx) {
  S.rptNetMode = mode;
  const slideBg = document.getElementById('net-profit-slide-bg');
  if (slideBg) {
    const colors = {
      'month': 'linear-gradient(135deg, #3b82f6, #2563eb)',
      'year': 'linear-gradient(135deg, #10b981, #059669)',
      'expense_overview': 'linear-gradient(135deg, #f43f5e, #be123c)'
    };
    slideBg.style.background = colors[mode] || colors['month'];
  }
  renderRptNetProfit();
};
// ✨ 修正：渲染下方內容 (包含動態判斷 ◀▶ 按鈕功能)
function renderNetProfitSubContent() {
  const isExp = S.rptNetMode === 'expense_overview';
  const navArea = document.getElementById('sub-nav-area');
  const totalArea = document.getElementById('sub-total-card-area');
  const listArea = document.getElementById('sub-list-area');

  if (!navArea || !totalArea || !listArea) return;

  if (isExp) {
    const navFunc = S.rptExpTimeMode === 'year' ? 'navRptYear' : 'navRptMonth';
    // 這裡同樣建議：如果導航列已經存在，只更新文字，不重繪 innerHTML 可進一步減少閃爍
    navArea.innerHTML = `
      <div style="position: sticky; top: 0px; z-index: 100; background:#fff; padding-bottom:12px; display:flex; justify-content:space-between; align-items:center; gap:4px; border-bottom:1px dashed #e2e8f0; margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:3px; background:#f1f5f9; padding:2px 8px; border-radius:15px; border:1px solid #cbd5e1;">
          <button class="btn btn2" style="width:32px; height:32px; font-size:28px; border:1px solid #fff;border-radius:50%;" onclick="${navFunc}(-1)">◀</button>
          <span style="font-size:13px; font-weight:800; min-width:85px; text-align:center;">
             <!-- 👇 年份數字：藍色 + 間距 -->
             <span style="color:#2563eb;margin:0 4px;font-size:14px;">${S.rptY}</span><small>年</small>${S.rptExpTimeMode==='year' ? '' : `<!-- 👇 月份數字：藍色 + 間距 --><span style="color:#2563eb;margin:0 4px;font-size:14px;">${S.rptM}</span><small>月</small>`}
          </span>
          <button class="btn btn2" style="width:32px; height:32px; font-size:28px; border:1px solid #fff;border-radius:50%;" onclick="${navFunc}(1)">▶</button>
        </div>
        <button onclick="toggleExpTimeMode()" style="padding:6px 12px; border-radius:12px; border:1.5px solid #bfdbfe; background:#eff6ff; color:#2563eb; font-size:11px; font-weight:900;">
          ${S.rptExpTimeMode==='year'?'切換「月」':'切換「全年」'}
        </button>
        <select onchange="S.rptExpFilter=this.value; renderReport();" style="border:1.5px solid #cbd5e1; background:#ffffff; font-size:11px; font-weight:800; color:#475569; padding:5px; border-radius:10px; outline:none; max-width:90px;">
          ${['全部', '保險', '裝備', '規費', '貸款、分期'].map(c => `<option value="${c}" ${S.rptExpFilter===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
    `;
    renderActualExpenseList(totalArea, listArea);
  } else {
    // 渲染結算頁面導航
    const styleNum = (val) => `<span style="font-size: 20px; font-weight: 900; color: #006eff; font-family: var(--mono); vertical-align: middle;">${val}</span>`;
    const styleUnit = (txt) => `<span style="font-size: 12px; font-weight: 800; color: #000; margin: 0 1px; vertical-align: middle;">${txt}</span>`;
    const isMonth = S.rptNetMode === 'month';
    
    navArea.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; background: #f8fafc; padding: 5px 10px; border-radius: 20px; border: 1px solid #cbd5e1; margin-bottom: 12px;">
        <button class="btn btn2" style="width:42px; height:42px;" onclick="${isMonth?'navRptMonth(-1)':'navRptYear(-1)'}">◀</button>
        <span onclick="openNetProfitDatePicker()" style="text-align:center; flex:1; cursor:pointer;">
           ${isMonth ? `${styleNum(S.rptY)}${styleUnit('年')}${styleNum(S.rptM)}${styleUnit('月')}` : `${styleNum(S.rptY)}${styleUnit('年 全年')}`}
           <span style="color:#94a3b8; font-size:13px; vertical-align:middle;">▼</span>
        </span>
        <button class="btn btn2" style="width:42px; height:42px;" onclick="${isMonth?'navRptMonth(1)':'navRptYear(1)'}">▶</button>
      </div>
    `;
    totalArea.innerHTML = ''; 
    renderNetProfitStats(listArea);
  }
}
function renderActualExpenseList(totalArea, listArea) {
  const isYear = S.rptExpTimeMode === 'year';
  const prefix = isYear ? `${S.rptY}-` : `${S.rptY}-${pad(S.rptM)}`;
  const filter = S.rptExpFilter || '全部';

  if (!S.generalExpenses) S.generalExpenses = [];
  let list = S.generalExpenses.filter(e => e.date.startsWith(prefix));
  if (filter !== '全部') list = list.filter(e => e.category === filter);

  const total = list.reduce((s, e) => s + pf(e.amount), 0);
  list.sort((a,b) => b.date.localeCompare(a.date));

  // 1. 更新總額卡片區 (在這裡更新就不會閃爍)
  const rptYear =
    `<span style="font-size: 18px;color:#f8fafc; font-weight:900;">${S.rptY}</span>` +
    `<span style="color: #00ddff; font-weight:900;"> 年</span>`;

  const rptMonth = isYear
    ? `<span style="font-size: 17px;color:#f8fafc; font-weight:800;"> 全年</span>`
    : `<span style="font-size: 18px;color:#f8fafc; font-weight:900;"> ${S.rptM}</span>` +
      `<span style="color: #00ddff; font-weight:900;"> 月</span>`;

  totalArea.innerHTML = `
    <div style="background: #1e293b; border-radius: 14px; padding: 14px 18px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; border: 1.5px solid #334155; position: relative; overflow: hidden;">
      <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: #fbbf24;"></div>

      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-family: var(--mono);font-size: 14px; font-weight: 900;">
          ${rptYear}${rptMonth}
        </span>

        <span style="font-size: 16px; font-weight: 800; color: #b1c2da; border-left: 2px solid #475569; padding-left:10px;">
          支出累計
        </span>
      </div>

      <span style="font-family: var(--mono); font-size: 26px; font-weight: 1000; color: #fbbf24; text-shadow: 0 0 10px rgba(251,191,36,0.3);">
        <span style="font-size:14px;margin-right:6px;">$</span>${fmt(total)}
      </span>
    </div>
  `;

  // 2. 更新列表區
  if (list.length === 0) {
    listArea.innerHTML = `<div class="empty-tip" style="padding:40px; border:1px solid #e2e8f0; border-radius:16px;">目前查無支出記錄</div>`;
  } else {
    listArea.innerHTML = `<div style="display:flex; flex-direction:column; gap:8px;">` + 
      list.map(e => {
        const icons = {'保險':'🛡️','裝備':'📦','規費':'📜','貸款、分期':'💳'};
        return `
          <div style="background:#ffffff;border-radius:18px;border:1.5px solid #e2e6eb;padding:10px 14px;display:grid;grid-template-columns:45px 1fr auto;align-items:center;margin-bottom:5px;">
            <!-- 圖示區 -->
            <div style="width:40px; height:40px; background:#f8fafc; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:20px;">
              ${icons[e.category] || '💸'}
            </div>
            <!-- 文字區 -->
            <div style="padding-left:12px; overflow:hidden;">
              <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px;">
                <span style="font-size:15px; font-weight:800; color:#1e293b;">${e.category}</span>
                <span style="background: #e1eeff; color:#2563eb; font-size:12px; font-weight:900; padding:3px 10px; border-radius:20px;margin-left:5px;letter-spacing:0.8px;">${e.date.substring(5)}</span>
              </div>
              <div style="font-size:12px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${e.note || '無備註'}</div>
            </div>
            <!-- 金額與刪除 -->
            <div style="display:flex; align-items:center; gap:12px;">
              <span style="font-family:var(--mono); font-size:18px; font-weight:850; color:#dc2626;"><span style="font-size:10px;margin-right:3px;">$</span>${fmt(e.amount)}</span>
              <div onclick="deleteGeneralExpense('${e.id}')" style=" width:24px;height:24px;background:#334155;border-radius:99px;color:#94a3b8;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;line-height:1;">✕</div>
            </div>
          </div>
        `;
      }).join('') + `</div>`;
  }
}

// 輔助：渲染結算數據 (原本 renderRptNetProfit 的邏輯)
function renderNetProfitStats(container) {
  const isMonth = S.rptNetMode === 'month';
  const prefix = isMonth ? `${S.rptY}-${pad(S.rptM)}` : `${S.rptY}-`;

  const totalInc = S.records.filter(r => r.date.startsWith(prefix) && !r.isPunchOnly && !r.isCashTip).reduce((sum, r) => sum + recTotal(r), 0);
  const vRecs = S.vehicleRecs.filter(r => r.date.startsWith(prefix));
  const totalFuel = vRecs.filter(r => r.type === 'fuel').reduce((sum, r) => sum + pf(r.amount), 0);
  const totalMaint = vRecs.filter(r => r.type === 'maintenance').reduce((sum, r) => sum + pf(r.amount), 0);
  const totalWash = vRecs.filter(r => r.type === 'wash').reduce((sum, r) => sum + pf(r.amount), 0);
  const gExps = S.generalExpenses.filter(e => e.date.startsWith(prefix));
  const totalIns = gExps.filter(e => e.category === '保險').reduce((s, e) => s + pf(e.amount), 0);
  const totalEquip = gExps.filter(e => e.category === '裝備').reduce((s, e) => s + pf(e.amount), 0);
  const totalFee = gExps.filter(e => e.category === '規費').reduce((s, e) => s + pf(e.amount), 0);
  const totalLoan = gExps.filter(e => e.category === '貸款、分期').reduce((s, e) => s + pf(e.amount), 0);

  const totalExp = totalFuel + totalMaint + totalWash + totalIns + totalEquip + totalFee + totalLoan;
  const netProfit = totalInc - totalExp;
  
  // 👈 [需求 2]：% 數值的顏色與背景判斷
  const totalPct = totalInc > 0 ? ((totalExp / totalInc) * 100).toFixed(1) : '0';
  const isOverBudget = totalExp > totalInc;
  const pctColor = isOverBudget ? '#ef4444' : '#16a34a';
  const pctBg = isOverBudget ? '#fee2e2' : '#f0fdf4';
  const pctBorder = isOverBudget ? '#f87171' : '#86efac';

  let statusBadge = '';
  if (totalInc > 0) {
    statusBadge = `<div style="margin-bottom:16px; display:inline-flex; align-items:center; gap:8px; background:${netProfit >= 0 ? '#f0fdf4' : '#fef2f2'}; padding:6px 16px; border-radius:16px; border:2px solid ${netProfit >= 0 ? '#37e075' : '#f55f5f'};">
         <span style="font-size:16px;">${netProfit >= 0 ? '🎉' : '⚠️'}</span>
         <span style="font-size:13px; font-weight:700; color:#000000;letter-spacing:0.6px;">
            目前為<span style="font-weight:750;font-size:15px;margin:0 2px;color:${netProfit >= 0 ? '#088737' : '#ff0000'};">${netProfit >= 0 ? '獲利' : '虧損'}</span>狀態
         </span>
      </div>`;
  }

  const getPctBadge = (val, color) => {
    if (totalInc <= 0) return '';
    const itemPct = ((val / totalInc) * 100).toFixed(1);
    return `<span style="background:${color}15; color:${color}; border:1.8px solid ${color}; padding:2px 8px; border-radius:8px; font-size:12px; font-weight:900; font-family:var(--mono); min-width:55px; text-align:center;">${itemPct}%</span>`;
  };

  // 👈 [需求 1]：補回區間總淨利的卡片框線設計
  container.innerHTML = `
    <div style="background:#fff; border:3px solid #cbd5e1; border-radius:24px; padding:10px 16px 16px 16px; text-align:center; margin-bottom:10px;">
      ${statusBadge}
      <div style="font-size:15px; font-weight:800; color:#64748b; margin-bottom:12px;">💰 區間總淨利 (收入－總支出)</div>
      <div style="font-family: var(--mono); font-size: 36px; font-weight: 1000; color: ${netProfit >= 0 ? '#16a34a' : '#dc2626'};"><span style="font-size:18px;margin-right:6px;">$</span>${fmt(netProfit)}</div>
    </div>

    <div style="background: #0c7d35;border-radius:16px;padding:12px 20px 12px 18px;display:flex;justify-content:space-between;align-items:center;margin:8px 0;">
       <span style="font-weight:800; color:#fff; font-size:18px;">外送總收入</span>
       <span style="font-family:var(--mono); font-weight:800; font-size:18px; color:#fff;"><span style="font-size:11px;margin-right:6px;">$</span>${fmt(totalInc)}</span>
    </div>

    <div style="background:#ffffff; border:3px solid var(--acc); border-radius:20px; overflow:hidden;">
      <div style="padding:16px; background:#fff; display:flex; flex-direction:column; align-items:center; gap:10px;">
        <div style="width:100%; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:800; color:var(--text-blue); font-size:16px;">全項總支出</span>
            <span style="font-family:var(--mono); font-weight:900; color:#ef4444; font-size:22px;"><span style="font-size:12px;margin-right:6px;">$</span>${totalExp === 0 ? '0' : fmt(-totalExp)}</span>
        </div>
        
        <!-- 👈 [需求 2]：支出占比動態變色標籤 -->
        <div style="background:${pctBg}; border:2.5px solid ${pctBorder}; padding:8px 30px; border-radius:15px; display:flex; flex-direction:column; align-items:center;">
            <span style="font-size:13px; font-weight:800; color:#475569; margin-bottom:2px;">佔收入總額</span>
            <span style="font-family:var(--mono); font-size:28px; font-weight:900; color:${pctColor};">${totalPct}<small style="font-size:13px;"> %</small></span>
        </div>

        <button onclick="toggleNetExpDetail()" id="net-exp-toggle-btn" style="width:100%;background:#f1f5f9;border:none;padding:10px;border-radius:10px;color:#475569;font-weight:800;font-size:16px;cursor:pointer;margin-bottom:-10px;display:flex;align-items:center;align-content:center;justify-content:center;">
          <span id="net-exp-arrow" style="display:inline-block; transition:transform 0.35s cubic-bezier(0.4, 0, 0.2, 1); transform:rotate(0deg);font-size:22px;margin-right:5px;">▼</span><span id="net-exp-label">展開支出細項</span>
        </button>
      </div>

      <div id="net-exp-detail" style="max-height:0px; overflow:hidden; transition:max-height 0.4s ease;">
        <div style="padding:4px 12px 16px 12px; display:flex; flex-direction:column; gap:6px;">
          <div style="border-top:3px dashed #f87171; margin-bottom:5px;"></div>
          <!-- 👈 [需求 4]：簡化標籤並傳送數據至均分網格 -->
          ${renderNetRow('⛽ 燃料 / 換電', totalFuel, '#ef4444', getPctBadge(totalFuel, '#ef4444'))}
          ${renderNetRow('🔧 保養 / 維修', totalMaint, '#10b981', getPctBadge(totalMaint, '#10b981'))}
          ${renderNetRow('🧽 洗車 / 美容', totalWash, '#06b6d4', getPctBadge(totalWash, '#06b6d4'))}
          ${renderNetRow('🛡️ 保險支出', totalIns, '#6366f1', getPctBadge(totalIns, '#6366f1'))}
          ${renderNetRow('📦 裝備類', totalEquip, '#f59e0b', getPctBadge(totalEquip, '#f59e0b'))}
          ${renderNetRow('📜 規費', totalFee, '#64748b', getPctBadge(totalFee, '#64748b'))}
          ${renderNetRow('💳 貸款、分期', totalLoan, '#be123c', getPctBadge(totalLoan, '#be123c'))}
        </div>
      </div>
    </div>
  `;
}
// 6. 淨賺分析支出細項摺疊 (不重新替換HTML，保持DOM節點順暢旋轉)
window.toggleNetExpDetail = function() {
  const el = document.getElementById('net-exp-detail');
  const arrow = document.getElementById('net-exp-arrow');
  const label = document.getElementById('net-exp-label');
  if (!el) return;

  if (navigator.vibrate) try { navigator.vibrate(12); } catch(e){}

  const isCollapsed = el.style.maxHeight === '0px' || el.style.maxHeight === '';

  requestAnimationFrame(() => {
    if (isCollapsed) {
      el.style.maxHeight = '1000px';
      if (arrow) arrow.style.transform = 'rotate(180deg)';
      if (label) label.textContent = ' 收起支出細項';
    } else {
      el.style.maxHeight = '0px';
      if (arrow) arrow.style.transform = 'rotate(0deg)';
      if (label) label.textContent = ' 展開支出細項';
    }
  });
};
// 輔助：更新後的每行支出樣式 (將百分比標籤放在右邊金額旁)
function renderNetRow(label, amt, color, pctBadge) {
  return `
    <div style="background:#fff; border-radius:12px; border:1px solid #e2e8f0; padding:10px 12px; display:grid; grid-template-columns: 1fr 1fr 1fr; align-items:center;">
      <!-- 第一列：標題 靠左 -->
      <span style="font-size:13px; font-weight:800; color:#475569; text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${label}</span>
      
      <!-- 第二列：百分比 置中 -->
      <div style="display:flex; justify-content:center;">${pctBadge}</div>
      
      <!-- 第三列：金額 靠右，使用等寬字體防止數字長度擠壓 -->
      <span style="font-family:var(--mono); font-size:14px; font-weight:800; color:#1e293b; text-align:right; white-space:nowrap;">
        <span style="font-size:9px;margin-right:6px;">$</span>${fmt(amt)}
      </span>
    </div>
  `;
}

// 輔助：切換支出總覽的 全年/按月 模式
window.toggleExpTimeMode = function() {
  S.rptExpTimeMode = (S.rptExpTimeMode === 'year') ? 'month' : 'year';
  renderReport();
};
// 新增：渲染支出總覽清單
function renderExpenseOverview() {
  const isMonth = S.rptNetMode === 'month'; // 雖然 mode 不同，但共享年月選擇
  const prefix = isMonth ? `${S.rptY}-${pad(S.rptM)}` : `${S.rptY}-`;
  
  // 1. 抓取一般支出
  const genExps = S.generalExpenses.filter(e => e.date.startsWith(prefix));
  // 2. 抓取車輛支出
  const vehExps = S.vehicleRecs.filter(r => r.date.startsWith(prefix));
  
  // 合併所有支出並依日期排序
  let allExps = [
    ...genExps.map(e => ({ ...e, type: 'general' })),
    ...vehExps.map(v => ({ ...v, type: 'vehicle', category: v.type === 'fuel' ? '加油' : (v.type === 'maintenance' ? '保養維修' : '洗車') }))
  ];
  allExps.sort((a,b) => b.date.localeCompare(a.date));

  let html = `<div style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">`;
  
  if (allExps.length === 0) {
    html += `<div class="empty-tip">本區間尚無任何支出記錄</div>`;
  } else {
    allExps.forEach(item => {
      let icon = '💸';
      let color = '#64748b';
      if (item.category === '加油') { icon = '⛽'; color = '#ef4444'; }
      else if (item.category === '保養維修') { icon = '🔧'; color = '#10b981'; }
      else if (item.category === '洗車') { icon = '🧽'; color = '#06b6d4'; }
      else if (item.category === '罰單') { icon = '👮'; color = '#000'; }

      html += `
        <div style="background:#fff; border-radius:16px; border:1.5px solid #e2e8f0; padding:12px; display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:40px; height:40px; border-radius:10px; background:var(--sf2); display:flex; align-items:center; justify-content:center; font-size:20px;">${icon}</div>
            <div>
              <div style="font-size:14px; font-weight:800; color:var(--t1);">${item.category}</div>
              <div style="font-size:11px; color:var(--t3); font-weight:600;">${item.date} ${item.note ? '· ' + item.note : ''}</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-family:var(--mono); font-size:16px; font-weight:800; color:#dc2626;">-$${fmt(item.amount)}</div>
          </div>
        </div>
      `;
    });
  }
  
  html += `</div>`;
  return html;
}
/* ══ 5. 收入分析 結束 ══════════════════════════════════════════ */


/* ══ 6. 車輛管理 開始 ══════════════════════════════════════════ */
function changeVehMonth(offset) { 
  if (S.vehicleTab === 'yearly' || S.vehicleTab === 'search') {
    S.vehY += offset;
  } else {
    S.vehM += offset; 
    if (S.vehM < 1) { S.vehM = 12; S.vehY--; } 
    if (S.vehM > 12) { S.vehM = 1; S.vehY++; } 
  }
  
  // 僅更新月份標籤，不重繪車輛圖片清單，解決閃爍問題
  const labelEl = document.getElementById('veh-month-label');
  if (labelEl) {
    labelEl.innerHTML = (S.vehicleTab === 'yearly' || S.vehicleTab === 'search') 
      ? `<span style="color: #9333ea; font-size: 22px;">${S.vehY}</span> 年 <span style="color: #9333ea; font-size: 22px;">全年</span>` 
      : `<span style="color: #9333ea; font-size: 22px;">${S.vehY}</span> 年 <span style="color: #9333ea; font-size: 22px;">${S.vehM}</span> 月`;
  }
  // 僅重繪下方的詳細記錄
  renderVehicleContent(); 
}

/* 👈 [新增] 車輛管理頁面的快速選日期入口 */
function openVehDatePicker() {
  const isYearOnly = (S.vehicleTab === 'yearly' || S.vehicleTab === 'search');
  if (isYearOnly) {
    openQuickDatePicker({
      mode: 'year', year: S.vehY, curY: S.vehY,
      onSelect: (y) => {
        S.vehY = y;
        const labelEl = document.getElementById('veh-month-label');
        if (labelEl) labelEl.innerHTML = `<span style="color: #9333ea; font-size: 22px;">${S.vehY}</span> 年 <span style="color: #9333ea; font-size: 22px;">全年</span>`;
        renderVehicleContent();
      }
    });
  } else {
    openQuickDatePicker({
      mode: 'month', year: S.vehY, curY: S.vehY, curM: S.vehM,
      onSelect: (y, m) => {
        S.vehY = y; S.vehM = m;
        const labelEl = document.getElementById('veh-month-label');
        if (labelEl) labelEl.innerHTML = `<span style="color: #9333ea; font-size: 22px;">${S.vehY}</span> 年 <span style="color: #9333ea; font-size: 22px;">${S.vehM}</span> 月`;
        renderVehicleContent();
      }
    });
  }
}
/* ══ 新增：車輛管理 - 展開/收起上方車輛清單區塊 (強化版) ══ */
window.toggleVehHeader = function() {
  // 1. 抓取車輛清單與它的外包裝
  const container = document.getElementById('veh-selector-container');
  const wrapper = document.getElementById('veh-selector-wrapper'); // 若有外包裝也一起抓
  
  // 2. 利用月份文字標籤，反向抓取包住它的整條切換器外框
  const monthLabel = document.getElementById('veh-month-label');
  const monthNav = monthLabel ? monthLabel.parentElement : null;
  
  if (!container) return;
  
  // 判斷目前的隱藏狀態
  if (container.style.display === 'none') {
    // 展開
    if (wrapper) wrapper.style.display = '';
    if (container) container.style.display = '';
    if (monthNav) monthNav.style.display = 'flex'; // 恢復彈性排版
  } else {
    // 收起
    if (wrapper) wrapper.style.display = 'none';
    if (container) container.style.display = 'none';
    if (monthNav) monthNav.style.display = 'none';
  }
  
  // 重新渲染下方的內容與按鈕樣式
  renderVehicleContent();
};
function selectVehicle(id) { 
  S.selVehicleId = id; 
  _syncVehSelectorActive(id); 
  
  // 👉 新增這行：切換車輛時，重新觸發目前頁籤的顏色渲染 (因為油車和電車的燃料頁籤顏色不同)
  const tabIndexMap = { 'fuel': 0, 'maintenance': 1, 'wash': 2, 'yearly': 3, 'search': 4 };
  switchVehicleTab(S.vehicleTab, tabIndexMap[S.vehicleTab]);

  renderVehicleContent();     
  updateCurrentVehInfoDisplay(id);
}

/* ══ 車輛選單折疊功能 ══ */
window.toggleVehSelector = function() {
  const wrap = document.getElementById('veh-selector-wrapper');
  const btn = document.getElementById('veh-selector-toggle-btn');
  if (!wrap || !btn) return;
  if (navigator.vibrate) try { navigator.vibrate(12); } catch(e){}

  if (wrap.style.maxHeight === '0px' || wrap.style.maxHeight === '') {
    wrap.style.maxHeight = '140px';
    wrap.style.opacity = '1';
    btn.style.transform = 'rotate(-180deg)';
  } else {
    wrap.style.maxHeight = '0px';
    wrap.style.opacity = '0';
    btn.style.transform = 'rotate(0deg)';
  }
};

/* ══ 更新：目前所選車輛的標籤資訊 (橫向排版) ══ */
function updateCurrentVehInfoDisplay(id) {
  const infoEl = document.getElementById('veh-current-info');
  if (!infoEl) return;
  const v = S.vehicles.find(x => x.id === id);
  if (!v) {
    infoEl.style.display = 'none';
    return;
  }
  infoEl.style.display = 'flex';

  const fuelMap = { '92':'92 無鉛', '95':'95 無鉛', '98':'98 無鉛', 'electric':'電 池' };
  const fName = fuelMap[v.defaultFuel] || v.defaultFuel;
  const isEV = v.defaultFuel === 'electric';

  // 根據 油車 / 電車 給予兩種不同的顏色設計
  const tagBg = isEV ? 'hsl(0, 0%, 100%)' : 'hsl(0, 0%, 100%)';
  const tagColor = isEV ? 'hsl(221, 100%, 62%)' : 'hsl(21, 100%, 50%)';
  const fuelIcon = isEV ? '🔋' : '⛽';
  const fuelColor = isEV ? '#228B22' : 'rgb(255, 0, 0)'; 

  // 橫向排版： [名稱標籤]、[圖示+油品]
  infoEl.innerHTML = `
    <span style="background:${tagBg}; color:${tagColor}; border:1.5px solid #ff0606; font-size:13px; font-weight:800; padding:4px 8px; border-radius:14px; text-align:center; white-space:normal; line-height:1.2; word-break:break-word;" title="${safeText(v.name)}">${safeText(v.name)}</span>
    <span style="font-size:14px; font-weight:800; color:${fuelColor}; white-space:nowrap;">${fuelIcon} ${fName}</span>
  `;
}

/* ══ 替換：車輛清單渲染 (排版對齊 11.jpg) ══ */
function renderVehicles() {
  const container = document.getElementById('vehicle-content'); 
  const selectorContainer = document.getElementById('veh-selector-container');
  
  container.style.minHeight = '0';
  container.style.WebkitOverflowScrolling = 'touch';

  const labelEl = document.getElementById('veh-month-label');
  if (labelEl) {
    if (S.vehicleTab === 'yearly' || S.vehicleTab === 'search') {
      labelEl.innerHTML = `<span style="color: #9333ea; font-size: 22px;">${S.vehY}</span> 年 <span style="color: #9333ea; font-size: 22px;">全年</span>`;
    } else {
      labelEl.innerHTML = `<span style="color: #9333ea; font-size: 22px;">${S.vehY}</span> 年 <span style="color: #9333ea; font-size: 22px;">${S.vehM}</span> 月`;
    }
  }
  if (S.vehicles.length === 0) { selectorContainer.innerHTML = ''; container.innerHTML = `<div class="empty-tip">請點擊右上角新增車輛</div>`; return; }
  if (!S.selVehicleId || !S.vehicles.find(v => v.id === S.selVehicleId)) { S.selVehicleId = S.vehicles[0].id; }
  updateCurrentVehInfoDisplay(S.selVehicleId); 

  let selectorHtml = `<div style="display:flex; gap:16px; overflow-x:auto; padding:4px 4px 8px;" class="hide-scroll">`;
  const fuelMap = { '92':'92 無鉛', '95':'95 無鉛', '98':'98 無鉛', 'electric':'電動車' };

  S.vehicles.forEach(v => {
    const isActive = v.id === S.selVehicleId;
    const fName = fuelMap[v.defaultFuel] || v.defaultFuel; 
    const isEV = v.defaultFuel === 'electric';
    const borderColor = isActive ? (isEV ? '#3b82f6' : 'var(--acc)') : 'transparent';
    const nameColor = isActive ? (isEV ? '#3b82f6' : 'var(--acc)') : 'var(--t2)';
    
    selectorHtml += `<div data-vid="${v.id}" style="position:relative; display:flex; flex-direction:column; align-items:center; gap:6px; min-width:64px; cursor:pointer;" onclick="selectVehicle('${v.id}')">
      <span class="veh-sel-name" style="font-size:12px; font-weight:700; color:${nameColor}; transition:0.2s;">${v.name}</span>
      <div style="position:relative;">
        <div onclick="event.stopPropagation(); deleteVehicle('${v.id}')" style="position:absolute; top:-6px; right:-6px; background:var(--red); color:#fff; border-radius:50%; width:16px; height:16px; font-size:10px; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:2; box-shadow:0 2px 4px rgba(239,68,68,0.4);">✕</div>
        <div class="veh-sel-icon" style="width:50px; height:50px; border-radius:12px; background:var(--sf); border:2px solid ${borderColor}; display:flex; align-items:center; justify-content:center; box-shadow:${isActive ? '0 4px 10px rgba(0,0,0,0.1)' : '0 2px 4px rgba(0,0,0,0.05)'}; transition:0.2s;">
          <img src="scooter/s${(v.icon && v.icon <= 9) ? v.icon : 1}.png" style="width:36px; height:36px; object-fit:contain;">
        </div>
      </div>
      <span style="font-size:11px; font-weight:600; color:var(--t3);">${fName}</span>
      <span onclick="event.stopPropagation(); openVehInfo('${v.id}')" style="font-size:10px; color:var(--blue); font-weight:700; background:var(--blue-d); padding:2px 8px; border-radius:10px; margin-top:2px;">車輛資訊</span>
    </div>`;
  });
  selectorHtml += `</div>`; 
  selectorContainer.innerHTML = selectorHtml;
  
  // 這樣一進到車輛頁面，就會自動判定目前是油車還是電車，並套用正確的顏色！
  const tabIndexMap = { 'fuel': 0, 'maintenance': 1, 'wash': 2, 'yearly': 3, 'search': 4 };
  switchVehicleTab(S.vehicleTab, tabIndexMap[S.vehicleTab] || 0);
}

function _syncVehSelectorActive(id) {
  // 不重新渲染整個列表 (避免圖片閃爍)，只改變 DOM 元素的樣式
  const container = document.getElementById('veh-selector-container');
  if (!container) return;
  
  const items = container.querySelectorAll('[data-vid]');
  items.forEach(el => {
    const vid = el.getAttribute('data-vid');
    const isActive = vid === id;
    
    const v = S.vehicles.find(x => x.id === vid);
    const isEV = v && v.defaultFuel === 'electric';
    const activeColor = isEV ? '#3b82f6' : 'var(--acc)';
    
    const nameEl = el.querySelector('.veh-sel-name');
    const iconWrap = el.querySelector('.veh-sel-icon');
    
    if (isActive) {
      nameEl.style.color = activeColor;
      iconWrap.style.borderColor = activeColor;
      iconWrap.style.boxShadow = '0 4px 10px rgba(0,0,0,0.1)';
    } else {
      nameEl.style.color = 'var(--t2)';
      iconWrap.style.borderColor = 'transparent';
      iconWrap.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
    }
  });
}

/* ══ 替換：車輛管理內容 (支援月度燃料/保養、年總覽與記錄搜尋) ══ */
function renderVehicleContent() {
  const container = document.getElementById('vehicle-content');
  const subWrap = document.getElementById('veh-search-sub-wrap'); // 靜態頁籤容器
  const yearlyTopCard = document.getElementById('veh-yearly-top-card'); // 👑 年總覽固定金條卡片容器

  if (!S.selVehicleId) { 
    if (yearlyTopCard) { yearlyTopCard.style.display = 'none'; yearlyTopCard.innerHTML = ''; }
    container.innerHTML = `<div class="empty-tip">請選擇車輛</div>`; 
    return; 
  }

  // 控制靜態頁籤與頂部金條卡片的顯隱
  if (subWrap) subWrap.style.display = (S.vehicleTab === 'search') ? 'block' : 'none';
  if (yearlyTopCard && S.vehicleTab !== 'yearly') {
    yearlyTopCard.style.display = 'none';
    yearlyTopCard.innerHTML = '';
  }

  let html = '';

  if (S.vehicleTab === 'search') {
    const isSearch = S.vehSearchTab === 'search';
    const v = S.vehicles.find(x => x.id === S.selVehicleId);
    const isEV = v && v.defaultFuel === 'electric';
    const maintList = isEV ? MAINT_ITEMS_EV : MAINT_ITEMS_GAS;

    // 🌟 同步更新靜態頁籤的 data-active 屬性與按鈕 active class
    const tabsEl = document.getElementById('veh-search-tabs-el');
    if (tabsEl) {
      tabsEl.setAttribute('data-active', S.vehSearchTab);
      document.getElementById('stb-search').classList.toggle('active', isSearch);
      document.getElementById('stb-remind').classList.toggle('active', !isSearch);
    }

    if (isSearch) {
      // 模式 A：歷史搜尋 (只畫輸入框與結果)
      html = `
        <div style="background:var(--sf); padding:12px; border-radius:16px; border:1px solid var(--border);margin:-12px 0 12px 0;">
          <div style="display:flex; gap:8px; align-items:center; margin-bottom:10px;">
            <input type="text" class="finp" id="veh-search-kw" placeholder="🔍 搜尋零件、店家或備註..." oninput="doVehSearch(false)" style="flex:1; border:1.5px solid #bfdbfe; padding:10px;">
            <button onclick="openVehSearchFullscreen()" style="width:42px; height:42px; border-radius:12px; background:#eff6ff; color:#2563eb; border:1.5px solid #bfdbfe; display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:900;">⤢</button>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:6px;">
            ${maintList.map(item => `<div class="search-quick-tag" onclick="selectSearchTag('${item}', this)">${item}</div>`).join('')}
          </div>
        </div>
        <div id="veh-search-results"></div>
        <div style="height:200px;"></div>
      `;
      container.innerHTML = html;
      if (document.getElementById('veh-search-kw').value) doVehSearch(false);
      else document.getElementById('veh-search-results').innerHTML = '<div class="empty-tip">請輸入或點選標籤開始搜尋</div>';
    } else {
      // 模式 B：保養提醒 (加入清除按鈕與新設計)
      const lastKm = localStorage.getItem(`last_km_${S.selVehicleId}`) || '';
      html = `
        <div style="background:linear-gradient(135deg, #1e293b, #334155); padding:8px 16px; border-radius:20px; margin:-12px 0 12px 0; color:#fff;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
            <label style="font-size:20px; font-weight:800; color: #00f7ff; letter-spacing:1px;">🏍️ 儀表板里程</label>
            <button onclick="openMaintCycleSettings()" style="background:#3b82f6; color:#fff; border:none; padding:4px 12px; border-radius:8px; font-size:14px; font-weight:800; cursor:pointer;">⚙️ 設定週期</button>
          </div>
          <div style="position:relative;">
            <input type="number" class="finp myInput1" id="veh-remind-km" value="${lastKm}" placeholder="輸入現在里程" oninput="renderMaintReminderList()" style="background:rgba(255,255,255,0.1); border:2px solid #3b82f6; color:#fff; font-size:24px; font-family:var(--mono); font-weight:900; text-align:center; padding-right:45px;">
            <button onclick="clearRemindKm()" style="position:absolute; right:10px; top:50%; transform:translateY(-50%); width:32px; height:32px; border-radius:50%; background:rgba(255,255,255,0.2); border:none; color:#fff; font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center;font-weight:900;">✕</button>
          </div>
        </div>
        <div id="veh-remind-list"></div>
        <div style="height:200px;"></div>
      `;
      container.innerHTML = html;
      renderMaintReminderList();
    }
    return;
  }

  // ── 2. 年總覽頁籤 (超緊湊高質感玻璃紋路版) ──
  if (S.vehicleTab === 'yearly') {
    const yearRecs = S.vehicleRecs.filter(r => r.vehicleId === S.selVehicleId && r.date.startsWith(S.vehY + '-'));
    const isEV = S.vehicles.find(x => x.id === S.selVehicleId)?.defaultFuel === 'electric';
    
    let yDist = 0, yLiters = 0, yFuelAmt = 0, yMaintAmt = 0, yWashAmt = 0, yWashCount = 0;
    const itemFreq = {};

    // 1. 燃料與里程計算
    yearRecs.forEach(r => {
      if (r.type === 'fuel') {
        const diff = pf(r.km) - pf(r.prevKm); if (diff > 0) yDist += diff;
        yLiters += pf(r.liters); yFuelAmt += pf(r.amount);
      } else if (r.type === 'maintenance') {
        yMaintAmt += pf(r.amount);
        if (r.items) r.items.forEach(it => { itemFreq[it] = (itemFreq[it] || 0) + 1; });
      } else if (r.type === 'wash') {
        yWashAmt += pf(r.amount);
        yWashCount++;
      }
    });
    
    const sortedItems = Object.entries(itemFreq).sort((a,b) => b[1] - a[1]);
    const totalExp = yFuelAmt + yMaintAmt + yWashAmt;

    // 2. 總支出金條卡片 (渲染至頂部頁籤正下方的固定容器)
    if (yearlyTopCard) {
      yearlyTopCard.style.display = 'block';
      yearlyTopCard.innerHTML = `
        <div style="background:linear-gradient(135deg, #ffbd4a 0%, #fcd75e 40%, #fed160 60%, #ffda46 100%);border-radius:14px;border:1.5px solid #fff200;position:relative;overflow:hidden;padding:4px 10px;">
          <!-- 閃光線條特效 -->
          <div style="position:absolute; top:0; left:-50%; width:200%; height:100%; background: repeating-linear-gradient(45deg, transparent, transparent 15px, rgba(255,255,255,0.4) 15px, rgba(255,255,255,0.4) 30px);"></div>
          
          <div style="display:flex;justify-content:space-between;align-items:center;position:relative;z-index:1;">
            <div style="display:flex;align-items:center;gap:8px;letter-spacing:1px;">
              <div style="width:40px;height:40px;background:rgba(255,255,255,0.7);border-radius:6px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(15px);box-shadow:inset 0 1px 4px rgba(255,255,255,0.9),inset 1px 1px 4px rgba(255,255,255,0.9);font-size:32px;"><span style="margin:0 0 4px 2px;">👑</span></div>
              <span style="font-size:16px;font-weight:800;color: #0049a8;backdrop-filter:blur(4px);background: rgba(255, 255, 255, 0.7);padding:0 3px;"><span style="font-size:26px;font-weight:900;margin-right:4px;">${S.vehY}</span>年<span style="font-size:22px;font-weight:800;margin-left:8px;">總支出</span></span>
            </div>
            
            <div style="background: #242121;padding:4px 12px;border-radius:10px;border:1.5px solid #fff200;display:flex;align-items:baseline;margin-right:30px;">
              <span style="font-size:14px;font-weight:900;color: #ffc400;margin-right:4px;">$</span>
              <span style="font-family:var(--mono);font-size:24px;font-weight:900;color: #ffc400;letter-spacing:0.5px;">${fmt(totalExp)}</span>
            </div>
          </div>
        </div>
      `;
    }

    // 3. 燃料與里程卡片 (玻璃反光與科技碳纖維斜紋)
    const fuelBg = isEV ? 'linear-gradient(180deg, #1e3a8a 0%, #3b82f6 100%)' : 'linear-gradient(180deg, #e60000 0%, #ff6666 100%)';
    const fuelShadow = isEV ? 'rgba(59,130,246,0.4)' : 'rgba(230, 0, 0,0.4)';
    const fuelImgSrc = isEV ? 'Vehicle/ve2.png' : 'Vehicle/ve1.png';
    const fuelTitle = isEV ? '年度換電與里程' : '年度油資與里程';
    const fuelborderColor = isEV ? '#0b55cb' : '#ef4444';
    const fuelopacity = isEV ? 0.1 : 0.2;
    const fuelCostPerKm = (yDist > 0 && yFuelAmt > 0) ? (yFuelAmt / yDist).toFixed(2) : 0;
    const fuelgrayline = isEV ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.6)';

    // 計算電動車專屬資料
    let yEvFeeTotal = 0, yEvExtraTotal = 0;
    if (isEV) {
      yearRecs.forEach(r => {
        if (r.type === 'fuel' && r.fuelType === 'electric') {
          yEvFeeTotal += pf(r.evFee !== undefined ? r.evFee : r.amount);
          yEvExtraTotal += pf(r.evExtra);
        }
      });
    }
    const evCostPerKm = (yDist > 0 && yFuelAmt > 0) ? (yFuelAmt / yDist).toFixed(2) : 0;

    html += `
      <div style="background:${fuelBg};border-radius:16px;box-shadow:0 4px 4px ${fuelShadow};position:relative;overflow:hidden;border:1px solid ${fuelborderColor};background-size:101% 101%;padding:3px 10px 2px 10px;margin-bottom:10px;">
        <!-- 碳纖維科技斜紋背景 -->
        <div style="position:absolute; inset:0; opacity:${fuelopacity}; background-image: repeating-linear-gradient(45deg, #ffffff 0px, #ffffff 2px, transparent 1px, transparent 18px);"></div>
        <!-- 頂部玻璃反光光暈 -->
        <div style="position:absolute; top:0; left:0; right:0; height:30%; background:linear-gradient(to bottom, rgba(255,255,255,0.15), transparent); pointer-events:none;"></div>

        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px dashed ${fuelgrayline};padding-bottom:3px;margin-bottom:3px;position:relative;z-index:1;">
          <!-- 左側：圖示 + 標題（靠左包覆） -->
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="width:40px;height:40px;background:rgba(255,255,255,0.2);border-radius:6px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(15px);box-shadow:inset 0 1px 4px rgba(255,255,255,0.9),inset 1px 1px 4px rgba(255,255,255,0.9);">
              <img src="${fuelImgSrc}" style="width:38px;height:38px;object-fit:contain;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.1));">
            </div>
            <span style="font-size:18px;font-weight:750;color:#fff;letter-spacing:1px;">${fuelTitle}</span>
          </div>

          <!-- 右側：金額標籤（動態藍/紅系配色） -->
          <div style="background:#fff;padding:4px 12px;border-radius:10px;box-shadow:inset 0 1px 3px rgba(0,0,0,0.1),0 2px 8px rgba(0,0,0,0.15);border:1px solid ${isEV ? '#93c5fd' : '#fca5a5'};display:flex;align-items:baseline;margin-right:5px;">
            <span style="font-size:14px; font-weight:900; color:${isEV ? '#1d4ed8' : '#b91c1c'}; margin-right:4px;">$</span>
            <span style="font-family:var(--mono); font-size:24px; font-weight:900; background:${isEV ? 'linear-gradient(180deg, #1d4ed8, #3b82f6)' : 'linear-gradient(180deg, #b91c1c, #ef4444)'}; -webkit-background-clip:text; -webkit-text-fill-color:transparent; letter-spacing:0.5px;">${fmt(yFuelAmt)}</span>
          </div>
        </div>
        
        <div style="display:flex;justify-content:space-around;align-items:center;position:relative;z-index:1;">
          ${!isEV ? `
          <div style="display:flex; flex:1; flex-direction:column; align-items:center;">
            <span style="font-size:14px;font-weight:650;color: #0059ff;margin-bottom:3px;letter-spacing:0.5px;background:#fff;padding:0 3px;">總油量</span>
            <div style="background:rgba(255, 255, 255, 0.15); border:1px solid rgba(255,255,255,0.15); padding:4px 10px; border-radius:10px; box-shadow:inset 0 1px 4px rgba(0,0,0,0.2);backdrop-filter:blur(4px);">
              <span style="font-family:var(--mono); font-size:18px; font-weight:900;color: #fff;letter-spacing:0.5px;">${yLiters.toFixed(1)}<span style="font-size:11px;color: #000;margin-left:4px;">L</span></span>
            </div>
          </div>
          <div style="width:2px;height:55px;background:${fuelgrayline};"></div>
          <div style="display:flex; flex:1; flex-direction:column; align-items:center;">
            <span style="font-size:14px;font-weight:650;color: #0059ff;margin-bottom:3px;letter-spacing:0.5px;background:#fff;padding:0 3px;">行駛總里程</span>
            <div style="background:rgba(255, 255, 255, 0.15); border:1px solid rgba(255,255,255,0.15); padding:4px 10px; border-radius:10px; box-shadow:inset 0 1px 4px rgba(0,0,0,0.2);backdrop-filter:blur(4px);">
              <span style="font-family:var(--mono); font-size:18px; font-weight:900;color: #fff;letter-spacing:0.5px;">${fmt(yDist)}<span style="font-size:11px;color: #000;letter-spacing:1px;margin-left:4px;">km</span></span>
            </div>
          </div>
          <div style="width:2px;height:55px;background:${fuelgrayline};"></div>
          <div style="display:flex; flex:1; flex-direction:column; align-items:center;">
            <span style="font-size:14px;font-weight:650;color: #0059ff;margin-bottom:3px;letter-spacing:0.5px;background:#fff;padding:0 3px;">每公里成本</span>
            <div style="background:rgba(255, 255, 255, 0.15);border:1px solid rgba(255,255,255,0.15);padding:4px 10px;border-radius:10px;box-shadow:inset 0 1px 4px rgba(0,0,0,0.2);backdrop-filter:blur(4px);">
              <span style="font-family:var(--mono);font-size:18px;font-weight:900;color: #fff;letter-spacing:0.5px;">${fuelCostPerKm}<span style="font-size:11px;color: #000;letter-spacing:1px;margin-left:4px;">元/km</span></span>
            </div>
          </div>  
          ` : `
          <div style="display:flex; flex:1.4; flex-direction:column; align-items:center;margin-right:5px;">
            <span style="font-size:14px;font-weight:650;color:rgba(255,255,255,0.9);margin-bottom:3px;letter-spacing:0.5px;">月租 + 換電</span>
            <div style="background:rgba(255, 255, 255, 0.15); border:1px solid rgba(255,255,255,0.15); padding:4px 10px; border-radius:10px; box-shadow:inset 0 1px 4px rgba(0,0,0,0.2);backdrop-filter:blur(4px);">
              <span style="font-family:var(--mono);font-size:18px;font-weight:900;color:#fff;letter-spacing:0.5px;"><span style="font-size:11px;color:#000;margin-right:4px;">$</span>${fmt(yEvFeeTotal)}<span style="font-size:18px;font-weight:900;color:#000;margin:0 4px 0 4px;">+</span><span style="color: #37ff00;letter-spacing:0.5px;">${fmt(yEvExtraTotal)}</span></span>
            </div>
          </div>
          <div style="width:2px;height:55px;background:${fuelgrayline};"></div>
          <div style="display:flex; flex:1; flex-direction:column; align-items:center;">
            <span style="font-size:14px;font-weight:650;color:rgba(255,255,255,0.9);margin-bottom:3px;letter-spacing:0.5px;">行駛總里程</span>
            <div style="background:rgba(255, 255, 255, 0.15); border:1px solid rgba(255,255,255,0.15); padding:4px 10px; border-radius:10px; box-shadow:inset 0 1px 4px rgba(0,0,0,0.2);backdrop-filter:blur(4px);">
              <span style="font-family:var(--mono);font-size:18px;font-weight:900;color:#ffffff;">${fmt(yDist)}<span style="font-size:11px;color:rgba(0,0,0,0.8);letter-spacing:1px;margin-left:4px;">km</span></span>
            </div>
          </div>
          <div style="width:2px;height:55px;background:${fuelgrayline};"></div>
          <div style="display:flex; flex:1.1; flex-direction:column; align-items:center;">
            <span style="font-size:14px;font-weight:650;color:rgba(255,255,255,0.9);margin-bottom:3px;letter-spacing:0.5px;">每公里成本</span>
            <div style="background:rgba(255, 255, 255, 0.15); border:1px solid rgba(255,255,255,0.15); padding:4px 10px; border-radius:10px; box-shadow:inset 0 1px 4px rgba(0,0,0,0.2);backdrop-filter:blur(4px);">
              <span style="font-family:var(--mono);font-size:18px;font-weight:900;color:#ffffff;">${evCostPerKm}<span style="font-size:11px;color:rgba(0,0,0,0.8);letter-spacing:1px;margin-left:4px;">元/km</span></span>
            </div>
          </div>
          `}
        </div>
      </div>
    `;

    // 4. 保養維修總額 (曜石綠科技網格背景 + 立體列表)
    const itemAmount = {};
    yearRecs.forEach(r => {
      if (r.type === 'maintenance') {
        if (r.itemDetails && r.itemDetails.length > 0) {
          r.itemDetails.forEach(dt => { itemAmount[dt.name] = (itemAmount[dt.name] || 0) + pf(dt.amount); });
        } else if (r.items && r.items.length > 0) {
          itemAmount[r.items[0]] = (itemAmount[r.items[0]] || 0) + pf(r.amount);
        }
      }
    });

    html += `
    <div style="background:#ffffff;border-radius:16px;border:1px solid #059669;box-shadow:0 4px 4px rgba(5, 150, 105,0.4);overflow:hidden;margin-bottom:10px;">
      
      <!-- 頂部翡翠綠玻璃感卡 -->
      <div style="background:linear-gradient(180deg, #064e3b 0%, #059669 100%);position:relative;overflow:hidden;padding:3px 10px;">
        <!-- 科技全息方格背景 -->
        <div style="position:absolute;inset:0;opacity:0.12;background-image:linear-gradient(#ffffff 1px, transparent 1px),linear-gradient(90deg, #ffffff 1px, transparent 1px);background-size:16px 16px;"></div>
        <!-- 頂部玻璃反光光暈 -->
        <div style="position:absolute;top:0;left:0;right:0;height:40%;background:linear-gradient(to bottom, rgba(255,255,255,0.12), transparent);pointer-events:none;"></div>
        
        <div style="display:flex;justify-content:space-between;align-items:center;position:relative;z-index:1;">
          <h3 style="font-size:18px;font-weight:750;color:#fff;display:flex;align-items:center;gap:8px;letter-spacing:1px;">
            <div style="width:40px;height:40px;background:rgba(255,255,255,0.2);border-radius:6px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(15px);box-shadow:inset 0 1px 4px rgba(255,255,255,0.9),inset 1px 1px 4px rgba(255,255,255,0.9);font-size:32px;">🔧</div>
            保養與維修總額
          </h3>
          <div style="background:#fff;padding:4px 12px;border-radius:10px;box-shadow:inset 0 1px 3px rgba(0,0,0,0.1),0 2px 8px rgba(0,0,0,0.15);border:1px solid #6ee7b7;display:flex;align-items:baseline;margin-right:5px;">
            <span style="font-size:14px; font-weight:900; color:#047857; margin-right:4px;">$</span>
            <span style="font-family:var(--mono); font-size:24px; font-weight:900; background:linear-gradient(180deg, #047857, #10b981); -webkit-background-clip:text; -webkit-text-fill-color:transparent; letter-spacing:0.5px;">${fmt(yMaintAmt)}</span>
          </div>
        </div>
      </div>
      
      <!-- 下方緊湊立體清單區 -->
      <div style="padding:10px 8px; background:#f8fafc;">
        <!-- 表頭：採用 Grid 網格，對齊方式與下方內容一致 (左、中、右) -->
        <div style="font-size:13px; font-weight:650; color:#64748b; margin-bottom:6px; display:grid; grid-template-columns: 45% 20% 35%; align-items:center; padding:0 12px;">
          <span style="text-align:left;">保養項目</span>
          <span style="text-align:center;">次數</span>
          <span style="text-align:right;">累計花費</span>
        </div>
        
        <div style="display:flex; flex-direction:column; gap:4px;">
          ${sortedItems.length ? sortedItems.map(it => `
            <!-- 資料列：統一採用 45% 20% 35% 的 Grid 欄位分割 -->
            <div style="display:grid; grid-template-columns: 45% 20% 35%; align-items:center; padding:6px 12px; background:#ffffff; border-radius:10px; border:1px solid #e2e8f0; box-shadow:0 1px 3px rgba(0,0,0,0.02);">
              
              <!-- 項目名稱（靠左） -->
              <div style="display:flex; align-items:center; gap:6px; overflow:hidden; min-width:0;">
                <div style="width:6px; height:6px; border-radius:50%; background: #10b981; flex-shrink:0;"></div>
                <span style="font-size:14px; font-weight:800; color: #334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${safeText(it[0])}
                </span>
              </div>
              
              <!-- 次數膠囊（居中） -->
              <div style="display:flex; justify-content:center;">
                <span style="font-family:var(--mono); font-size:15px; font-weight:900; color: #ff5900; background: #fff2e2; padding:3px 10px; border-radius:8px; border:1px solid #ffedd5;">
                  ${it[1]}<span style="font-size:10px; color: #4b4846; margin-left:2px;"> 次</span>
                </span>
              </div>
              
              <!-- 金額（靠右） -->
              <div style="text-align:right;">
                <span style="font-family:var(--mono); font-size:16px; font-weight:900; color:#2563eb;">
                  <span style="font-size:11px; color: #94a3b8; margin-right:2px;">$ </span>${fmt(itemAmount[it[0]] || 0)}
                </span>
              </div>
            </div>
          `).join('') : `
            <div style="padding:16px 0; text-align:center; background:#ffffff; border-radius:10px; border:1.5px dashed #cbd5e1;">
              <div style="font-size:20px; margin-bottom:4px;">📭</div>
              <div style="font-size:13px; font-weight:800; color:#94a3b8;">本年度尚無保養記錄</div>
            </div>
          `}
        </div>
      </div>
    </div>`;

    // 5. 洗車美容總額 (風格 3：動態傾斜折光，次數置中，底部留白)
    if (yWashCount > 0) {
      html += `
      <div style="background:#fff;border-radius:16px;border:1px solid #06b6d4;box-shadow:0 4px 4px rgba(6, 182, 212,0.4);overflow:hidden;margin-bottom:16px;">
        <div style="background:linear-gradient(180deg, #0891b2 0%, #06b6d4 100%);padding:3px 10px;position:relative;overflow:hidden;">
          <!-- 特效：斜向反光線條 -->
          <div style="position:absolute; top:0; left:-50%; width:200%; height:100%; background: repeating-linear-gradient(135deg, transparent, transparent 15px, rgba(255,255,255,0.1) 15px, rgba(255,255,255,0.1) 30px); pointer-events:none;"></div>
          
          <div style="display:flex; justify-content:space-between; align-items:center; position:relative; z-index:1;">
            <h3 style="font-size:18px;font-weight:750;color:#fff;letter-spacing:1px;display:flex;align-items:center;gap:8px;">
              <div style="width:40px;height:40px;background:rgba(255,255,255,0.2);border-radius:6px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(15px);box-shadow:inset 0 1px 4px rgba(255,255,255,0.9),inset 1px 1px 4px rgba(255,255,255,0.9);font-size:32px;">🧽</div>
              洗車美容總額
            </h3>
            <div style="background:#ffffff; padding:4px 12px; border-radius:10px; box-shadow:inset 0 1px 3px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.15); border:1px solid #67e8f9; display:flex; align-items:baseline;margin-right:5px;">
              <span style="font-size:14px; font-weight:900; color:#0891b2; margin-right:4px;">$</span>
              <span style="font-family:var(--mono); font-size:24px; font-weight:900; background:linear-gradient(180deg, #0891b2, #06b6d4); -webkit-background-clip:text; -webkit-text-fill-color:transparent; letter-spacing:0.5px;">${fmt(yWashAmt)}</span>
            </div>
          </div>
        </div>
        <!-- 置中的洗車次數清單區 -->
        <div style="background:#f8fafc;display:flex;flex-direction:row;align-items:center;justify-content:flex-start;padding:6px 30px;gap:20px;">
           <span style="font-size:16px;font-weight:800;color:#202226;margin-top:6px;">本年度洗車總計</span>
           <span style="font-family:var(--mono);font-size:22px;font-weight:800;color:#e41919;background:#b1faff;padding:2px 10px;border-radius:12px;border:1.5px solid #68f2ff;">${yWashCount}<span style="font-size:14px;color:#202226;margin-left:4px;">次</span></span>
        </div>
      </div>`;
    } else {
      html += `
      <div style="background:#ffffff; border-radius:16px; border:1px solid #cbd5e1; box-shadow:0 4px 16px rgba(0,0,0,0.04); overflow:hidden; margin-bottom:16px;">
        <div style="background:linear-gradient(180deg, #0891b2 0%, #06b6d4 100%); padding:10px 16px; position:relative; overflow:hidden;">
          <h3 style="font-size:20px; color: #000000; font-weight:800; margin:0; display:flex; align-items:center; gap:8px;">
            <div style="background:rgba(255,255,255,0.2); backdrop-filter:blur(4px); width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; box-shadow:inset 0 1px 2px rgba(255,255,255,0.3); border:1px solid rgba(255,255,255,0.2); font-size:24px;">🧽</div>
            洗車美容總額
          </h3>
        </div>
        <div style="padding:16px 0; text-align:center; background:#f8fafc;">
          <div style="font-size:14px; font-weight:800; color:#94a3b8;">本年度尚無洗車記錄</div>
        </div>
      </div>`;
    }

    html += `<div style="height:70px;"></div>`;
    container.innerHTML = html;
    return;
  }

  // ── 3. 月度：車輛燃料 / 保養維修 / 洗車美容 ──
  const prefix = `${S.vehY}-${pad(S.vehM)}`; 
  const monthRecs = S.vehicleRecs.filter(r => r.vehicleId === S.selVehicleId && r.date.startsWith(prefix));
  const fuelRecs = monthRecs.filter(r => r.type === 'fuel'); 
  const maintRecs = monthRecs.filter(r => r.type === 'maintenance');
  const washRecs = monthRecs.filter(r => r.type === 'wash');

  let totalDistance = 0, totalLiters = 0, totalFuelPaid = 0, totalMaintPaid = 0, totalWashPaid = 0;
  fuelRecs.forEach(r => { const diff = pf(r.km) - pf(r.prevKm); if (diff > 0) totalDistance += diff; totalLiters += pf(r.liters); totalFuelPaid += pf(r.amount); });
  maintRecs.forEach(r => totalMaintPaid += pf(r.amount)); 
  washRecs.forEach(r => totalWashPaid += pf(r.amount));
  const avgKmL = totalLiters > 0 ? (totalDistance / totalLiters).toFixed(1) : 0;

  if (S.vehicleTab === 'fuel') {
    const v = S.vehicles.find(x => x.id === S.selVehicleId);
    const isEV = v && v.defaultFuel === 'electric';
    
    let totalEVFee = 0, totalEVExtra = 0, totalEVAmount = 0;
    fuelRecs.forEach(r => { 
      if(r.fuelType === 'electric') {
        totalEVFee += pf(r.evFee !== undefined ? r.evFee : r.amount); 
        totalEVExtra += pf(r.evExtra);
        totalEVAmount += pf(r.amount);
      }
    });

    if (isEV) {
      const evSwapCount = fuelRecs.filter(r => r.fuelType === 'electric').length;
      const avgCostPerKm = (totalDistance > 0 && totalEVAmount > 0) ? (totalEVAmount / totalDistance).toFixed(2) : 0;
      
      const evStatsHtml = `
        <div style="display:flex; justify-content:space-between; text-align:center; margin-top: 5px;">
          <div style="flex:1;">
            <div style="font-size:12px; color:#475569; margin-bottom:4px; font-weight:700;">月租 + 換電</div>
            <div style="font-weight:900; font-size:15px; color:#8b5cf6; font-family:var(--mono);">$ ${fmt(totalEVFee)} <span style="font-size:11px; color:#ef4444;">+${fmt(totalEVExtra)}</span></div>
          </div>
          <div style="width:1.5px; background:rgba(226, 232, 240, 0.8); margin:0 8px;"></div>
          <div style="flex:1;">
            <div style="font-size:12px; color:#475569; margin-bottom:4px; font-weight:700;">總里程</div>
            <div style="font-weight:900; font-size:16px; color: #ea580c; font-family:var(--mono);">${fmt(totalDistance)} <span style="font-size:12px; color:#64748b;">km</span></div>
          </div>
          <div style="width:1.5px; background:rgba(226, 232, 240, 0.8); margin:0 8px;"></div>
          <div style="flex:1;">
            <div style="font-size:12px; color:#475569; margin-bottom:4px; font-weight:700;">每公里成本</div>
            <div style="font-weight:900; font-size:16px; color:#0d9488; font-family:var(--mono);">${avgCostPerKm} <span style="font-size:12px; color:#64748b;">元/km</span></div>
          </div>
        </div>`;

      html += `
        <div style="background:linear-gradient(to right, #4f46e5 0%, #3b82f6 40%, #93c5fd 75%, #e0f2fe 100%);border-radius:16px;padding:8px 12px;margin-bottom:8px;box-shadow:0 4px 4px rgba(59,130,246,0.4);border:1.5px solid #bfdbfe;">
          <div onclick="toggleSummaryCard('veh-ev-col')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:18px;font-weight:800;color:#fff;letter-spacing:0.5px;">🔋 <span style="color:#fff;font-size:24px;font-weight:900;margin-right:4px;">${S.vehM}</span>月「電池總花費」</span>
            
            <div style="display:flex;align-items:center;gap:30px;">
              <div style="background:rgba(255,255,255,0.9);padding:2px 12px;border-radius:12px;box-shadow:inset 0 2px 4px rgba(255,255,255,0.9),0 2px 4px rgba(0,0,0,0.05);display:flex;align-items:baseline;">
                <span style="font-size:14px;font-weight:800;color:#4f46e5;margin-right:4px;">$</span>
                <span style="font-family:var(--mono);font-size:24px;font-weight:850;color:#3b82f6;letter-spacing:0.5px;">${fmt(totalEVAmount)}</span>
              </div>
              <div style="background:#fff;color: #3b82f6;padding:6px;border-radius:50%;display:flex;align-items:center;justify-content:center;width:24px;height:24px;">
                <div id="veh-ev-col-btn" style="font-size:12px;font-weight:900;transition:transform 0.3s;">▼</div>
              </div>
            </div>
          </div>
          <div id="veh-ev-col" style="max-height:0px;overflow:hidden;transition:max-height 0.3s ease;">
            <div style="background:rgba(255,255,255,0.8);border-radius:12px;padding:8px;margin-top:8px;box-shadow:inset 0 1px 3px rgba(255,255,255,1);">
              ${evStatsHtml}
            </div>
          </div>
        </div>`;
    } else {
      const fuelStatsHtml = `
        <div style="display:flex; justify-content:space-between; text-align:center; margin-top: 5px;">
          <div style="flex:1;">
            <div style="font-size:12px; color:#475569; margin-bottom:4px; font-weight:700;">總加油量</div>
            <div style="font-weight:900; font-size:16px; color:#e11d48; font-family:var(--mono);">${totalLiters.toFixed(1)} <span style="font-size:12px; color:#64748b;">L</span></div>
          </div>
          <div style="width:1.5px; background:rgba(226, 232, 240, 0.8); margin:0 8px;"></div>
          <div style="flex:1;">
            <div style="font-size:12px; color:#475569; margin-bottom:4px; font-weight:700;">總里程</div>
            <div style="font-weight:900; font-size:16px; color: #2563eb; font-family:var(--mono);">${fmt(totalDistance)} <span style="font-size:12px; color:#64748b;">km</span></div>
          </div>
          <div style="width:1.5px; background:rgba(226, 232, 240, 0.8); margin:0 8px;"></div>
          <div style="flex:1;">
            <div style="font-size:12px; color:#475569; margin-bottom:4px; font-weight:700;">平均油耗</div>
            <div style="font-weight:900; font-size:16px; color: #0d9488; font-family:var(--mono);">${avgKmL} <span style="font-size:12px; color:#64748b;">km/L</span></div>
          </div>
        </div>`;

      html += `
        <div style="background:linear-gradient(to right, #be123c 0%, #e11d48 20%, #f43f5e 40%, #fb7185 60%, #fda4af 80%, #fff1f2 100%);border-radius:16px;padding:8px 12px;margin-bottom:8px;box-shadow:0 4px 4px rgba(225, 29, 72, 0.35);border:1.5px solid #fecdd3;">
          <div onclick="toggleSummaryCard('veh-fuel-col')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:18px;font-weight:800;color:#fff;letter-spacing:0.5px;">⛽ <span style="color:#fff;font-size:24px;font-weight:900;margin-right:4px;">${S.vehM}</span>月「汽油總花費」</span>
            
            <div style="display:flex;align-items:center;gap:30px;">
              <div style="background:rgba(255,255,255,0.9);padding:2px 12px;border-radius:12px;box-shadow:inset 0 2px 4px rgba(255,255,255,0.9),0 2px 4px rgba(0,0,0,0.05);display:flex;align-items:baseline;">
                <span style="font-size:14px;font-weight:800;color:#be123c;margin-right:4px;">$</span>
                <span style="font-family:var(--mono);font-size:24px;font-weight:850;color:#e11d48;letter-spacing:0.5px;">${fmt(totalFuelPaid)}</span>
              </div>
              <div style="background:#fff;color: #be123c;padding:6px;border-radius:50%;display:flex;align-items:center;justify-content:center;width:24px;height:24px;">
                <div id="veh-fuel-col-btn" style="font-size:12px;font-weight:900;transition:transform 0.3s;">▼</div>
              </div>
            </div>
          </div>
          <div id="veh-fuel-col" style="max-height:0px;overflow:hidden;transition:max-height 0.3s ease;">
            <div style="background:rgba(255,255,255,0.8);border-radius:12px;padding:8px;margin-top:8px;box-shadow:inset 0 1px 3px rgba(255,255,255,1);">
              ${fuelStatsHtml}
            </div>
          </div>
        </div>`;
    }
  } else if (S.vehicleTab === 'maintenance') {
    html += `
      <div style="background:linear-gradient(to right, #047857 0%, #059669 20%, #10b981 40%, #56d4a6 60%, #8ce6c2 80%, #ecfdf5 100%);border-radius:16px;padding:8px 12px;margin-bottom:8px;box-shadow:0 4px 4px rgba(16, 185, 129, 0.35);border:1.5px solid #a7f3d0;">
        <div onclick="toggleSummaryCard('veh-maint-col')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:18px;font-weight:800;color:#fff;letter-spacing:0.5px;">🔧 <span style="color:#fff;font-size:24px;font-weight:900;margin-right:4px;">${S.vehM}</span>月「保養與維修」</span>
          
          <div style="display:flex;align-items:center;gap:30px;">
            <div style="background: rgba(255,255,255,0.9); padding: 2px 12px; border-radius: 12px; box-shadow: inset 0 2px 4px rgba(255,255,255,0.9), 0 2px 4px rgba(0,0,0,0.05); display:flex; align-items:baseline;">
              <span style="font-size:14px;font-weight:800;color:#047857;margin-right:4px;">$</span>
              <span style="font-family:var(--mono);font-size:24px;font-weight:850;color: #059669;letter-spacing:0.5px;">${fmt(totalMaintPaid)}</span>
            </div>
            <div style="background:#fff;color: #047857;padding:6px;border-radius:50%;display:flex;align-items:center;justify-content:center;width:24px;height:24px;">
              <div id="veh-maint-col-btn" style="font-size:12px;font-weight:900;transition:transform 0.3s;">▼</div>
            </div>
          </div>
        </div>
        <div id="veh-maint-col" style="max-height:0px;overflow:hidden;transition:max-height 0.3s ease;">
          <div style="background:rgba(255,255,255,0.8);border-radius:12px;padding:8px;margin-top:8px;box-shadow:inset 0 1px 3px rgba(255,255,255,1);display:flex;justify-content:center;text-align:center;">
            <div style="flex:1;">
              <div style="font-size:12px; color:#475569; margin-bottom:4px; font-weight:700;">本月保養次數：</div>
              <div style="font-weight:900; font-size:16px; color:#059669; font-family:var(--mono);">${maintRecs.length} <span style="font-size:12px; color:#64748b;">筆</span></div>
            </div>
          </div>
        </div>
      </div>`;
  } else if (S.vehicleTab === 'wash') {
    html += `
      <div style="background:linear-gradient(to right, #0891b2 0%, #06b6d4 20%, #1fc0d9 40%, #67e8f9 60%, #a5f3fc 80%, #ecfeff 100%);border-radius:16px;padding:8px 12px;margin-bottom:8px;box-shadow:0 4px 4px rgba(6,182,212,0.35);border:1.5px solid #cffafe;">
        <div onclick="toggleSummaryCard('veh-wash-col')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:18px;font-weight:800;color:#fff;letter-spacing:0.5px;">🧽 <span style="font-size:24px;font-weight:900;margin-right:4px;">${S.vehM}</span>月「洗車美容」</span>
          
          <div style="display:flex;align-items:center;gap:30px;">
            <div style="background: rgba(255,255,255,0.9); padding: 2px 12px; border-radius: 12px; box-shadow: inset 0 2px 4px rgba(255,255,255,0.9), 0 2px 4px rgba(0,0,0,0.05); display:flex; align-items:baseline;">
              <span style="font-size:14px; font-weight:800; color:#0891b2; margin-right: 4px;">$</span>
              <span style="font-family:var(--mono);font-size:24px;font-weight:850;color: #06b6d4;letter-spacing:0.5px;">${fmt(totalWashPaid)}</span>
            </div>
            <div style="background:#fff;color: #0891b2;padding:6px;border-radius:50%;display:flex;align-items:center;justify-content:center;width:24px;height:24px;">
              <div id="veh-wash-col-btn" style="font-size:12px;font-weight:900;transition:transform 0.3s;">▼</div>
            </div>
          </div>
        </div>
        <div id="veh-wash-col" style="max-height:0px; overflow:hidden; transition:max-height 0.3s ease;">
          <div style="background:rgba(255,255,255,0.8); border-radius:12px; padding:8px; margin-top:8px; box-shadow:inset 0 1px 3px rgba(255,255,255,1); display:flex; justify-content:center; text-align:center;">
            <div style="flex:1;">
              <div style="font-size:12px; color:#475569; margin-bottom:4px; font-weight:700;">本月洗車次數：</div>
              <div style="font-weight:900; font-size:16px; color:#0891b2; font-family:var(--mono);">${washRecs.length} <span style="font-size:12px; color:#64748b;">次</span></div>
            </div>
          </div>
        </div>
      </div>`;
  }

  // 繪製記錄列表
  const typeRecs = monthRecs.filter(r => r.type === S.vehicleTab);
  if (typeRecs.length === 0) { 
    html += `<div class="empty-tip">本月尚未新增資料</div>`; 
  } else {
    // 💡 改為由大到小排序 (最新日期與時間在最上面)
    typeRecs.sort((a, b) => b.date.localeCompare(a.date) || (b.time||'').localeCompare(a.time||'')).forEach(r => {
      const isFuel = r.type === 'fuel'; 
      const isEV = r.fuelType === 'electric'; 
      const formatTime = fmtMDDisp(r.date) + (r.time ? ` ${r.time}` : '');
      
      let htmlContent = '';

      if (isFuel) {
          if (!isEV) {
              // ── ⛽ 汽油紀錄卡片 ──
              const diff = pf(r.km) - pf(r.prevKm);
              const kmL = (r.liters > 0 && diff > 0) ? (diff / r.liters).toFixed(2) : 0;
              
              let pillsHtml = '';
              if (r.liters) pillsHtml += `<div class="vb-pill" style="background: #e5f6ff;border:1px solid #ade2fa;color: #0ea5e9;">${r.liters}<span style="color: #000;font-size:11px;letter-spacing:0.5px;">L</span></div>`;
              if (diff > 0) pillsHtml += `<div class="vb-pill" style="background: #e5eeff;border:1px solid #b0c6f8;color: #2563eb;">${diff}<span style="color: #000;font-size:11px;letter-spacing:0.5px;">km</span></div>`;
              if (kmL > 0)  pillsHtml += `<div class="vb-pill" style="background: #e5fffd;border:1px solid #8af5ec;color: #0d9488;">${kmL}<span style="color: #000;font-size:11px;letter-spacing:0.5px;">km/L</span></div>`;

              htmlContent = `
                <div class="v-card" onclick="openAddVehRec('${safeText(r.id)}')">
                  <div class="vc-left"><img src="Vehicle/ve1.png" style="width:38px; height:38px;"></div>
                  <div class="vc-mid">
                    <div class="vc-mid-top">
                      <div class="vt-time">${formatTime}</div>
                      <div class="vt-tag" style="background:#fee2e2;color:#dc2626;">${r.fuelType||'95'} 無鉛</div>
                    </div>
                    <div class="vc-mid-bot">${pillsHtml}</div>
                  </div>
                  <div class="vc-right">
                    <span style="font-size:14px;font-weight:650;color:var(--t2);margin-bottom:2px;">油費</span>
                    <span class="vc-right-val" style="color: #2563eb;"><span style="font-size:10px;margin-right:4px;">$</span>${fmt(r.amount)}</span>
                  </div>
                </div>`;
          } else {
              // ── 🔋 電池紀錄卡片 ──
              const diff = pf(r.km) - pf(r.prevKm);
              let pillsHtml = '';
              if (diff > 0) pillsHtml += `<div class="vb-pill"><span style="color: #c026d3;">${diff}</span><span style="color: #64748b; font-size:10px;">km</span></div>`;
              // if (r.prevKm || r.km) pillsHtml += `<div class="vb-pill"><span style="color:#059669;">${r.prevKm||0} → ${r.km||0}</span></div>`;
              if (r.evFee > 0) pillsHtml += `<div class="vb-pill" style="background:#f3e8ff;"><span style="color:#9333ea;">月租$ ${fmt(r.evFee)}</span></div>`;
              if (r.evExtra > 0) pillsHtml += `<div class="vb-pill" style="background:#fee2e2;"><span style="color:#ef4444;">計費$ ${fmt(r.evExtra)}</span></div>`;

              htmlContent = `
                <div class="v-card" onclick="openAddVehRec('${safeText(r.id)}')">
                  <div class="vc-left"><img src="Vehicle/ve2.png" style="width:38px; height:38px;"></div>
                  <div class="vc-mid">
                    <div class="vc-mid-top">
                      <div class="vt-time">${formatTime}</div>
                      <div class="vt-tag" style="background:#dbeafe; color:#2563eb;">換電</div>
                    </div>
                    <div class="vc-mid-bot">${pillsHtml}</div>
                  </div>
                  <div class="vc-right">
                    <span style="font-size:14px;font-weight:650;color:var(--t2);margin-bottom:2px;">行駛</span>
                    <span class="vc-right-val"><span style="color: #ea580c;">${diff > 0 ? diff : 0}</span><span style="color: #64748b;font-size:12px;letter-spacing:1px;margin-left:4px;">km</span></span>
                  </div>
                </div>`;
          }
      } else if (r.type === 'maintenance') {
          // ── 🔧 保養 / 🛠️ 維修紀錄卡片 ──
          const isRepair = r.maintCategory === 'repair';
          const iconSrc = isRepair ? 'Vehicle/ve4.png' : 'Vehicle/ve3.png';
          const iconSize = '38px'; 
          
          // 動態色彩：維修(藍色) / 保養(綠色)
          const cardBorder = isRepair ? '#3b82f6' : '#10b981';
          const rightname = isRepair ? '維修' : '保養';
          const rightColor = isRepair ? '#2563eb' : '#00a23c';
          const rightColor1 = isRepair ? '#3067df' : '#0ab82d';
          const rightBg    = isRepair ? '#eff6ff' : '#d6ffe2';
          const pillBg     = isRepair ? '#dbeafe' : '#dcfce7';
          const pillBorder = isRepair ? '#bfdbfe' : '#86efac';
          const pillColor  = isRepair ? '#1d4ed8' : '#15803d';
          
          let pillsHtml = '';
          if (r.km) pillsHtml += `<div class="vb-pill" style="color: #ea580c; border:1px solid #c8cbce;">${fmt(r.km)}<span style="color: #64748b; font-size:10px; letter-spacing:1px;">km</span></div>`;

          (r.items || []).forEach(item => {
            pillsHtml += `<div class="vb-pill" style="background: ${pillBg}; border:1px solid ${pillBorder}; color: ${pillColor}; font-size:14px; font-weight:750;">${safeText(item)}</div>`;
          });

          // 機車行與備註標籤
          const shopHtml = r.shop ? `<div class="vt-tag" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; font-weight:800;">${safeText(r.shop)}</div>` : '';
          const noteHtml = r.note ? `<div class="vt-tag" style="background:#fef2f2; color:#e11d48; border:1px solid #fecdd3; font-weight:800; white-space:normal; word-break:break-word; max-width:100%;">${safeText(r.note)}</div>` : '';

          htmlContent = `
            <div class="v-card" onclick="openAddVehRec('${safeText(r.id)}')" style="border: 2px solid ${cardBorder}60;">
              <div class="vc-left"><img src="${iconSrc}" style="width:${iconSize}; height:${iconSize}; transition:0.3s;"></div>
              <div class="vc-mid">
                <!-- vc-mid-top 加上 flex-wrap:wrap 允許元件擠不下時換行 -->
                <div class="vc-mid-top" style="display:flex; flex-wrap:wrap; align-items:center; gap:4px;">
                  <!-- vt-time 加上 white-space:nowrap 和 flex-shrink:0 強制時間絕對不換行 -->
                  <div class="vt-time" style="white-space:nowrap; flex-shrink:0;">${formatTime}</div>
                  ${shopHtml}
                  ${noteHtml}
                </div>
                <div class="vc-mid-bot">${pillsHtml}</div>
              </div>
              <div class="vc-right" style="background:${rightBg}; border-left: 2px dashed ${cardBorder}60;">
                <span style="font-size:14px;font-weight:650;color:${rightColor};margin-bottom:2px;">${rightname}</span>
                <span class="vc-right-val" style="color:${rightColor1};background:#fff;padding:1px 6px;border-radius:9px;border:1px solid ${pillBorder};"><span style="font-size:10px;margin-right:4px;">$</span>${fmt(r.amount)}</span>
              </div>
            </div>`;
            
      } else if (r.type === 'wash') {
          // ── 🧽 洗車美容紀錄卡片 ──
          const cardBorder = '#06b6d4';
          const rightColor = '#0891b2';
          const rightBg    = '#ecfeff';
          const rightBorder    = '#9efaff';
          
          const shopHtml = r.shop ? `<div class="vt-tag" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; font-weight:800;">${safeText(r.shop)}</div>` : '';
          const noteHtml = r.note ? `<div class="vt-tag" style="background:#e0f2fe; color:#0284c7; border:1px solid #bae6fd; font-weight:800; white-space:normal; word-break:break-word; max-width:100%;">${safeText(r.note)}</div>` : '';

          htmlContent = `
            <div class="v-card" onclick="openAddVehRec('${safeText(r.id)}')" style="border: 2px solid ${cardBorder}60;">
              <div class="vc-left" style="background:#cffafe;border-right:2px dashed ${cardBorder}60;"><span style="font-size:24px;">🧽</span></div>
              <div class="vc-mid">
                <div class="vc-mid-top" style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;">
                  <div class="vt-time" style="white-space:nowrap;flex-shrink:0;">${formatTime}</div>
                  ${shopHtml}
                  ${noteHtml}
                </div>
              </div>
              <div class="vc-right" style="background:${rightBg};border-left:2px dashed ${cardBorder}60;">
                <span style="font-size:14px;font-weight:650;color:${rightColor};margin-bottom:2px;">洗車</span>
                <span class="vc-right-val" style="color:${rightColor};background:#fff;padding:1px 6px;border-radius:9px;border:1px solid ${rightBorder};"><span style="font-size:10px;margin-right:4px;">$</span>${fmt(r.amount)}</span>
              </div>
            </div>`;
      }
      
      html += htmlContent;
    });
  }
  container.innerHTML = html;
}
window.setVehSearchSubTab = function(tab) {
  S.vehSearchTab = tab;
  renderVehicleContent();
};
window.clearRemindKm = function() {
  const kmInp = document.getElementById('veh-remind-km');
  if (kmInp) {
    kmInp.value = '';
    localStorage.removeItem(`last_km_${S.selVehicleId}`);
    renderMaintReminderList();
  }
};
window.renderMaintReminderList = function() {
  const kmInp = document.getElementById('veh-remind-km');
  const resEl = document.getElementById('veh-remind-list');
  if (!kmInp || !resEl) return;

  const inputKm = pf(kmInp.value);
  if (inputKm > 0) localStorage.setItem(`last_km_${S.selVehicleId}`, inputKm);

  const cycles = (S.settings.maintCycles && S.settings.maintCycles[S.selVehicleId]) ? S.settings.maintCycles[S.selVehicleId] : {};
  const alertThreshold = cycles.alertThreshold || 200;

  // 1. 找出這台車所有保養過的零件
  const lastDone = {};
  const recs = S.vehicleRecs.filter(r => r.vehicleId === S.selVehicleId && r.type === 'maintenance');
  
  recs.sort((a, b) => pf(a.km) - pf(b.km)).forEach(r => {
    if (r.items) {
      r.items.forEach(item => {
        lastDone[item] = { km: pf(r.km), id: r.id, date: r.date };
      });
    }
  });

  // 2. 獲取所有需要追蹤的項目 (週期表裡的項目 + 歷史紀錄有的項目)
  const allItems = new Set([...Object.keys(cycles), ...Object.keys(lastDone)]);
  allItems.delete('alertThreshold');

  const displayList = [];
  allItems.forEach(name => {
    const last = lastDone[name];
    const interval = cycles[name];
    
    // 如果沒有歷史紀錄，且也沒設定週期，跳過 (代表這零件完全沒碰過)
    if (!last && !interval) return;

    // 計算狀態
    let status = 'none'; // 無設定週期
    let nextKm = 0;
    let remaining = 999999;
    let progress = 0;

    if (interval) {
        const lastKm = last ? last.km : 0;
        nextKm = lastKm + interval;
        remaining = nextKm - inputKm;
        progress = Math.max(0, Math.min(100, ((inputKm - lastKm) / interval) * 100));
        
        if (remaining <= 0) status = 'expired';
        else if (remaining <= alertThreshold) status = 'near';
        else status = 'safe';
    }

    // 🌟 如果沒設週期 (status === 'none')，一定要顯示
    // 或者符合預警條件的項目也要顯示
    if (status === 'none' || status === 'expired' || status === 'near') {
        displayList.push({ 
            name, 
            lastKm: last ? last.km : 0, 
            nextKm, 
            remaining, 
            progress, 
            lastId: last ? last.id : '',
            status 
        });
    }
  });

  if (displayList.length === 0) {
    resEl.innerHTML = `
      <div style="text-align:center; padding:60px 20px;">
        <div style="font-size:54px; margin-bottom:20px; opacity:0.8;">🍃</div>
        <div style="font-size:16px; font-weight:800; color:#10b981;">車況良好</div>
        <div style="font-size:12px; color:var(--t3); margin-top:8px;">目前沒有項目接近預警里程 (${alertThreshold} km)</div>
      </div>`;
    return;
  }

  // 排序：沒設週期的排最後，其餘依嚴重度排序
  displayList.sort((a, b) => {
    if (a.status === 'none' && b.status !== 'none') return 1;
    if (a.status !== 'none' && b.status === 'none') return -1;
    return a.remaining - b.remaining;
  });

  let html = '';
  displayList.forEach(item => {
    let color = '#64748b', icon = '⚙️', stateText = '尚未設定保養週期', cardClass = '';
    let nextKmStr = '---';

    if (item.status === 'expired') {
      color = '#ef4444'; icon = '🚨'; stateText = `已超過 ${Math.abs(item.remaining)} km！`; cardClass = 'expired';
      nextKmStr = `${fmt(item.nextKm)}`;
    } else if (item.status === 'near') {
      color = '#f97316'; icon = '⚠️'; stateText = `即將到期 (剩 ${item.remaining} km)`; cardClass = 'near';
      nextKmStr = `${fmt(item.nextKm)}`;
    } else if (item.status === 'none') {
      color = '#3b82f6'; icon = 'ℹ️'; stateText = '請點擊「設定週期」以追蹤';
      cardClass = ''; // 藍色提示樣式
    }

    html += `
      <div class="maint-alert-card ${cardClass}" onclick="${item.status === 'none' ? 'openMaintCycleSettings()':''}" style="cursor:${item.status === 'none' ? 'pointer':'default'};">
        <div class="ma-icon" style="color:${color}; background:${color}15;">${icon}</div>
        <div class="ma-info">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <span class="ma-name">${item.name}</span>
            <span style="font-size:10px; color:var(--t3); font-weight:800;">上次：${fmt(item.lastKm)} km</span>
          </div>
          <div class="ma-status-text" style="color:${color}">${stateText}</div>
          <div class="ma-progress-bg">
            <div class="ma-progress-fill" style="width:${item.progress}%; background:${color}"></div>
          </div>
        </div>
        <div class="ma-km-info">
          <div class="ma-rem-val" style="color:${color}">${nextKmStr}</div>
          <div class="ma-rem-unit">${item.status === 'none' ? '尚未設定' : '預計更換'}</div>
        </div>
      </div>
    `;
  });

  resEl.innerHTML = html;
};
window.clearRemindKm = function() {
  const kmInp = document.getElementById('veh-remind-km');
  if (kmInp) {
    kmInp.value = '';
    // 執行一次重新渲染清單
    renderMaintReminderList(); 
    // 也同步清除快取
    localStorage.removeItem(`last_km_${S.selVehicleId}`);
  }
};
window.openMaintCycleSettings = function() {
  const v = S.vehicles.find(x => x.id === S.selVehicleId);
  const isEV = v && v.defaultFuel === 'electric';
  const itemList = isEV ? MAINT_ITEMS_EV : MAINT_ITEMS_GAS;
  
  if (!S.settings.maintCycles) S.settings.maintCycles = {};
  if (!S.settings.maintCycles[S.selVehicleId]) S.settings.maintCycles[S.selVehicleId] = {};
  
  const cycles = S.settings.maintCycles[S.selVehicleId];
  // 🌟 讀取預警設定，若無則預設為 200
  const alertThreshold = cycles.alertThreshold || 200;

  document.getElementById('sub-title').textContent = '保養週期設定';
  document.getElementById('sub-top-right').innerHTML = `<button onclick="saveMaintCycles()" class="btn-acc" style="padding:6px 16px; border-radius:12px;">儲存</button>`;

  let html = `<div style="padding:16px;">
    <!-- 🌟 新增：預警里程設定區塊 -->
    <div style="background: linear-gradient(135deg, #eff6ff 0%, #ffffff 100%); border: 2px solid #3b82f6; border-radius: 16px; padding: 16px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1);">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
        <span style="font-size:20px;">🔔</span>
        <span style="font-size:15px; font-weight:900; color:#1e3a8a;">保養預警里程 (橘色狀態)</span>
      </div>
      <div style="display:flex; align-items:center; gap:12px;">
        <input type="number" id="cfg-alert-threshold" value="${alertThreshold}" placeholder="200" style="flex:1; padding:12px; border:1.5px solid #bfdbfe; border-radius:10px; font-family:var(--mono); font-weight:900; font-size:18px; color:#2563eb; text-align:center; outline:none;">
        <span style="font-size:14px; color:#64748b; font-weight:800;">km 前提醒</span>
      </div>
      <p style="font-size:11px; color:#3b82f6; margin-top:8px; font-weight:600; line-height:1.4;">
        ※ 當「剩餘里程」低於此數值時，零件將顯示為橘色警告。
      </p>
    </div>

    <div style="font-size:13px; color:var(--t3); margin-bottom:12px; font-weight:700; padding-left:4px;">📋 各項目保養週期 (km)</div>
    <div class="card" style="padding:0; overflow:hidden; border:1px solid #e2e8f0;">`;

  itemList.forEach(item => {
    const val = cycles[item] || '';
    html += `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid #f1f5f9; background:#fff;">
        <span style="font-size:15px; font-weight:800; color:var(--t1);">${item}</span>
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="number" class="cycle-input" data-item="${item}" value="${val}" placeholder="未設定" style="width:100px; padding:8px; border:1.5px solid #cbd5e1; border-radius:8px; text-align:right; font-family:var(--mono); font-weight:800; color:#0f172a;">
          <span style="font-size:12px; color:var(--t3); font-weight:700;">km</span>
        </div>
      </div>`;
  });

  html += `</div></div>`;
  document.getElementById('sub-body').innerHTML = html;
  openOverlay('sub-page');
};
window.saveMaintCycles = function() {
  if (!S.settings.maintCycles[S.selVehicleId]) S.settings.maintCycles[S.selVehicleId] = {};
  const cycles = S.settings.maintCycles[S.selVehicleId];

  // 🌟 儲存預警里程設定
  const thresholdVal = pf(document.getElementById('cfg-alert-threshold').value);
  cycles.alertThreshold = thresholdVal > 0 ? thresholdVal : 200; // 防呆：至少要有值，否則預設200

  // 儲存各零件週期
  const inputs = document.querySelectorAll('.cycle-input');
  inputs.forEach(input => {
    const item = input.dataset.item;
    const val = pf(input.value);
    if (val > 0) cycles[item] = val;
    else delete cycles[item];
  });

  saveSettings();
  toast('週期與預警設定，已更新 ✅');
  closeOverlay('sub-page');
  renderMaintReminderList(); 
};

async function deleteVehicle(id) {
  const ok = await customConfirm('確定要刪除這台車輛嗎？<br><span style="color:var(--red); font-size:12px;">⚠️ 該車的所有記錄將一併刪除且無法復原</span>'); if(!ok) return;
  S.vehicles = S.vehicles.filter(v => v.id !== id); S.vehicleRecs = S.vehicleRecs.filter(r => r.vehicleId !== id); 
  if (S.selVehicleId === id) S.selVehicleId = null; saveVehicles(); saveVehicleRecs(); renderVehicles(); toast('車輛與記錄，已刪除');
}

/* ══ 動態保養項目全域變數與邏輯 ══ */
let tempMaintItems = []; // 存放 [{ name: '', amount: '' }]
function renderMaintDynamicList() {
  const container = document.getElementById('vm-dynamic-list');
  if (!container) return;
  
  // 外框維持綠色，輸入框字體設定為亮粉色 #ec4899
  container.innerHTML = tempMaintItems.map((item, idx) => `
    <div style="display:flex; gap:6px; align-items:center;">
      <input type="text" class="finp" style="flex:1.5; padding:8px 10px; font-size:13px; border-color:var(--green); color:#ec4899;" placeholder="項目名稱 (如:機油)" value="${safeText(item.name)}" oninput="updateMaintItem(${idx}, 'name', this.value)">
      <input type="number" class="finp myInput" style="flex:1; padding:8px 10px; font-size:14px; font-family:var(--mono); border-color:var(--green); color:#ec4899; font-weight:800;" placeholder="金額" class="myInput" inputmode="numeric" value="${item.amount}" oninput="updateMaintItem(${idx}, 'amount', this.value)">
      <button onclick="removeMaintItemRow(${idx})" style="background:var(--red-d); color:var(--red); border:none; width:34px; height:34px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:900; cursor:pointer;">✕</button>
    </div>
  `).join('');
  
  calcMaintTotal();
}
function addMaintItemRow() {
  tempMaintItems.push({ name: '', amount: '' });
  renderMaintDynamicList();
}
function removeMaintItemRow(idx) {
  if (tempMaintItems.length === 1) {
    // 至少保留一行，直接清空
    tempMaintItems[0] = { name: '', amount: '' };
  } else {
    tempMaintItems.splice(idx, 1);
  }
  renderMaintDynamicList();
}
function updateMaintItem(idx, field, val) {
  tempMaintItems[idx][field] = val;
  if (field === 'amount') calcMaintTotal();
}
// 自動加總總金額
function calcMaintTotal() {
  let total = 0;
  tempMaintItems.forEach(item => {
    total += pf(item.amount);
  });
  const displayEl = document.getElementById('vm-amount-display');
  if (displayEl) displayEl.textContent = fmt(total);
  return total;
}
// 點擊標籤快速加入與切換特效
window.clickMaintTag = function(tagName, el) {
  // 如果已經是亮起狀態，再次點擊就取消它
  if (el.classList.contains('on')) {
    el.classList.remove('on');
    // 從輸入框中把這個項目移除
    const idx = tempMaintItems.findIndex(t => t.name === tagName);
    if (idx !== -1) {
      if (tempMaintItems.length === 1) {
        tempMaintItems[0] = { name: '', amount: '' }; // 如果只剩一行，就清空
      } else {
        tempMaintItems.splice(idx, 1);
      }
      renderMaintDynamicList();
    }
    return;
  }

  // 👇 如果還沒亮起，就加上 'on' 讓 CSS 特效生效
  el.classList.add('on');

  // 找尋第一個 name 為空的欄位
  const emptyIdx = tempMaintItems.findIndex(t => t.name.trim() === '');
  if (emptyIdx !== -1) {
    tempMaintItems[emptyIdx].name = tagName;
  } else {
    // 如果沒有空行，則新增一行
    tempMaintItems.push({ name: tagName, amount: '' });
  }
  renderMaintDynamicList();
}
/* ══ 保養/維修 類別切換函式 ══ */
window.setMaintCategory = function(cat, idx) {
  currentMaintCategory = cat;
  const bg = document.getElementById('maint-cat-bg');
  if(bg) {
    bg.style.transform = `translateX(${idx * 100}%)`;
    // 保養綠色，維修橘色
    bg.style.background = cat === 'maintenance' ? '#10b981' : '#f59e0b';
  }
  document.getElementById('btn-mcat-maint').style.color = cat === 'maintenance' ? '#fff' : 'var(--t2)';
  document.getElementById('btn-mcat-maint').style.fontWeight = cat === 'maintenance' ? '800' : '600';
  document.getElementById('btn-mcat-repair').style.color = cat === 'repair' ? '#fff' : 'var(--t2)';
  document.getElementById('btn-mcat-repair').style.fontWeight = cat === 'repair' ? '800' : '600';
}

/* ══ 替換：新增車輛記錄 ══ */
window.openAddVehRec = function(recordId = null) {
  // 👇 檢查會員權限
  /*
  if (!USER.loggedIn) { showLoginRequiredWarning(); return; }
*/
  // 🛡️ 防呆機制：若被瀏覽器誤傳 Event 事件物件，強制轉為 null
  if (typeof recordId === 'object' && recordId !== null) recordId = null;

  editingVehRecId = recordId; 
  const isEdit = !!recordId; 
  
  if (!isEdit && S.vehicles.length === 0) { toast('請先新增車輛'); return; }
  
  document.getElementById('veh-rec-title').textContent = isEdit ? '編輯車輛記錄' : '新增車輛記錄'; 
  document.getElementById('veh-rec-del-btn').style.display = isEdit ? 'block' : 'none';
  
  const v = S.vehicles.find(x => x.id === S.selVehicleId);
  const isEV = v && v.defaultFuel === 'electric';

  if (v) {
    const iconNum = (v.icon && v.icon <= 11) ? v.icon : 1;
    document.getElementById('veh-rec-veh-icons').innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; background:var(--sf); border:1px solid var(--border); padding:8px 12px; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,0.02);">
        <div style="width:40px; height:40px; border-radius:10px; background:var(--sf2); border:2px solid var(--acc); display:flex; align-items:center; justify-content:center;">
          <img src="scooter/s${iconNum}.png" style="width:28px; height:28px; object-fit:contain;">
        </div>
        <div>
          <div style="font-size:14px; font-weight:800; color:var(--t1); margin-bottom:2px;">${safeText(v.name)}</div>
          <div style="font-size:10px; font-weight:700; color:var(--blue); background:#eff6ff; border:1px solid #bfdbfe; padding:2px 6px; border-radius:6px; display:inline-block;">${isEV ? '🔋 電動車 (電池)' : '⛽ ' + v.defaultFuel + ' 無鉛汽油'}</div>
        </div>
      </div>`;
  }

  let r = null; 
  if (isEdit) { 
    r = S.vehicleRecs.find(x => x.id === recordId); 
    S.addVehRecType = r.type; 
  } else { 
    // 🛡️ 防呆機制：預防從「年總覽」或「搜尋」頁籤點擊新增時，造成表單空白報錯卡住
    S.addVehRecType = (['fuel', 'maintenance', 'wash'].includes(S.vehicleTab)) ? S.vehicleTab : 'fuel'; 
  }
  
  document.getElementById('vr-date').value = r ? r.date : todayStr(); 
  document.getElementById('vr-time').value = r ? (r.time || nowTime()) : nowTime();
  
  // ==========================================
  // 1. 強制初始化【保養維修】所有欄位
  // ==========================================
  if (r && r.type === 'maintenance') {
    if (r.itemDetails && r.itemDetails.length > 0) {
      tempMaintItems = JSON.parse(JSON.stringify(r.itemDetails));
    } else if (r.items && r.items.length > 0) {
      tempMaintItems = r.items.map((itemName, idx) => ({ name: itemName, amount: idx === 0 ? (r.amount || '') : '' }));
    } else {
      tempMaintItems = [{ name: '', amount: r.amount || '' }];
    }
    const savedCat = r.maintCategory || 'maintenance';
    setMaintCategory(savedCat, savedCat === 'maintenance' ? 0 : 1);
  } else {
    tempMaintItems = [{ name: '', amount: '' }];
    setMaintCategory('maintenance', 0);
  }
  const vwAmount = document.getElementById('vw-amount'); if (vwAmount) vwAmount.value = (r && r.type === 'wash') ? (r.amount || '') : '';
  const vwShop = document.getElementById('vw-shop'); if (vwShop) vwShop.value = (r && r.type === 'wash') ? (r.shop || '') : '';
  const vwNote = document.getElementById('vw-note'); if (vwNote) vwNote.value = (r && r.type === 'wash') ? (r.note || '') : '';

  renderMaintDynamicList();
  
  const maintList = isEV ? MAINT_ITEMS_EV : MAINT_ITEMS_GAS;
  const tagsContainer = document.getElementById('vm-items-tags');
  if (tagsContainer) {
    tagsContainer.innerHTML = maintList.map(item => 
      // 👇 加入 this，這樣函式才知道是哪一個標籤被點擊了
      `<div class="item-chip" onclick="clickMaintTag('${item}', this)">${item}</div>`
    ).join('');
  }

  const vmKm = document.getElementById('vm-km'); if (vmKm) vmKm.value = (r && r.type === 'maintenance') ? (r.km || '') : '';
  const vmShop = document.getElementById('vm-shop'); if (vmShop) vmShop.value = (r && r.type === 'maintenance') ? (r.shop || '') : ''; 
  const vmPay = document.getElementById('vm-pay-method'); if (vmPay) vmPay.value = (r && r.type === 'maintenance') ? (r.payMethod || '現金') : '現金'; 
  const vmNote = document.getElementById('vm-note'); if (vmNote) vmNote.value = (r && r.type === 'maintenance') ? (r.note || '') : ''; 
  renderShopHistory(); 

  // ==========================================
  // 2. 強制初始化【車輛燃料】所有欄位
  // ==========================================
  const vrFuelType = document.getElementById('vr-fuel-type'); if(vrFuelType) vrFuelType.value = (r && r.type === 'fuel') ? (r.fuelType || '95') : (v ? v.defaultFuel : '95'); 
  const vrDiscount = document.getElementById('vr-discount'); if(vrDiscount) vrDiscount.value = (r && r.type === 'fuel') ? (r.discount || '') : ''; 
  // ==========================================
  // 3. 🚨 必須先切換頁籤建立 DOM 結構，才能賦值
  // ==========================================
  switchVehFormTab(S.addVehRecType, S.addVehRecType === 'fuel' ? 0 : 1); 

  // ==========================================
  // 4. 讀取與賦值 (包含電動車月租費)
  // ==========================================
  const vrPrevKm = document.getElementById('vr-prev-km'); if(vrPrevKm) vrPrevKm.value = (r && r.type === 'fuel') ? (r.prevKm || '') : ''; 
  const vrCurrKm = document.getElementById('vr-curr-km'); if(vrCurrKm) vrCurrKm.value = (r && r.type === 'fuel') ? (r.km || '') : ''; 
  const vrLiters = document.getElementById('vr-liters'); if(vrLiters) vrLiters.value = (r && r.type === 'fuel') ? (r.liters || '') : ''; 
  const vrPrice = document.getElementById('vr-price'); if(vrPrice) vrPrice.value = (r && r.type === 'fuel') ? (r.price || '') : ''; 
  const vrEvFee = document.getElementById('vr-ev-fee'); if(vrEvFee) vrEvFee.value = (r && r.type === 'fuel' && isEV) ? (r.evFee !== undefined ? r.evFee : r.amount) : ''; 
  const vrEvExtra = document.getElementById('vr-ev-extra'); if(vrEvExtra) vrEvExtra.value = (r && r.type === 'fuel' && isEV) ? (r.evExtra || '') : ''; 
  
  // 觸發運算讓面板數字更新
  calcVehFuel(); 
  openOverlay('veh-rec-add-page');

  if (!isEdit && S.addVehRecType === 'fuel') {
      const priceEl = document.getElementById('vr-price');
      if (priceEl && !priceEl.value) {
          applyGlobalGasPrice();
      }
  }
}
/* ══ 刪除單筆車輛記錄 ══ */
window.deleteVehRecFromEdit = async function() {
  // 確保目前有正在編輯的記錄 ID
  if (!editingVehRecId) return;

  const ok = await customConfirm('確定要<span style="color:var(--red);"> 刪除 </span>這筆車輛記錄嗎？<br><span style="color:var(--text-blue);font-weight:700;">此動作無法復原。</span>');
  if (!ok) return;

  // 1. 從記錄陣列中濾除這筆 ID
  S.vehicleRecs = S.vehicleRecs.filter(r => r.id !== editingVehRecId);
  
  // 2. 執行存檔 (IndexedDB / LocalStorage)
  saveVehicleRecs();
  
  // 3. 清除狀態、關閉彈窗
  editingVehRecId = null;
  closeOverlay('veh-rec-add-page');
  
  // 4. 重新渲染畫面並提示
  renderVehicles();
  toast('記錄「已刪除」✅');
};


/* ══ 替換：車輛表單頁籤切換 (維持原主題色，僅修改輸入框字體顏色) ══ */
function switchVehFormTab(type, index) {
  S.addVehRecType = type; 
  document.getElementById('veh-form-tab-bg').style.transform = `translateX(${index * 100}%)`; 
  document.getElementById('btn-form-fuel').classList.toggle('active', type === 'fuel'); 
  document.getElementById('btn-form-maint').classList.toggle('active', type === 'maintenance'); 
  document.getElementById('btn-form-wash').classList.toggle('active', type === 'wash'); 
  
  document.getElementById('form-area-fuel').style.display = type === 'fuel' ? 'block' : 'none'; 
  document.getElementById('form-area-maint').style.display = type === 'maintenance' ? 'block' : 'none';
  document.getElementById('form-area-wash').style.display = type === 'wash' ? 'block' : 'none';
  
  const v = S.vehicles.find(x => x.id === S.selVehicleId);
  const isEV = v && v.defaultFuel === 'electric';
  
  const vehPage = document.getElementById('veh-rec-add-page');
  const tabBg = document.getElementById('veh-form-tab-bg');
  
  if (type === 'fuel') {
    // 【車輛燃料】主題：頁籤與背景為紅色，但輸入框的字改為「亮藍色」(#007AFF)
    tabBg.style.backgroundColor = 'var(--red)';
    tabBg.style.boxShadow = '0 4px 10px rgba(239, 68, 68, 0.4)';
    vehPage.style.setProperty('--veh-inp-border', 'var(--red)');
    vehPage.style.setProperty('--veh-inp-bg', 'rgba(239,68,68,0.05)');
    vehPage.style.setProperty('--veh-inp-color', '#007AFF'); // 👈 字變亮藍色

// 針對電動車隱藏油價/油量，顯示獨立的月租費卡片
    const typeRow = document.getElementById('vr-fuel-type-row');
    const amtRow = document.getElementById('vr-fuel-amount-row');
    const evFeeCard = document.getElementById('vr-ev-fee-card'); // 👈 改抓 Card
    if(typeRow) typeRow.style.display = isEV ? 'none' : 'flex';
    if(amtRow) amtRow.style.display = isEV ? 'none' : 'flex';
    if(evFeeCard) evFeeCard.style.display = isEV ? 'block' : 'none'; // 👈 改成 block

    document.getElementById('lbl-prev-km').innerHTML = isEV ? '上次換電里程 <span>(km)</span>' : '上次里程 <span>(km)</span>';
    document.getElementById('lbl-curr-km').innerHTML = isEV ? '現在換電里程 <span>(km)</span>' : '現在里程 <span>(km)</span>';
    
    const totalPanel = document.getElementById('vr-fuel-total-panel');
    if (totalPanel) {
      if (isEV) {
        totalPanel.style.background = '#eff6ff';
        totalPanel.style.border = '2px solid #93c5fd';
        totalPanel.style.boxShadow = '0 4px 16px rgba(59, 130, 246, 0.15)';
        totalPanel.innerHTML = `
          <div style="width:100%; display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:12px; font-weight:800; color:#64748b;">💰 月租費</span>
            <span style="font-size:14px; font-weight:900; color:#64748b; font-family:var(--mono);">$ <span id="vr-ev-fee-display">0</span></span>
          </div>
          <div style="width:100%; display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:8px; border-bottom:1px dashed #bfdbfe;">
            <span style="font-size:12px; font-weight:800; color:#ef4444;">⚡ 計費換電</span>
            <span style="font-size:14px; font-weight:900; color:#ef4444; font-family:var(--mono);">$ <span id="vr-ev-extra-display">0</span></span>
          </div>
          <div style="width:100%; display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <span style="font-size:15px; font-weight:900; color:#8b5cf6;">💵 總金額</span>
            <span style="font-size:22px; font-weight:900; color:#8b5cf6; font-family:var(--mono);">$ <span id="vr-ev-total-display">0</span></span>
          </div>
          <div style="width:100%; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:16px; font-weight:900; color:#1e3a8a;">🔋 本次換電行駛</span>
            <div style="font-size:38px; font-weight:900; color:#3b82f6; font-family:var(--mono); line-height:1;">
              <span id="vr-ev-calc">0</span><span style="font-size:15px; margin-left:6px; color:#60a5fa;">km</span>
            </div>
          </div>`;
      } else {
        // ...(保持原本汽油的 totalPanel 內容不變)...
        totalPanel.style.background = '#fff1f2';
        totalPanel.style.border = '2px solid #fda4af';
        totalPanel.style.boxShadow = '0 4px 16px rgba(225, 29, 72, 0.15)';
        totalPanel.innerHTML = `
          <div style="width:100%; display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:13px; font-weight:800; color:#475569; opacity:0.9;">折扣前總額</span>
            <span style="font-size:16px; font-weight:800; color:#64748b; font-family:var(--mono);">$ <span id="vr-before-total">0</span></span>
          </div>
          <div style="width:100%; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:16px; font-weight:900; color:#0f172a;">⛽ 實際付款金額</span>
            <span style="font-size:38px; font-weight:900; color:#e11d48; font-family:var(--mono); line-height:1;">$ <span id="vr-final-total">0</span></span>
          </div>`;
      }
    }
  } else if (type === 'wash') {
    // 【洗車美容】主題：水藍色
    tabBg.style.backgroundColor = '#06b6d4'; 
    tabBg.style.boxShadow = '0 4px 10px rgba(6, 182, 212, 0.4)';
    vehPage.style.setProperty('--veh-inp-border', '#06b6d4');
    vehPage.style.setProperty('--veh-inp-bg', 'rgba(6, 182, 212, 0.05)');
    vehPage.style.setProperty('--veh-inp-color', '#0891b2'); 
  } else {
    // 【保養維修】主題：頁籤與背景為綠色，但輸入框的字改為「亮粉色」(#ec4899)
    tabBg.style.backgroundColor = 'var(--green)'; 
    tabBg.style.boxShadow = '0 4px 10px rgba(34, 197, 94, 0.4)';
    vehPage.style.setProperty('--veh-inp-border', 'var(--green)');
    vehPage.style.setProperty('--veh-inp-bg', 'rgba(34,197,94,0.05)');
    vehPage.style.setProperty('--veh-inp-color', '#ff00bb'); // 👈 字變亮粉色
  }
}

function calcVehFuel() { 
  const prev = pf(document.getElementById('vr-prev-km').value);
  const curr = pf(document.getElementById('vr-curr-km').value);
  if (document.getElementById('vr-ev-calc')) {
    const diff = curr - prev;
    document.getElementById('vr-ev-calc').textContent = diff > 0 ? diff : '0';
  }

  const liters = pf(document.getElementById('vr-liters') ? document.getElementById('vr-liters').value : 0); 
  const price = pf(document.getElementById('vr-price') ? document.getElementById('vr-price').value : 0); 
  const discount = pf(document.getElementById('vr-discount') ? document.getElementById('vr-discount').value : 0); 
  const before = Math.round(liters * price); 
  const final = Math.round(Math.max(0, before - discount)); 
  
  if (document.getElementById('vr-before-total')) document.getElementById('vr-before-total').textContent = fmt(before); 
  if (document.getElementById('vr-final-total')) document.getElementById('vr-final-total').textContent = fmt(final); 
  
  // 👇 更新電動車的雙重計費顯示
  if (document.getElementById('vr-ev-fee')) {
    const fee = pf(document.getElementById('vr-ev-fee').value);
    const extra = pf(document.getElementById('vr-ev-extra')?.value || 0);
    if (document.getElementById('vr-ev-fee-display')) document.getElementById('vr-ev-fee-display').textContent = fmt(fee);
    if (document.getElementById('vr-ev-extra-display')) document.getElementById('vr-ev-extra-display').textContent = fmt(extra);
    if (document.getElementById('vr-ev-total-display')) document.getElementById('vr-ev-total-display').textContent = fmt(fee + extra);
  }
}

/* ══ 替換：儲存車輛記錄 (處理明細資料寫入，完美支援搜尋) ══ */
async function confirmAddVehRec() {
  const checkImg = document.getElementById('veh-save-img'); 
  const checkBtn = document.getElementById('veh-save-btn'); 
  if (checkBtn.disabled) return; 

  // 🌟 [新增點擊回饋]
  if (checkImg) checkImg.src = 'images/Check2.png';
  await new Promise(resolve => setTimeout(resolve, 200));

  // 統一還原函式
  const restoreCheck = () => {
    if (checkImg) checkImg.src = 'images/Check1.png';
    if (checkBtn) checkBtn.disabled = false;
  };

  if (!S.selVehicleId) { 
    restoreCheck();
    toast('請先選擇車輛');
    return; 
  }
  
  const isEV = S.vehicles.find(x => x.id === S.selVehicleId)?.defaultFuel === 'electric';
  let finalAmount = 0; 
  let finalItems = [];
  let finalItemDetails = [];
  
  if (S.addVehRecType === 'fuel') { 
    if (isEV) {
      const fee = pf(document.getElementById('vr-ev-fee').value);
      const extra = pf(document.getElementById('vr-ev-extra')?.value || 0);
      finalAmount = fee + extra; // 👈 總額相加
    } else {
      const finalTotalEl = document.getElementById('vr-final-total');
      if (finalTotalEl) {
        finalAmount = pf(finalTotalEl.textContent.replace(/,/g,'')); 
        if (finalAmount <= 0) { restoreCheck(); toast('金額不能為 0'); return; }
      }
    }
  } else if (S.addVehRecType === 'wash') {
    finalAmount = pf(document.getElementById('vw-amount').value);
    if (finalAmount <= 0) { restoreCheck(); toast('洗車美容，金額不能為 0'); return; }
  } else {
    // 整理明細陣列並防呆
    finalItemDetails = tempMaintItems.filter(t => t.name.trim() !== '' && pf(t.amount) > 0);
    if (finalItemDetails.length === 0) { restoreCheck(); toast('請至少輸入一項(保養項目及金額)'); return; }
    
    // 計算總額
    finalAmount = finalItemDetails.reduce((sum, t) => sum + pf(t.amount), 0);
    
    // 萃取純名稱陣列，塞入 items 屬性，確保舊的「記錄搜尋」功能完美相容不壞掉！
    finalItems = finalItemDetails.map(t => t.name.trim());
  }

  checkBtn.disabled = true; 
  runSaveProgress(() => {
    const commonData = { id: editingVehRecId || newId(), vehicleId: S.selVehicleId, type: S.addVehRecType, date: document.getElementById('vr-date').value, time: document.getElementById('vr-time').value, amount: finalAmount }; 
    let specificData = {};
    
    if (S.addVehRecType === 'fuel') { 
      specificData = { 
        fuelType: isEV ? 'electric' : document.getElementById('vr-fuel-type').value, 
        discount: isEV ? 0 : pf(document.getElementById('vr-discount').value), 
        prevKm: pf(document.getElementById('vr-prev-km').value), 
        km: pf(document.getElementById('vr-curr-km').value), 
        liters: isEV ? 0 : pf(document.getElementById('vr-liters').value), 
        price: isEV ? 0 : pf(document.getElementById('vr-price').value),
        evFee: isEV ? pf(document.getElementById('vr-ev-fee').value) : 0,    // 👈 獨立儲存月租費
        evExtra: isEV ? pf(document.getElementById('vr-ev-extra')?.value || 0) : 0 // 👈 獨立儲存計費換電
      }; 
    } else if (S.addVehRecType === 'wash') {
      specificData = {
        shop: document.getElementById('vw-shop').value.trim(),
        note: document.getElementById('vw-note').value.trim()
      };
    } else { 
      const shop = document.getElementById('vm-shop').value.trim(); 
      if (shop && !S.settings.shopHistory.includes(shop)) { S.settings.shopHistory.push(shop); saveSettings(); } 
      specificData = { 
        maintCategory: currentMaintCategory, 
        km: pf(document.getElementById('vm-km').value), 
        items: finalItems,             
        itemDetails: finalItemDetails, 
        shop: shop, 
        payMethod: document.getElementById('vm-pay-method').value, 
        note: document.getElementById('vm-note').value 
      }; 
    }
    
    const finalRec = { ...commonData, ...specificData }; 
    if (editingVehRecId) { const idx = S.vehicleRecs.findIndex(r => r.id === editingVehRecId); if (idx >= 0) S.vehicleRecs[idx] = finalRec; toast('記錄「已更新」✅'); } 
    else { S.vehicleRecs.push(finalRec); toast('記錄「已新增」✅'); }
    
    editingVehRecId = null; 
    saveVehicleRecs(); 
    restoreCheck();
    closeOverlay('veh-rec-add-page'); 

    // 儲存後跳到對應的車輛分頁（燃料 / 保養維修 / 洗車美容）
    const savedType = finalRec.type || S.addVehRecType || 'fuel';
    S.vehicleTab = savedType;
    // 同步日曆年月到這筆記錄的日期
    if (finalRec.date) {
      const parts = finalRec.date.split('-');
      if (parts.length >= 2) {
        S.vehY = parseInt(parts[0], 10);
        S.vehM = parseInt(parts[1], 10);
      }
    }
    goPage('vehicles');
    renderVehicles();
  });
}

/* ══ 替換：新增車輛彈窗與左右滑動圖示選擇 ══ */
function openAddVehicle() {
  S.newVehIcon = 1; 
  const container = document.getElementById('vehicle-add-body');
  let iconsHtml = '';
  for (let i = 1; i <= 9; i++) {
    const isSel = S.newVehIcon === i;
    iconsHtml += `<img src="scooter/s${i}.png" id="veh-opt-${i}" onclick="selectNewVehIcon(${i})" style="width:70px; height:70px; object-fit:contain; border:2px solid ${isSel ? 'var(--acc)' : 'transparent'}; border-radius:12px; cursor:pointer; transition:transform 0.2s; transform:${isSel ? 'scale(1.05)' : 'scale(1)'}; flex-shrink:0; background:var(--sf); padding:4px;">`;
  }
  
  container.innerHTML = `
    <div style="padding:16px;">
      <div class="fg" style="margin-bottom:16px">
        <label style="font-weight:700; color:var(--t1);">車輛名稱 <span style="color:red">*</span></label>
        <input type="text" class="finp" id="v-name" placeholder="例如：我的愛車 Gogoro">
      </div>
      
      <div class="fg" style="margin-bottom:20px;">
        <label style="font-weight:700; color:var(--t1);">滑動選擇機車圖示</label>
        <div style="display:flex; overflow-x:auto; gap:12px; background:var(--bg-input); padding:16px; border-radius:16px; align-items:center;">
          ${iconsHtml}
        </div>
      </div>

      <div class="fg" style="margin-bottom:20px">
        <label style="font-weight:700; color:var(--t1);">預設燃料 <span style="color:red">*</span></label>
        <select class="fsel" id="v-fuel" onchange="toggleFuelTypeUI()">
          <option value="92" selected>92 無鉛汽油</option>
          <option value="95">95 無鉛汽油</option>
          <option value="98">98 無鉛汽油</option>
          <option value="electric">電動車 (電池)</option>
        </select>
      </div>
      
      <!-- 新增詳細車輛資訊區塊 -->
      <h3 style="font-size:13px; color:var(--hint-color); margin-bottom:12px; border-bottom:1px dashed var(--border); padding-bottom:8px;">📝 進階車輛資訊 (選填)</h3>
      
      <div class="fg" style="margin-bottom:16px">
        <label style="font-weight:700; color:var(--t1);">車牌號碼</label>
        <input type="text" class="finp" id="v-plate" placeholder="例如：ABC-1234">
      </div>

      <div style="display:flex; gap:10px; margin-bottom:16px;">
        <div class="fg" style="flex:1;">
          <label id="lbl-v-cc" style="font-weight:700; color:var(--t1);">排氣量 (cc)</label>
          <input type="number" class="finp" id="v-cc" placeholder="例如：125" step="0.1">
        </div>
        <div class="fg" style="flex:1;">
          <label style="font-weight:700; color:var(--t1);">車輛顏色</label>
          <input type="text" class="finp" id="v-color" placeholder="例如：消光黑">
        </div>
      </div>

      <div class="fg" style="margin-bottom:24px">
        <label style="font-weight:700; color:var(--t1);">出廠年月</label>
        <input type="month" class="finp" id="v-year">
      </div>

      <div style="display:flex;gap:10px;">
        <button onclick="closeOverlay('vehicle-add-page')" style="flex:1;padding:14px;border-radius:var(--rs);background:var(--sf2);border:1px solid var(--border);color:var(--t2);font-weight:700;cursor:pointer;">取消</button>
        <button onclick="saveNewVehicle()" class="btn-acc" style="flex:2;padding:14px;font-weight:800;border-radius:var(--rs);box-shadow:0 4px 12px rgba(255,107,53,0.3);">確認新增</button>
      </div>
    </div>`;
  document.getElementById('vehicle-add-page').querySelector('h2').textContent = '新增車輛';
  openOverlay('vehicle-add-page');
  setTimeout(() => toggleFuelTypeUI(), 10); // 載入時觸發一次判斷
}
// 機車圖片數量
function selectNewVehIcon(id) { 
  S.newVehIcon = id; 
  for (let i = 1; i <= 9; i++) { 
    const img = document.getElementById(`veh-opt-${i}`); 
    if (!img) continue; 
    if (i === S.newVehIcon) { 
      img.style.borderColor = 'var(--acc)'; 
      img.style.transform = 'scale(1.05)'; 
    } else { 
      img.style.borderColor = 'transparent'; 
      img.style.transform = 'scale(1)'; 
    } 
  } 
}
function updateVehIconUI() { for (let i = 4; i <= 14; i++) { const box = document.getElementById(`veh-icon-box-${i}`); const mask = document.getElementById(`veh-icon-mask-${i}`); if (!box || !mask) continue; if (i === S.newVehIcon) { box.style.borderColor = 'var(--acc)'; mask.style.backgroundColor = S.newVehColor; } else { box.style.borderColor = 'transparent'; mask.style.backgroundColor = '#ccc'; } } }
function saveNewVehicle() { 
  const name = document.getElementById('v-name').value.trim(); 
  if (!name) { toast('請輸入「車輛名稱」'); return; } 
  const fuel = document.getElementById('v-fuel').value; 
  
  // 抓取新的選填欄位
  const plate = document.getElementById('v-plate').value.trim();
  const cc = document.getElementById('v-cc').value.trim();
  const color = document.getElementById('v-color').value.trim();
  const year = document.getElementById('v-year').value;
  
  S.vehicles.push({ 
    id: newId(), 
    name: name, 
    icon: S.newVehIcon, 
    defaultFuel: fuel,
    plate: plate,
    cc: cc,
    color: color,
    year: year
  }); 
  
  saveVehicles(); 
  closeOverlay('vehicle-add-page'); 
  toast('「車輛」已新增 ✅'); 
  renderVehicles(); 
}

let currentSelItems = []; function toggleMaintItem(el, item) { el.classList.toggle('on'); if (currentSelItems.includes(item)) { currentSelItems = currentSelItems.filter(i => i !== item); } else { currentSelItems.push(item); } }
function setShopInput(value) {
  document.getElementById('vm-shop').value = value;
}

let isEditingShopHistory = false;
window.toggleShopEdit = function() {
  isEditingShopHistory = !isEditingShopHistory;
  renderShopHistory();
}

function renderShopHistory() {
  const container = document.getElementById('shop-history-container');
  if (!container) return; 
  if (!S.settings.shopHistory) S.settings.shopHistory = [];
  
  if (S.settings.shopHistory.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  let tagsHtml = S.settings.shopHistory.map((shop, i) => {
    const safeShopStr = safeText(shop).replace(/'/g, "\\'");
    return `
      <div class="shop-chip" style="padding-right:${isEditingShopHistory ? '4px' : '12px'};">
        <span style="flex:1;" onclick="setShopInput('${safeShopStr}')">${safeText(shop)}</span>
        ${isEditingShopHistory ? `<span class="shop-chip-del" onclick="event.stopPropagation(); deleteShopHistory(${i})">✕</span>` : ''}
      </div>
    `;
  }).join('');

  const editBtn = `<div onclick="toggleShopEdit()" style="display:inline-flex; align-items:center; padding:4px 10px; border-radius:12px; font-size:11px; font-weight:800; color:var(--text-blue); background:#eff6ff; border:1px solid #bfdbfe; cursor:pointer; margin-left:4px; box-shadow:0 2px 4px rgba(0,0,0,0.02); transition:0.2s;">${isEditingShopHistory ? '✅ 完成' : '✎ 編輯'}</div>`;

  container.innerHTML = tagsHtml + editBtn;
}
function deleteShopHistory(index) { S.settings.shopHistory.splice(index, 1); saveSettings(); renderShopHistory(); }

/* ══ 新增：開啟車輛搜尋的「全螢幕懸浮視窗」 ══ */
window.openVehSearchFullscreen = function() {
  // 把目前頁面上的搜尋關鍵字帶過去
  const currentKw = document.getElementById('veh-search-kw')?.value || '';

  document.getElementById('sub-title').textContent = '車輛記錄完整搜尋';
  document.getElementById('sub-top-right').innerHTML = ''; // 清空右上角

  const isEV = S.vehicles.find(x => x.id === S.selVehicleId)?.defaultFuel === 'electric';
  const maintList = isEV ? MAINT_ITEMS_EV : MAINT_ITEMS_GAS;

  // 👇 透過設定 flex:1 與 overflow-y:auto 讓結果清單能貫穿整個螢幕高度
  let html = `
    <div style="padding:16px; display:flex; flex-direction:column; height:100vh; max-height: calc(100vh - 80px);">
      <div style="background:var(--sf); padding:12px; border-radius:16px; margin-bottom:12px; border:1px solid var(--border); box-shadow:0 4px 12px rgba(0,0,0,0.05); flex-shrink:0;">
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:10px;">
          <input type="text" class="finp" id="fs-veh-search-kw" value="${currentKw}" placeholder="🔍 搜尋項目、店家或備註..." oninput="doVehSearch(true)" style="flex:1; padding:10px 14px; font-size:15px; border-radius:12px; border:2px solid var(--text-blue); background:#ffffff; box-shadow:inset 0 1px 3px rgba(0,0,0,0.05);">
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          ${maintList.map(item => `<div class="search-quick-tag" onclick="selectSearchTag('${item}', this)">${item}</div>`).join('')}
        </div>
      </div>

      <!-- 這裡就是全螢幕滑動區 -->
      <div id="fs-veh-search-results" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding-bottom:60px;">
        <div class="empty-tip">請輸入或點選上方標籤開始搜尋</div>
      </div>
    </div>
    <div style="height:200px;"></div>
  `;

  document.getElementById('sub-body').innerHTML = html;
  openOverlay('sub-page');

  // 如果原本就有帶入關鍵字，自動觸發一次全螢幕版的搜尋
  if (currentKw) {
    setTimeout(() => doVehSearch(true), 50);
  }
};

window.selectSearchTag = function(item, el) {
  // 1. 偵測目前是「全螢幕模式」還是「一般模式」
  const isFs = !!document.getElementById('fs-veh-search-kw');
  const inputId = isFs ? 'fs-veh-search-kw' : 'veh-search-kw';
  const input = document.getElementById(inputId);

  if (!input) return;

  // 2. 判斷是否已經選中 (切換狀態)
  const isAlreadyOn = el.classList.contains('on');

  // 3. 清除該標籤容器內所有標籤的選中狀態
  const parent = el.parentElement;
  parent.querySelectorAll('.search-quick-tag').forEach(tag => tag.classList.remove('on'));

  if (isAlreadyOn) {
    // 取消選中
    input.value = '';
  } else {
    // 選中並填入文字
    el.classList.add('on');
    input.value = item;
  }

  // 4. 執行搜尋：帶入正確的模式參數
  doVehSearch(isFs);
};
// 執行車輛保養記錄搜尋與渲染精美時間軸 (全連接線與標籤設計)
window.doVehSearch = function(isFullScreen = false) {
  const inputId = isFullScreen ? 'fs-veh-search-kw' : 'veh-search-kw';
  const resultId = isFullScreen ? 'fs-veh-search-results' : 'veh-search-results';

  const kwEl = document.getElementById(inputId);
  const resEl = document.getElementById(resultId);

  if (!kwEl || !resEl) return;

  const kw = kwEl.value.trim().toLowerCase();

  // 🌟 自動同步標籤的高亮狀態 (.on)
  // 找到輸入框附近的標籤容器 (通常是父層的下一個兄弟元素)
  const tagContainer = kwEl.closest('div').nextElementSibling; 
  if (tagContainer) {
    tagContainer.querySelectorAll('.search-quick-tag').forEach(tag => {
      if (kw === tag.textContent.trim().toLowerCase()) {
        tag.classList.add('on');
      } else {
        tag.classList.remove('on');
      }
    });
  }

  // 🌟 [修正點 2]：取得目前里程輸入框的值（如果你有新增這個欄位）
  const kmId = isFullScreen ? 'fs-veh-search-km' : 'veh-search-km';
  const kmEl = document.getElementById(kmId);
  const inputKm = pf(kmEl?.value || 0);

  if (!kw && inputKm <= 0) { 
    resEl.innerHTML = '<div class="empty-tip">請輸入或點選「上方標籤」開始搜尋</div>'; 
    return; 
  }
  
  // 過濾邏輯
  let recs = S.vehicleRecs.filter(r => {
    if (r.vehicleId !== S.selVehicleId || r.type !== 'maintenance') return false;

    // A. 里程優先
    if (inputKm > 0 && r.nextKm) {
      return inputKm >= (r.nextKm - 200); // 這裡改用你設定的預警邏輯
    }

    // B. 關鍵字搜尋
    const matchKw = (r.items && r.items.some(i => i.toLowerCase().includes(kw))) || 
                    (r.note && r.note.toLowerCase().includes(kw)) ||
                    (r.shop && r.shop.toLowerCase().includes(kw));
    return kw ? matchKw : false;
  });
  
  recs.sort((a,b) => b.date.localeCompare(a.date) || (b.time||'').localeCompare(a.time||''));

  if (!recs.length) {
    resEl.innerHTML = '<div class="empty-tip" style="color: #64748b; background:#ffffff; border:2px solid #e2e8f0; border-radius:16px; padding:24px;">找不到相符的保養記錄</div>';
    return;
  }

  // 渲染 HTML (保持你原本的時間軸樣式)
  let html = `
  <div style="background:#ffffff; border-radius:16px; padding:8px 16px; border:2px solid #e2e8f0;">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
      <div style="display:flex; align-items:center; letter-spacing:1px; gap:8px;">
        <span style="font-size:16px; font-weight:900; color: #475569;">搜尋</span>
        <span style="background:#3b82f6; color:#ffffff; padding:2px 14px; border-radius:8px; font-size:16px; font-weight:800;">${safeText(kw || inputKm + 'km')}</span>
      </div>
      <div style="font-size:15px; font-weight:800; color:#475569;">共 <span style="font-family:var(--mono); color: #f97316; font-size:20px; margin:0 2px;">${recs.length}</span> 筆</div>
    </div>
    <div style="border-bottom: 2.5px dashed #e2e8f0; margin-bottom: 6px;"></div>
    <div style="position:relative; padding-left:18px;">
      <div style="position:absolute; left:5px; top:12px; bottom:20px; width:2px; background: #e2e8f0; z-index:1;"></div>`;
      
  recs.forEach((r, idx) => {
    // ... 這裡是你原本 recs.forEach 內的所有繪製邏輯，請保留 ...
    // (包括 isLatest, isRepair, baseColor, diffHtml, matchedItems 等等)
    const isLatest = idx === 0;
    const isRepair = r.maintCategory === 'repair';
    let baseColor = isRepair ? '#3b82f6' : '#10b981';
    const boxBorder = isLatest ? baseColor : '#cbd5e1'; 
    const bottomBg = isLatest ? (isRepair ? '#eff6ff' : '#ebfcf0') : '#f8fafc'; 
    const capLeftBg = isLatest ? (isRepair ? '#2563eb' : '#059669') : '#475569'; 
    const capRightBg = isLatest ? (isRepair ? '#dbeafe' : '#beffde') : '#f1f5f9'; 
    const capRightText = isLatest ? (isRepair ? '#1d4ed8' : '#059669') : '#334155';
    
    let diffHtml = '';
    if (idx < recs.length - 1) {
      const olderRec = recs[idx + 1];
      const kmDiff = pf(r.km) - pf(olderRec.km);
      const daysDiff = Math.round((new Date(r.date) - new Date(olderRec.date)) / 86400000);
      diffHtml = `<div style="display:flex; flex-direction:column; align-items:center; position:relative; z-index:2;"><div style="width:2px; height:8px; background: ${baseColor};"></div><div style="background:#ffffff; border:1.5px solid #cbd5e1; border-radius:8px; display:inline-flex; align-items:stretch; overflow:hidden; box-shadow:0 2px 4px rgba(0,0,0,0.02);"><div style="padding:1px 10px; display:flex; align-items:center;"><span style="font-size:13px; font-weight:900; color:#3b82f6;">間隔</span></div><div style="width:2px; background:#e2e8f0;"></div><div style="padding:1px 10px; display:flex; align-items:baseline; gap:3px;"><span style="font-size:15px; font-family:var(--mono); font-weight:900; color: #10b981;">${fmt(kmDiff)}</span><span style="font-size:11px; font-weight:900; color: #475569;">km</span></div><div style="width:2px; background:#e2e8f0;"></div><div style="padding:1px 10px; display:flex; align-items:baseline; gap:3px;"><span style="font-size:15px; font-family:var(--mono); font-weight:900; color: #ea580c;">${daysDiff}</span><span style="font-size:11px; font-weight:900; color: #475569;">天</span></div></div><div style="width:2px; height:4px; background: #cbd5e1;"></div></div>`;
    }

    let matchedItems = (r.items || []).filter(i => i.toLowerCase().includes(kw));
    if (matchedItems.length === 0 && r.items && r.items.length > 0) matchedItems = [r.items[0]];
    const itemText = matchedItems.length > 0 ? safeText(matchedItems.join('、')) : '未填寫';

    html += `
      <div style="position:relative; z-index:2; margin-bottom:${diffHtml ? '0' : '10px'};">
        <div style="position:absolute; left:-18px; top:12px; width:14px; height:14px; border-radius:50%; background:${boxBorder}; border:2px solid #ffffff; box-shadow:0 0 0 1px ${boxBorder};"></div>
        <div onclick="openAddVehRec('${safeText(r.id)}')" style="border:2.5px solid ${boxBorder}; border-radius:12px; overflow:hidden; cursor:pointer; box-shadow:0 4px 8px rgba(0,0,0,0.03); transition:transform 0.1s;">
          <div style="background: rgb(236, 241, 244); padding:8px 12px; display:flex; align-items:center; border-bottom:2.5px solid #cbd5e1;">
            <div style="flex:1; text-align:left; font-family:var(--mono); font-size:14px; font-weight:900; color: #334155;letter-spacing:0.5px;">${fmtDateDisp(r.date)}</div>
            <div style="flex:1; text-align:center; font-family:var(--mono); font-size:18px; font-weight:900; color: #2a69fc;">${fmt(r.km)}<span style="font-size:11px; color: #282a2d; margin-left:2px;"> km</span></div>
            <div style="flex:1; text-align:right; height:18px;">${isLatest && !kw ? `<span style="background: #10b981; color:#ffffff; padding:2px 8px; border-radius:6px; font-size:14px; font-weight:750; letter-spacing:1px;">最新</span>` : ''}</div>
          </div>
          <div style="background:${bottomBg}; padding:7px 12px; display:flex; justify-content:flex-start;">
            <div style="display:inline-flex; border-radius:6px; overflow:hidden; box-shadow:0 2px 4px rgba(0,0,0,0.06);">
              <span style="background:${capLeftBg}; color: #ffffff; font-size:14px; font-weight:750; padding:4px 12px; letter-spacing:0.5px;">${itemText}</span>
              ${r.shop ? `<span style="background:${capRightBg}; color:${capRightText}; font-size:13px; font-weight:800; padding:4px 12px; display:flex; align-items:center; border:1.5px solid ${capLeftBg}; border-radius:0px 6px 6px 0px;">${safeText(r.shop)}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
      ${diffHtml}`;
  });

  html += `</div></div>`;
  resEl.innerHTML = html;
}

// 顯示車輛詳細資訊彈窗 (全新美化版：背景裝飾圈變身編輯按鈕)
window.openVehInfo = function(id) {
  const v = S.vehicles.find(x => x.id === id);
  if(!v) return;
  
  document.getElementById('sub-title').textContent = '車輛詳細資訊';
  
  // 1. 清空右上角，將編輯按鈕移入卡片內
  document.getElementById('sub-top-right').innerHTML = '';
  
  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px;">
      <!-- 頂部精美名片卡 (overflow:hidden 會把超出的圓圈切成扇形) -->
      <div style="background:linear-gradient(135deg, var(--sf), var(--sf2)); border:1px solid var(--border); border-radius:24px; padding:24px 16px; text-align:center; margin-bottom:20px; position:relative; overflow:hidden;">
        
        <!-- 👇 裝飾背景圈 (升級為扇形編輯按鈕) -->
        <div onclick="openEditVehicle('${id}')" style="position:absolute; top:-25px; right:-25px; width:110px; height:110px; background:var(--blue-d); border-radius:50%; z-index:2; display:flex; align-items:flex-end; justify-content:flex-start; padding: 0 0 28px 24px; cursor:pointer; box-shadow:inset 0 0 15px rgba(37,99,235,0.15); border:1.5px solid #bfdbfe; transition:0.2s;">
          <span style="color:var(--text-blue); font-size:14px; font-weight:800; display:flex; align-items:center;margin: 0px 0px 18px -3px;"><span style="font-size:20px;">✎&nbsp;</span>編輯</span>
        </div>
        
        <div style="width:84px; height:84px; border-radius:24px; background:#fff; border:2px solid var(--acc); margin:0 auto 16px; display:flex; align-items:center; justify-content:center; position:relative; z-index:1;">
          <img src="scooter/s${v.icon || 1}.png" style="width:64px; height:64px; object-fit:contain;">
        </div>
        <h2 style="font-size:22px; font-weight:900; color:var(--t1); margin:0 0 8px 0; position:relative; z-index:1; line-height:1.3;">${safeText(v.name)}</h2>
        <div style="position:relative; z-index:1;">
          <span style="font-size:13px; font-weight:800; color:var(--blue); background:#eff6ff; border:1px solid #bfdbfe; padding:4px 12px; border-radius:12px; display:inline-block;">
            ${safeText(v.defaultFuel === 'electric' ? '🔋 電動車 (電池)' : '⛽ ' + v.defaultFuel + ' 無鉛汽油')}
          </span>
        </div>
      </div>

      <!-- 列表資訊 -->
      <h3 style="font-size:14px; color:var(--hint-color); margin-bottom:10px; font-weight:750; padding-left:4px;">📋 詳細資料</h3>
      
      <!-- 白色大框，利用 background 與 gap 創造加深的水平分隔線，border 顏色對應加深 -->
      <div style="background:#ffffff; border-radius:16px; border:1px solid #cbd5e1; overflow:hidden; margin-bottom:16px;">
        <div style="display:flex; flex-direction:column; gap:1px; background: #cbd5e1;">
          
          <!-- 1. 車牌號碼 -->
          <div style="display:grid; grid-template-columns: 1fr 0.7px 1.6fr; background:#ffffff;">
            <div style="padding:14px 16px; display:flex; align-items:center; justify-content:flex-start; background: rgba(37, 100, 235, 0.1);">
              <span style="font-size:12px;">🏷️</span>&nbsp;
              <span style="font-size:14px; font-weight:650; color: #101010;">車牌號碼</span>
            </div>
            <div style="background:#cbd5e1;"></div>
            <div style="padding:1px 16px; display:flex; align-items:center; justify-content:flex-start;">
              <span style="font-family:var(--mono); font-size:18px; font-weight:800; color:#2563eb; letter-spacing:1px;">
                ${safeText(v.plate || '未設定')}
              </span>
            </div>
          </div>

          <!-- 2. 排氣量 -->
          <div style="display:grid; grid-template-columns: 1fr 0.7px 1.6fr; background:#ffffff;">
            <div style="padding:14px 16px; display:flex; align-items:center; justify-content:flex-start; background: rgba(234, 90, 12, 0.1);">
              <span style="font-size:12px;">${v.defaultFuel === 'electric' ? '⚡' : '💨'}</span>&nbsp;
              <span style="font-size:14px; font-weight:650; color: #101010;">${v.defaultFuel === 'electric' ? '最大功率' : '排氣量'}</span>
            </div>
            <div style="background: #cbd5e1;"></div>
            <div style="padding:1px 16px; display:flex; align-items:center; justify-content:flex-start;">
              <span style="font-family:var(--mono); font-size:18px; font-weight:800; color:#ea580c; letter-spacing:1px;">
                ${v.cc ? `${safeText(v.cc)} <span style="color:#000000; font-size:14px; font-weight:750; margin-left:2px;">${v.defaultFuel === 'electric' ? 'kW' : 'cc'}</span>` : '未設定'}
              </span>
            </div>
          </div>

          <!-- 3. 車輛顏色 -->
          <div style="display:grid; grid-template-columns: 1fr 0.7px 1.6fr; background:#ffffff;">
            <div style="padding:14px 16px; display:flex; align-items:center; justify-content:flex-start; background: rgba(146, 51, 234, 0.1);">
              <span style="font-size:12px;">🎨</span>&nbsp;
              <span style="font-size:14px; font-weight:650; color: #101010;">車輛顏色</span>
            </div>
            <div style="background:#cbd5e1;"></div>
            <div style="padding:1px 16px; display:flex; align-items:center; justify-content:flex-start;">
              <span style="font-size:18px; font-weight:700; color:#9333ea; letter-spacing:1px;">
                ${safeText(v.color || '未設定')}
              </span>
            </div>
          </div>

          <!-- 4. 出廠年月 -->
          <div style="display:grid; grid-template-columns: 1fr 0.7px 1.6fr; background:#ffffff;">
            <div style="padding:14px 16px; display:flex; align-items:center; justify-content:flex-start; background: rgba(5, 150, 104, 0.1);">
              <span style="font-size:12px;">📅</span>&nbsp;
              <span style="font-size:14px; font-weight:650; color: #101010;">出廠年月</span>
            </div>
            <div style="background:#cbd5e1;"></div>
            <div style="padding:1px 16px; display:flex; align-items:center; justify-content:flex-start;">
              <span style="font-family:var(--mono); font-size:18px; font-weight:800; color:#059669; letter-spacing:1px;">
                ${v.year ? safeText(v.year).replace('-', ' <span style="color:#000;font-size:15px;">年</span> ') + ' <span style="color:#000;font-size:15px;">月</span>' : '未設定'}
              </span>
            </div>
          </div>

        </div>
      </div>
    </div>
  `;
  openOverlay('sub-page');
}

// 開啟車輛編輯表單 (直接沿用新增車輛的介面)
window.openEditVehicle = function(id) {
  const v = S.vehicles.find(x => x.id === id);
  if(!v) return;
  
  S.newVehIcon = v.icon || 1; 
  const container = document.getElementById('vehicle-add-body');
  let iconsHtml = '';
  for (let i = 1; i <= 9; i++) {
    const isSel = S.newVehIcon === i;
    iconsHtml += `<img src="scooter/s${i}.png" id="veh-opt-${i}" onclick="selectNewVehIcon(${i})" style="width:70px; height:70px; object-fit:contain; border:2px solid ${isSel ? 'var(--acc)' : 'transparent'}; border-radius:12px; cursor:pointer; transition:transform 0.2s; transform:${isSel ? 'scale(1.05)' : 'scale(1)'}; flex-shrink:0; background:var(--sf); padding:4px;">`;
  }
  
  container.innerHTML = `
    <div style="padding:16px;">
      <div class="fg" style="margin-bottom:16px">
        <label style="font-weight:700; color:var(--t1);">車輛名稱 <span style="color:red">*</span></label>
        <input type="text" class="finp" id="v-name" value="${safeText(v.name)}" placeholder="例如：我的愛車 Gogoro">
      </div>
      
      <div class="fg" style="margin-bottom:20px;">
        <label style="font-weight:700; color:var(--t1);">滑動選擇機車圖示</label>
        <div style="display:flex; overflow-x:auto; gap:12px; background:var(--bg-input); padding:16px; border-radius:16px; align-items:center;">
          ${iconsHtml}
        </div>
      </div>

      <div class="fg" style="margin-bottom:20px">
        <label style="font-weight:700; color:var(--t1);">預設燃料 <span style="color:red">*</span></label>
        <select class="fsel" id="v-fuel" onchange="toggleFuelTypeUI()">
          <option value="92" ${v.defaultFuel==='92'?'selected':''}>92 無鉛汽油</option>
          <option value="95" ${v.defaultFuel==='95'?'selected':''}>95 無鉛汽油</option>
          <option value="98" ${v.defaultFuel==='98'?'selected':''}>98 無鉛汽油</option>
          <option value="electric" ${v.defaultFuel==='electric'?'selected':''}>電動車 (電池)</option>
        </select>
      </div>
      
      <h3 style="font-size:13px; color:var(--hint-color); margin-bottom:12px; border-bottom:1px dashed var(--border); padding-bottom:8px;">📝 進階車輛資訊 (選填)</h3>
      
      <div class="fg" style="margin-bottom:16px">
        <label style="font-weight:700; color:var(--t1);">車牌號碼</label>
        <input type="text" class="finp" id="v-plate" value="${safeText(v.plate||'')}" placeholder="例如：ABC-1234">
      </div>

      <div style="display:flex; gap:10px; margin-bottom:16px;">
        <div class="fg" style="flex:1;">
          <label id="lbl-v-cc" style="font-weight:700; color:var(--t1);">排氣量 (cc)</label>
          <input type="number" class="finp" id="v-cc" value="${safeText(v.cc||'')}" placeholder="例如：125" step="0.1">
        </div>
        <div class="fg" style="flex:1;">
          <label style="font-weight:700; color:var(--t1);">車輛顏色</label>
          <input type="text" class="finp" id="v-color" value="${safeText(v.color||'')}" placeholder="例如：消光黑">
        </div>
      </div>

      <div class="fg" style="margin-bottom:24px">
        <label style="font-weight:700; color:var(--t1);">出廠年月</label>
        <input type="month" class="finp" id="v-year" value="${v.year||''}">
      </div>

      <div style="display:flex;gap:10px;">
        <button onclick="closeOverlay('vehicle-add-page')" style="flex:1;padding:14px;border-radius:var(--rs);background:var(--sf2);border:1px solid var(--border);color:var(--t2);font-weight:700;cursor:pointer;">取消</button>
        <button onclick="saveEditVehicle('${id}')" class="btn-acc" style="flex:2;padding:14px;font-weight:800;border-radius:var(--rs);box-shadow:0 4px 12px rgba(255,107,53,0.3);">💾 儲存修改</button>
      </div>
    </div>`;
    
  document.getElementById('vehicle-add-page').querySelector('h2').textContent = '編輯車輛';
  openOverlay('vehicle-add-page');
  setTimeout(() => toggleFuelTypeUI(), 10); // 載入時觸發一次判斷
}

// 動態切換排氣量與最大功率的顯示
window.toggleFuelTypeUI = function() {
  const fuel = document.getElementById('v-fuel')?.value;
  const ccLabel = document.getElementById('lbl-v-cc');
  const ccInput = document.getElementById('v-cc');
  if (!ccLabel || !ccInput) return;
  
  if (fuel === 'electric') {
    ccLabel.innerText = '最大功率 (kW)';
    ccInput.placeholder = '例如：7.2';
  } else {
    ccLabel.innerText = '排氣量 (cc)';
    ccInput.placeholder = '例如：125';
  }
}

// 儲存車輛修改邏輯
window.saveEditVehicle = function(id) {
  const v = S.vehicles.find(x => x.id === id);
  if(!v) return;

  const name = document.getElementById('v-name').value.trim(); 
  if (!name) { toast('請輸入「車輛名稱」'); return; } 
  
  v.name = name;
  v.icon = S.newVehIcon;
  v.defaultFuel = document.getElementById('v-fuel').value;
  v.plate = document.getElementById('v-plate').value.trim();
  v.cc = document.getElementById('v-cc').value.trim();
  v.color = document.getElementById('v-color').value.trim();
  v.year = document.getElementById('v-year').value;

  saveVehicles(); 
  closeOverlay('vehicle-add-page'); 
  toast('車輛資訊，已更新 ✅'); 
  
  // 重新渲染底層介面並刷新詳細資訊彈窗
  renderVehicles(); 
  openVehInfo(id); 
}
/* ══ 6. 車輛管理 結束 ══════════════════════════════════════════ */


/* ══ 7. 設定管理與啟動 ═══════════════════════════════════ */
/* ══ 3. 修改 renderSettings (新增註冊新帳號選單) ══ */
function renderSettings() {
  const isLogged = USER.loggedIn;
  const accStr = isLogged ? `👤 帳號：${USER.email}` : `✉️ 帳號登入`;
  
  // 建立帳號選單列表 HTML
  let accListHtml = `
    <div class="set-row" onclick="${isLogged ? 'openAccountStats()' : 'openAuthModal()'}">
      <span class="sn" style="font-weight:700; color:var(--acc);">${accStr}</span>
      <span class="arr">›</span>
    </div>
  `;

  // 👈 未登入且允許註冊時，新增「註冊新帳號」獨立選項
  if (!isLogged && GLOBAL_ALLOW_REGISTRATION) {
    accListHtml += `
      <div class="set-row" onclick="openRegisterModal()" style="border-top:1px dashed var(--border);">
        <span class="sn" style="font-weight:700; color:#2563eb;">📝 註冊新帳號</span>
        <span class="arr" style="color:#2563eb;">›</span>
      </div>
    `;
  }

  const lastBackupStr = S.settings.lastLocalBackup 
    ? `<div style="display:inline-flex; align-items:center; border-radius:8px; border:2px solid #bfdbfe; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.02); margin-left:auto; flex-shrink:0;">
         <span style="padding:3px 6px; background:#eff6ff; font-size:12px; font-weight:800; color: #2563eb; border-right:1.5px solid #bfdbfe;">上次存檔</span>
         <span style="padding:3px 6px; background:#ffffff; font-size:12px; font-weight:800; color: #4775f3; font-family:var(--mono);">${S.settings.lastLocalBackup}</span>
       </div>` 
    : `<div style="display:inline-flex; align-items:center; border-radius:8px; border:2px solid #fecdd3; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.02); margin-left:auto; flex-shrink:0;">
         <span style="padding:3px 6px; background:#fff1f2; font-size:12px; font-weight:800; color: #e11d48; border-right:1.5px solid #fecdd3;">尚未存檔</span>
         <span style="padding:3px 6px; background:#ffffff; font-size:12px; font-weight:700; color: #f63a69;">🆘 建議在「雲端硬碟」備份</span>
       </div>`;

  const html = `
  <div class="set-sec" style="margin-bottom:5px;">
    <h3>帳號登入狀態</h3>
    <div class="set-list">
      ${accListHtml}
    </div>
  </div>

  <div class="set-sec" style="margin-bottom:12px;"><h3>功能設定</h3><div class="set-list">
    <div class="set-row" onclick="openPlatformList()" style="background:#eff6ff;border:2.5px solid #dbeafe;padding:17px 15px;border-radius:14px 14px 0 0;margin-bottom:0.5px;">
        <span class="sn" style="color:#1e40af;">🏪 平台列表與設定</span><span class="arr" style="color:#1e40af;">›</span>
    </div>
    <div class="set-row" onclick="openGoalSettings()" style="background:#ecfdf5;border:2.5px solid #d1fae5;padding:17px 15px;margin-bottom:0.5px;">
        <span class="sn" style="color:#065f46;">🎯 收入目標設定</span><span class="arr" style="color:#065f46;">›</span>
    </div>
    <div class="set-row" onclick="openRewardSettings()" style="background:#f5f3ff;border:2.5px solid #ede9fe;padding:17px 15px;margin-bottom:0.5px;">
        <span class="sn" style="color:#5b21b6;">🎁 獎勵項目設定</span><span class="arr" style="color:#5b21b6;">›</span>
    </div>
    <div class="set-row" onclick="openReminderSettings()" style="background:#fff1f2;border:2.5px solid #ffe4e6;padding:17px 15px;margin-bottom:0.5px;">
        <span class="sn" style="color:#9f1239;">⏰ 每日記錄通知提醒</span><span class="arr" style="color:#9f1239;">›</span>
    </div>
    <div class="set-row" onclick="openWageSettings()" style="background:#f0fdfa;border:2.5px solid #ccfbf1;padding:17px 15px;margin-bottom:0.5px;">
        <span class="sn" style="color:#0f766e;">⚖️ 基本工資分析設定</span><span class="arr" style="color:#0f766e;">›</span>
    </div>
    <div class="set-row" onclick="openOCRSettings()" style="background:#fff7ed;border:2.5px solid #ffedd5;padding:17px 15px;border-radius:0 0 14px 14px;">
        <span class="sn" style="color:#9a3412;">📸 辨識功能 (OCR) 設定</span>
        <div style="display:flex; align-items:center; gap:5px;">
          <span style="font-size:13px; color:${S.settings.ocrKey ? 'var(--green)' : 'var(--red)'}; font-weight:750;margin-right:10px;">${S.settings.ocrKey ? '● 已啟用' : '● 未設定'}</span>
          <span class="arr" style="color:#9a3412;">›</span>
        </div>
    </div>
  </div></div>

  <div class="set-sec" style="margin-bottom:8px;"><h3>資料管理與備份</h3><div class="set-list">
      <div class="set-row" onclick="confirmBackupToFile()" style="padding:8px 16px 4px;"><span class="sn">📂 儲存到「本機」或「雲端硬碟」(.json) ${lastBackupStr}</span><span class="arr">↓</span></div>
      <div class="set-row" onclick="doRestore()"><span class="sn">📤 從本機還原「備份檔」</span><span class="arr">↑</span></div>
      <div class="set-row" onclick="openExportModal()"><span class="sn">📊 匯出 Excel、試算表 (.xlsx)</span><span class="arr">↓</span></div>
      <div class="set-row" onclick="doClearData()"><span class="sn" style="color:var(--red)">🗑 清除所有資料</span><span class="arr" style="color:var(--red)">!</span></div>
      <div class="set-row" onclick="doReset()"><span class="sn" style="color:var(--red); font-weight:700;">⚠️ 重置設定和資料</span><span class="arr" style="color:var(--red)">!</span></div>
  </div></div>
  
  <div style="margin:20px 0 150px 0; padding-bottom:8px; text-align:center;">
      <span onclick="openOverlay('about-page')" style="font-size:15px; color:var(--text-blue); font-weight:800; cursor:pointer; padding:6px 16px; display:inline-block;">關於我們</span>
  </div>`;
  
  document.getElementById('settings-content').innerHTML = html;
}

window.openOCRSettings = function() {
  document.getElementById('sub-title').textContent = '辨識功能設定';
  document.getElementById('sub-top-right').innerHTML = '';
  
  const currentKey = S.settings.ocrKey || '';

  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px; padding-bottom:32px;">
      <div style="background:#fff7ed; border:2px solid #fed7aa; border-radius:16px; padding:16px; margin-bottom:20px; box-shadow:0 4px 12px rgba(0,0,0,0.02);">
        <div style="display:flex; align-items:center; gap:8px; color:#ea580c; font-weight:900; font-size:16px; margin-bottom:12px;">
          <span>📸</span> 智慧里程辨識 (OCR)
        </div>
        <p style="font-size:13px; color:#9a3412; line-height:1.6; font-weight:600;">
          本功能使用外部 AI 辨識技術。為了確保服務穩定且不產生額外費用，請使用者自行申請免費的 <b>OCR.space API Key</b>。
        </p>
      </div>

      <div class="card" style="padding:16px; border:1.5px solid #e2e8f0;">
        <div class="fg" style="margin-bottom:16px;">
          <label style="font-weight:800; color:var(--t1);">您的 OCR API Key</label>
          <input type="text" id="ocr-key-input" class="finp" value="${currentKey}" placeholder="請貼上您的 API Key" style="font-family:var(--mono); border-color:#fb923c;">
        </div>
        
        <div style="background:var(--sf2); padding:12px; border-radius:12px; border:1px dashed #cbd5e1;">
          <div style="font-size:12px; font-weight:800; color:var(--t2); margin-bottom:8px;">如何取得 Key？</div>
          <ol style="font-size:12px; color:var(--t3); padding-left:18px; line-height:1.8; font-weight:600;">
            <li>點擊下方連結前往 OCR.space 官網</li>
            <li>輸入您的 Email 並勾選免費方案</li>
            <li>至信箱收信，複製產生的 API Key 並貼回此處</li>
          </ol>
          <a href="https://ocr.space/ocrapi" target="_blank" style="display:inline-block; margin-top:10px; color:var(--text-blue); font-weight:800; text-decoration:none;">🌐 前往申請免費 Key (官網) ➔</a>
        </div>
      </div>

      <button onclick="saveOCRSettings()" class="btn-acc" style="width:100%; padding:16px; font-size:16px; font-weight:900; border-radius:16px; background:#ea580c; box-shadow:0 8px 24px rgba(234,88,12,0.3); margin-top:24px;">
        💾 儲存設定
      </button>
    </div>
  `;
  openOverlay('sub-page');
};
window.saveOCRSettings = function() {
  const key = document.getElementById('ocr-key-input').value.trim();
  S.settings.ocrKey = key;
  saveSettings();
  toast(key ? '辨識功能，已啟用 ✅' : '⚠️ 已停用「辨識功能」');
  closeOverlay('sub-page');
  renderSettings();
};

/* ✨ 重新設計：每日記錄提醒彈窗 */
function openReminderSettings() {
  document.getElementById('sub-title').textContent = '每日記錄提醒';
  document.getElementById('sub-top-right').innerHTML = '';
  const r = S.settings.reminder || { enabled: false, time: '22:00' };

  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px; padding-bottom:32px;">
      
      <!-- 頂部大型時鐘視覺 -->
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; background:var(--bg-input); border-radius:24px; padding:32px 16px; margin-bottom:24px; border:2px dashed #cbd5e1; position:relative;">
        <div style="font-size:48px; margin-bottom:12px; filter:drop-shadow(0 4px 8px rgba(0,0,0,0.1));">⏰</div>
        <div style="font-size:16px; font-weight:900; color:var(--t1); margin-bottom:14px;">不要錯過任何一筆收入！</div>
        <div style="font-size:12px; color:var(--text-blue); font-weight:600; text-align:center; line-height:1.6; max-width:300px;">
          設定專屬的提醒時間，系統會自動發送推播與音效通知，提醒您結算今天的辛勞。
        </div>
      </div>

      <!-- 控制面板 -->
      <div style="background:#ffffff; border:2px solid ${r.enabled ? '#10b981' : '#e2e8f0'}; border-radius:20px; padding:20px 16px; box-shadow:0 8px 24px rgba(0,0,0,0.03); transition:0.3s;" id="rem-panel-box">
        
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="width:10px; height:10px; border-radius:50%; background:${r.enabled ? '#10b981' : '#94a3b8'}; box-shadow:0 0 8px ${r.enabled ? '#10b981' : 'transparent'}; transition:0.3s;" id="rem-status-dot"></div>
            <span style="font-size:16px; font-weight:900; color:var(--t1);">🔔 開啟每日推播提醒</span>
          </div>
          <label class="switch">
            <input type="checkbox" id="rem-enabled" ${r.enabled ? 'checked' : ''} onchange="toggleReminderUI(this)">
            <span class="slider"></span>
          </label>
        </div>
        
        <div style="border-top:1px dashed var(--border); margin-bottom:16px;"></div>
        
        <div style="display:flex; flex-direction:column; gap:8px; opacity:${r.enabled ? '1' : '0.4'}; pointer-events:${r.enabled ? 'auto' : 'none'}; transition:0.3s;" id="rem-time-group">
          <label style="font-size:12px; font-weight:800; color:var(--t2); letter-spacing:0.5px;">選擇推播發送時間</label>
          <div style="position:relative;">
            <input type="time" id="rem-time" value="${r.time}" style="width:350px; padding:14px 16px; background:var(--sf2); border:1.5px solid var(--border); border-radius:12px; font-family:var(--mono); font-size:22px; font-weight:900; color:#2563eb; outline:none; text-align:center; transition:0.2s;">
          </div>
        </div>
        
      </div>
      
      <button onclick="saveReminderSettings()" class="btn-acc" style="width:100%; padding:16px; font-size:16px; font-weight:900; border-radius:16px; box-shadow:0 8px 24px rgba(255,107,53,0.3); margin-top:24px;">
        💾 儲存提醒設定
      </button>
    </div>
  `;
  openOverlay('sub-page');
}

// 👇 處理切換開關時的即時視覺連動 (邊框變色、區塊淡化)
window.toggleReminderUI = function(checkbox) {
  const panel = document.getElementById('rem-panel-box');
  const dot = document.getElementById('rem-status-dot');
  const group = document.getElementById('rem-time-group');
  
  if (checkbox.checked) {
    panel.style.borderColor = '#10b981';
    dot.style.background = '#10b981';
    dot.style.boxShadow = '0 0 8px #10b981';
    group.style.opacity = '1';
    group.style.pointerEvents = 'auto';
    requestNotificationPermission(checkbox); // 觸發權限要求
  } else {
    panel.style.borderColor = '#e2e8f0';
    dot.style.background = '#94a3b8';
    dot.style.boxShadow = 'none';
    group.style.opacity = '0.4';
    group.style.pointerEvents = 'none';
  }
}

// 請求瀏覽器通知權限
function requestNotificationPermission(checkbox) {
  if (checkbox.checked && "Notification" in window) {
    if (Notification.permission !== "granted") {
      Notification.requestPermission().then(permission => {
        if (permission !== "granted") {
          checkbox.checked = false;
          toast('⚠️ 請允許「系統通知」，才能使用「提醒功能」');
        }
      });
    }
  }
}

function saveReminderSettings() {
  if (!S.settings.reminder) S.settings.reminder = {};
  S.settings.reminder.enabled = document.getElementById('rem-enabled').checked;
  S.settings.reminder.time = document.getElementById('rem-time').value || '22:00';
  saveSettings();
  toast('提醒設定，已儲存 ✅');
  closeOverlay('sub-page');
}

/* ✨ 新增：初始化背景時間檢查機制 (包含聲音提醒) */
function initReminderCheck() {
  setInterval(() => {
    const r = S.settings.reminder;
    if (!r || !r.enabled) return;
    
    const now = new Date();
    const curTime = pad(now.getHours()) + ':' + pad(now.getMinutes());
    const todayStrDate = todayStr(now);
    
    if (curTime === r.time && r.lastSent !== todayStrDate) {
      r.lastSent = todayStrDate;
      saveSettings();
      
      const title = "🛵 記錄提醒";
      const body = "今天跑單辛苦了！別忘了記錄今天的收入與工時喔！";

      // 🔊 1. 播放提示音效 (使用瀏覽器內建震盪器發出兩聲清脆的「嗶嗶」聲)
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const playBeep = (time, freq) => {
          const osc = audioCtx.createOscillator();
          const gainNode = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, audioCtx.currentTime + time);
          gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime + time);
          gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + time + 0.5);
          osc.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          osc.start(audioCtx.currentTime + time);
          osc.stop(audioCtx.currentTime + time + 0.5);
        };
        playBeep(0, 800);   // 第一聲
        playBeep(0.15, 1200); // 第二聲高音
      } catch(e) { console.log('音效播放被瀏覽器阻擋'); }
      
      // 📱 2. 發送橫幅通知
      if ("Notification" in window && Notification.permission === "granted") {
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistration().then(function(reg) {
            if (reg && reg.active) {
              reg.showNotification(title, { body: body, icon: 'images/scooter1.png', vibrate: [200, 100, 200] });
            } else {
              new Notification(title, { body: body, icon: 'images/scooter1.png' });
            }
          }).catch(() => { new Notification(title, { body: body, icon: 'images/scooter1.png' }); });
        } else {
          new Notification(title, { body: body, icon: 'images/scooter1.png' });
        }
      } else {
        toast(`🔔 ${title}：${body}`, 5000);
      }
    }
  }, 60000);
}

/* ══ 替換：登入系統拆分雙頁籤與頭像綁定 ══ */
let authMode = 'login'; // 'login' 或 'register'
let selectedAvatar = 'figure/fig1.webp'; 
let privacyAgreed = false; // 👈 新增：隱私權同意狀態

window.selectAvatar = function(src, el) {
    selectedAvatar = src;
    document.querySelectorAll('.avatar-opt').forEach(img => {
      img.style.borderColor = 'transparent';
      img.style.transform = 'scale(1)';
    });
    el.style.borderColor = 'var(--acc)';
    el.style.transform = 'scale(1.05)';
}


// 輔助：自動取得目前的帳號畫面容器 (固定頁面優先)
function getAuthContainer() {
  return document.getElementById('auth-page-content') || document.getElementById('sub-body');
}

// 離開登入頁面時專用：解鎖狀態並強制回到設定頁
window.closeAuthPage = function() {
  window.__authFlowLocked = false;
  window.__authTurnstileActive = false;
  localStorage.removeItem('auth_flow_active');
  localStorage.removeItem('auth_last_active');
  localStorage.removeItem('auth_origin_tab');
  goPage('settings', true); 
};

// 頁面分頁切換
window.switchAuthTab = function(mode) {
  if (mode === 'register') {
    openRegisterModal();
  } else {
    openAuthModal();
  }
};

/* ══ 1. 導覽列與右上角按鈕控制 ══ */
function updateAuthTopRight(show = true) {
  const topRight = document.getElementById('auth-top-right') || document.getElementById('sub-top-right');
  if (topRight) {
    if (show) {
      // 註冊、忘記密碼、重設密碼時：顯示「🔙 返回登入」
      topRight.innerHTML = `
        <button onclick="openAuthModal()" style="background:linear-gradient(135deg, #3b82f6, #2563eb); color:#ffffff; border:1px solid #1d4ed8; padding:6px 14px; border-radius:20px; font-size:12px; font-weight:900; cursor:pointer; box-shadow:0 2px 6px rgba(37,99,235,0.3); transition:0.2s;">
          🔙 返回登入
        </button>
      `;
    } else {
      // 👈 登入頁面：隱藏/清空右上角按鈕
      topRight.innerHTML = '';
    }
  }
}

/* ══ 離開登入/註冊頁面專用：解鎖狀態並返回設定頁 ══ */
window.closeAuthPage = function() {
  // 1. 解除帳號流程鎖定
  window.__authFlowLocked = false;
  window.__authTurnstileActive = false;

  // 2. 清除登入中暫存標記
  localStorage.removeItem('auth_flow_active');
  localStorage.removeItem('auth_last_active');

  // 3. 取得來源頁面（若無則預設回到設定頁 'settings'）
  let targetTab = localStorage.getItem('auth_origin_tab') || 'settings';
  if (targetTab === 'auth') targetTab = 'settings'; // 防呆：避免循環跳回登入頁
  localStorage.removeItem('auth_origin_tab');

  // 4. 強制切換回目標頁面（帶入 true 穿透攔截）
  goPage(targetTab, true);
};

/* 2. 帳號登入頁面 (隱藏右上角按鈕) */
function openAuthModal() {
  authMode = 'login';
  window.__authFlowLocked = true;
  window.__authTurnstileActive = true;
  
  localStorage.setItem('auth_flow_active', 'true'); 
  localStorage.setItem('auth_last_active', Date.now().toString()); 
  
  let origin = S.tab || 'settings';
  if (origin === 'auth') origin = 'settings';
  window.__authFlowOriginTab = origin;
  localStorage.setItem('auth_origin_tab', origin);
  
  const titleEl = document.getElementById('auth-page-title');
  if (titleEl) titleEl.textContent = '帳號登入';

  updateAuthTopRight(false); // 👈 傳入 false，登入頁隱藏「🔙 返回登入」按鈕！
  renderAuthContent();
  goPage('auth', true);
}

/* 2. 註冊新帳號頁面 */
window.openRegisterModal = function() {
  if (!GLOBAL_ALLOW_REGISTRATION) {
    toast('⚠️ 系統目前暫停開放註冊');
    return;
  }
  
  authMode = 'register';
  window.__authFlowLocked = true;
  window.__authTurnstileActive = true;
  
  localStorage.setItem('auth_flow_active', 'true'); 
  localStorage.setItem('auth_last_active', Date.now().toString()); 

  const titleEl = document.getElementById('auth-page-title');
  if (titleEl) titleEl.textContent = '註冊帳號';

  updateAuthTopRight(); // 👈 注入右上角按鈕
  renderAuthContent();
  goPage('auth', true);
};

/* ══ 2. 強化版人機驗證 (Turnstile) 渲染（修復 3 秒延遲與沒出現的問題） ══ */
function renderTurnstileWidget() {
  const widget = document.getElementById('turnstile-widget');
  if (!widget) return;

  // 1. 顯示載入緩衝提示
  widget.innerHTML = `
    <div style="font-size:12px; color:var(--t3); text-align:center; padding:10px; font-weight:700; background:#f8fafc; border-radius:10px; border:1px solid #e2e8f0;">
      🛡️ 安全驗證載入中...
    </div>`;

  // 💡 關鍵修復：每次重新渲染前，先強制清除舊的 Widget，避免被誤判跳過
  if (window.turnstile && window.turnstileWidgetId !== null) {
    try { window.turnstile.remove(window.turnstileWidgetId); } catch(e){}
    window.turnstileWidgetId = null;
  }

  let attempts = 0;

  const checkAndRender = () => {
    const currentWidget = document.getElementById('turnstile-widget');
    if (!currentWidget) return; 

    if (window.turnstile) {
      try {
        currentWidget.innerHTML = ''; 

        // 渲染驗證元件並綁定 Callback
        window.turnstileWidgetId = window.turnstile.render('#turnstile-widget', {
          sitekey: '0x4AAAAAADC958xr-t5UGd36',
          theme: 'light',
          appearance: 'always',
          'callback': function(token) {
            appendAuthDebugLog('Turnstile 驗證成功', `tokenLen=${token.length}`);
            window.__authTurnstileActive = true;
          },
          'error-callback': function(err) {
            appendAuthDebugLog('Turnstile 驗證錯誤', err, 'error');
            currentWidget.innerHTML = `
              <div style="text-align:center; padding:6px; background:#fef2f2; border:1.5px solid #fecdd3; border-radius:12px;">
                <div style="font-size:11px; color:#dc2626; font-weight:700; margin-bottom:4px;">⚠️ 驗證發生異常</div>
                <button type="button" onclick="resetTurnstileWidget()" style="background:#dc2626; color:#ffffff; border:none; padding:6px 12px; border-radius:8px; font-size:11px; font-weight:800; cursor:pointer;">
                  🔄 點此刷新驗證
                </button>
              </div>`;
          },
          'expired-callback': function() {
            appendAuthDebugLog('Turnstile 驗證過期', '', 'warn');
            toast('⚠️ 驗證已過期，請重新驗證');
            resetTurnstileWidget();
          }
        });
        window.__authTurnstileActive = true;
        return; // 渲染成功
      } catch (e) {
        console.warn("Turnstile 渲染重試中:", e);
      }
    }

    attempts++;
    if (attempts < 20) { // 每 100ms 重試一次，最多等 2 秒
      setTimeout(checkAndRender, 100);
    } else {
      currentWidget.innerHTML = `
        <div style="text-align:center; padding:6px; background:#fff7ed; border:1.5px solid #fed7aa; border-radius:12px;">
          <div style="font-size:11px; color:#c2410c; font-weight:700; margin-bottom:6px;">⚠️ 驗證碼載入較慢？</div>
          <button type="button" onclick="resetTurnstileWidget()" style="background:#2563eb; color:#ffffff; border:none; padding:8px 16px; border-radius:8px; font-size:12px; font-weight:800; cursor:pointer;">
            🔄 點此手動載入驗證碼
          </button>
        </div>
      `;
    }
  };

  // 💡 關鍵修復：從原本的 3000ms 改回 100ms 秒級反應，不再讓使用者乾等！
  setTimeout(checkAndRender, 100);
}
// 專用：重置/刷新 Turnstile 元件
window.resetTurnstileWidget = function() {
  if (window.turnstile && window.turnstileWidgetId !== null) {
    try { window.turnstile.remove(window.turnstileWidgetId); } catch(e){}
    window.turnstileWidgetId = null;
  }
  renderTurnstileWidget();
};


/* 3. 渲染表單內容 (帶有白色大框背景) */
function renderAuthContent() {
  const container = document.getElementById('auth-page-content');
  if (!container) return;

  let contentHtml = '';
  
  if (authMode === 'login') {
    contentHtml = `
      <!-- 🚀 白底大框背景包覆 -->
      <div style="background:#ffffff; border-radius:20px; border:2px solid #e2e8f0; padding:20px 16px; box-shadow:0 8px 24px rgba(0,0,0,0.03); margin-top:10px;letter-spacing:0.9px;">
        <h2 class="auth-title" style="margin-top:0;">歡迎回來</h2>
        <p class="auth-subtitle">請輸入您註冊的「電子郵件」與「密碼」</p>
        
        <div class="auth-input-group">
          <label class="auth-input-label">電子郵件</label>
          <input type="email" class="auth-input" id="auth-email" placeholder="您的帳號@gmail.com">
        </div>
        
        <div class="auth-input-group">
          <label class="auth-input-label">密碼</label>
          <input type="password" class="auth-input" id="auth-pwd" placeholder="請輸入密碼">
        </div>
        
        <div style="text-align:right; margin-top:-6px; margin-bottom:16px;">
          <span onclick="openForgotPassword()" style="color:#2563eb; font-size:13px; font-weight:700; cursor:pointer;">忘記密碼？</span>
        </div>

        <div id="turnstile-widget" style="margin-bottom:16px; min-height:65px;"></div>

        <button onclick="requestLogin()" class="auth-btn-blue">登入 ➔</button>
        
        ${GLOBAL_ALLOW_REGISTRATION ? `
        <div class="auth-switch-text">
          還沒有帳號嗎？ 
          <button class="auth-switch-btn" onclick="window.openRegisterModal()">註冊新帳號</button>
        </div>` : `
        <div class="auth-switch-text" style="color:var(--red);">
          ⚠️ 系統目前暫停開放註冊
        </div>`}
      </div>
    `;
  } else {
    // 註冊表單
    let avatarsHtml = '';
    for(let i=1; i<=22; i++) {
      const isSel = selectedAvatar === `figure/fig${i}.webp`;
      avatarsHtml += `<img src="figure/fig${i}.webp" class="avatar-opt" onclick="selectAvatar('figure/fig${i}.webp', this)" style="width:70px; height:70px; object-fit:contain; border:2px solid ${isSel?'#2563eb':'transparent'}; border-radius:12px; cursor:pointer; transition:transform 0.2s; transform:${isSel?'scale(1.08)':'scale(1)'}; flex-shrink:0; image-rendering: pixelated; image-rendering: crisp-edges;">`;
    }
    
    contentHtml = `
      <!-- 🚀 白底大框背景包覆 -->
      <div style="background:#ffffff; border-radius:20px; border:2px solid #e2e8f0; padding:20px 16px; box-shadow:0 8px 24px rgba(0,0,0,0.03); margin-top:4px;">
        <h2 class="auth-title" style="margin-top:0;">建立新帳號</h2>
        
        <div class="auth-input-group" style="padding:8px; margin-top:8px;">
          <label class="auth-input-label" style="margin-left:4px;">選擇專屬頭像 (可左右滑動)</label>
          <div style="display:grid; grid-template-columns: repeat(11, 1fr); grid-auto-flow: row; gap:8px; margin-top:6px; overflow-x:auto; padding:4px 0; padding-left:4px; width: 100%; height: 100%; object-fit: contain;">
            ${avatarsHtml}
          </div>
        </div>
        
        <div class="auth-input-group">
          <label class="auth-input-label">電子郵件</label>
          <input type="email" class="auth-input" id="auth-email" placeholder="你的帳號@gmail.com">
        </div>
        
        <div class="auth-input-group">
          <label class="auth-input-label">設定密碼</label>
          <input type="password" class="auth-input" id="auth-pwd" placeholder="密碼規則如下">
        </div>

        <div style="margin: 8px 0 16px 0; display:flex; flex-direction:column; gap:8px;">
          <div style="background:#fef2f2; border:1.5px solid #fecdd3; border-radius:12px; padding:10px 8px;">
            <div style="display:flex; align-items:center; gap:6px; color:#e11d48; font-weight:800; font-size:14px; margin-bottom:10px;">
              <span style="font-size:16px;">🛡️</span> 必須符合以下密碼規則
            </div>
            <div style="color:#000000;font-size:11px;line-height:1.5;font-weight:650;display:flex;flex-wrap:wrap;gap:4px;"> 至少 
              <span style="background:#fee2e2; color:#ff0909; padding:3px 4px; border-radius:6px; font-family:var(--mono); font-weight:700; border:1px solid #fca5a5;letter-spacing:0.7px;">12 位數</span>，包含
              <span style="background:#e0e7ff; color:#2563eb; padding:3px 4px; border-radius:6px; font-weight:700; border:1px solid #bfdbfe;">大小寫英文</span>、
              <span style="background:#e8fff0; color:#16a34a; padding:3px 4px; border-radius:6px; font-weight:600; border:1px solid #bbf7d0;">數字</span> 與 
              <span style="background:#f3e8ff; color:#9333ea; padding:3px 4px; border-radius:6px; font-weight:700; border:1px solid #e9d5ff;">特殊符號</span>。
            </div>
          </div>

          <div style="background:linear-gradient(180deg, #263c6a 0%, #3f7fbf 50%, #7bb2e6 100%); border-radius:12px; padding:12px; position:relative; overflow:hidden;">
            <div style="display:flex; align-items:center; gap:6px; color:#60a5fa; font-weight:750; font-size:16px; margin-bottom:8px;">
              <span>💡</span> <span style="background:#ffffff; border-radius:8px; padding:0 6px;">設定建議與提醒</span>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
              <span style="color:#ffffff; font-size:13px; font-weight:700;">不會設定密碼？使用這個 👉</span>
              <a href="https://1password.com/zh-tw/password-generator" target="_blank" style="background:#3b82f6; color:#fff; padding:4px 10px; border-radius:8px; text-decoration:none; font-weight:850; font-size:12px;">1Password 生成器 ➔</a>
            </div>
          </div>
        </div>

        <div onclick="openPrivacyPolicy(true)" style="display:flex; align-items:flex-start; gap:12px; margin-bottom:16px; cursor:pointer;">
          <div id="privacy-chk-box" style="width:20px; height:20px; border-radius:6px; border:2px solid ${privacyAgreed ? '#2563eb' : '#cbd5e1'}; display:flex; align-items:center; justify-content:center; background:${privacyAgreed ? '#2563eb' : 'transparent'}; flex-shrink:0; margin-top:2px;">
            ${privacyAgreed ? '<span style="color:#fff; font-size:12px; font-weight:900;">✓</span>' : ''}
          </div>
          <span id="privacy-chk-text" style="font-size:12px; font-weight:600; color:${privacyAgreed ? '#0f172a' : '#64748b'}; line-height:1.5;">
            建立帳號即代表您同意我們的 <span style="color:#2563eb; font-weight:800;">「禁止條款」與「隱私權政策」</span>
          </span>
        </div>

        <div id="turnstile-widget" style="margin-bottom:16px; min-height:65px;"></div>

        <button onclick="requestLogin()" class="auth-btn-blue">
          立即註冊 ➔
        </button>
        
        <div class="auth-switch-text">
          已經有帳號了？ 
          <button class="auth-switch-btn" onclick="window.openAuthModal()">登入</button>
        </div>
      </div>
      <div style="height:150px;"></div>
    `;
  }

  container.innerHTML = contentHtml;
  renderTurnstileWidget();
}

/* ══ 新增：更改頭像獨立設定頁 ══ */
window.openAvatarSettings = function() {
  document.getElementById('sub-title').textContent = '更改專屬頭像';
  
  // 👈 將「套用」按鈕注入至右上角
  document.getElementById('sub-top-right').innerHTML = `<button onclick="applyNewAvatar()" style="background:var(--acc); color:#fff; border:none; padding:6px 14px; border-radius:16px; font-size:13px; font-weight:700; cursor:pointer; box-shadow:0 2px 6px rgba(255,107,53,0.3);">套用</button>`;
  
  // 預設選中目前頭像
  selectedAvatar = USER.avatar || 'figure/fig1.webp';

  let avatarsHtml = '';
  for(let i=1; i<=22; i++) {
    const isSel = selectedAvatar === `figure/fig${i}.webp`;
    avatarsHtml += `<img src="figure/fig${i}.webp" class="avatar-opt" onclick="selectAvatar('figure/fig${i}.webp', this)" style="width:80px; height:80px; object-fit:contain; border:2px solid ${isSel?'var(--acc)':'transparent'}; border-radius:12px; cursor:pointer; transition:transform 0.2s; transform:${isSel?'scale(1.05)':'scale(1)'}; flex-shrink:0; image-rendering: pixelated; image-rendering: crisp-edges;">`;
  }
  
  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px;">
      <div style="display:flex; flex-wrap:wrap; gap:8px; background:var(--bg-input); padding:16px; border-radius:16px; justify-content:center;">
        ${avatarsHtml}
      </div>
    </div>
  `;
}

window.applyNewAvatar = function() {
  USER.avatar = selectedAvatar;
  saveUser();
  toast('🎨 頭像，已更新！');
  openAccountStats(); // 切回帳號資訊頁面
}

// 您的後端 API 網址 (本地測試為 localhost:3000，上線請改為實際網域)
const API_BASE_URL = 'https://delivery-api.fab2ci.workers.dev';

/* 5. 修正：寄送註冊/登入驗證碼邏輯 */
async function requestLogin() {
  const email = document.getElementById('auth-email').value.trim().toLowerCase();
  const pwd = document.getElementById('auth-pwd').value.trim();

  // 🌟 前端即時檢查：僅允許 @gmail.com 與 @googlemail.com
  const isGmail = email.endsWith('@gmail.com') || email.endsWith('@googlemail.com');
  if (!isGmail || email.length <= 10) {
    toast('⚠️ 系統僅限使用 @gmail.com 格式之信箱');
    return;
  }

  let turnstileToken = '';
  if (typeof turnstile !== 'undefined') {
    turnstileToken = turnstile.getResponse();
    if (!turnstileToken) {
      window.__authTurnstileActive = true;
      toast('⚠️ 請等待，或點擊完成人機驗證');
      return;
    }
  }

  if(!email.includes('@')) { toast('請輸入有效的 E-mail 格式（您的帳號@gmail.com）'); return; }
  
  const pwdRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9\s])\S{12,}$/;
  
  if (authMode === 'register' && !pwdRegex.test(pwd)) {
    toast('⚠️ 密碼強度不足：需至少12字元，並包含大小寫英文、數字及特殊符號');
    return;
  }
  if (authMode === 'login' && pwd === '') {
    toast('⚠️ 請輸入「密碼」');
    return;
  }

  if (authMode === 'register' && !privacyAgreed) {
    toast('⚠️ 請點擊上方，並閱讀同意「禁止條款」與「隱私權政策」');
    return;
  }

  showProgress(authMode === 'login' ? '登入連線中...' : '註冊連線中...');
  
  try {
    const apiPath = authMode === 'login' ? '/auth/login' : '/auth/register';
    
    const res = await fetch(`${API_BASE_URL}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pwd, turnstileToken }) 
    });
    const data = await res.json();
    appendAuthDebugLog(`收到 ${authMode === 'login' ? '登入' : '註冊'} 回應`, `success=${data.success} message=${data.message || '無訊息'}`);
    
    finishProgress(() => {
      if (data.success) {
        if (data.directLogin) {
          const isWeak = !pwdRegex.test(pwd);

          USER = { 
            email: email, uid: data.user.uid, verified: true, loggedIn: true, 
            joinDate: new Date(data.user.createdAt).toLocaleDateString(), 
            token: data.token, role: data.user.role, avatar: selectedAvatar,
            isPasswordWeak: isWeak,
            removeWatermark: data.user.removeWatermark
          };
          saveUser();
          
          if (isWeak) {
            showForcePasswordChange(true);
            return;
          }

          appendAuthDebugLog(`登入成功`, `role=${data.user?.role || 'unknown'}`);
          toast('登入成功 ✅');
          restoreAuthOriginPage();
        } else {
          appendAuthDebugLog(`進入驗證碼階段`, `email=${email}`);
          
          // 👈 修正：將驗證碼輸入畫面寫入 getAuthContainer()
          const container = getAuthContainer();
          const titleEl = document.getElementById('auth-page-title');
          if (titleEl) titleEl.textContent = '輸入驗證碼';

          container.innerHTML = `
            <div style="padding:8px 0;">
              <p style="font-size:13px;color:var(--t2);margin-bottom:16px; background:var(--bg-input); padding:12px; border-radius:12px; line-height:1.6;">
                ✅ 系統已寄出驗證信至 <b>${email}</b><br>
                <span style="color:var(--t3);font-size:12px;font-weight:600;">(請至信箱收取 6 位數驗證碼)</span>
              </p>
              <div class="fg" style="margin-bottom:20px;">
                <label style="font-weight:700; color:var(--t1);">6位數驗證碼</label>
                <input type="number" class="finp" id="auth-code" autocomplete="one-time-code" placeholder="請輸入信件中的數字" inputmode="numeric" style="font-size:24px; letter-spacing:8px; text-align:center; padding:12px; font-family:var(--mono);">
              </div>
              <button onclick="verifyAuthCode('${email}')" class="btn-acc" style="width:100%;padding:14px;font-size:15px;font-weight:800;border-radius:var(--rs); box-shadow:0 4px 12px rgba(255,107,53,0.3);">驗證並啟用帳號</button>
            </div>
          `;
        }
      } else {
        toast(data.message);
      }
    });
  } catch (err) {
    finishProgress(() => toast('無法連線至伺服器'));
  }
}

/* ══ 驗證 Email 驗證碼 (儲存權限 role) ══ */
async function verifyAuthCode(email) {
  const code = document.getElementById('auth-code').value.trim();
  appendAuthDebugLog(`送出驗證碼`, `email=${email} codeLen=${code.length}`);
  if(code.length < 4) { toast('請輸入「正確的驗證碼」'); return; }
  
  showProgress('帳號驗證中...');
  try {
    const res = await fetch(`${API_BASE_URL}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });
    const data = await res.json();
    appendAuthDebugLog(`收到驗證碼回應`, `success=${data.success} message=${data.message || '無訊息'}`);
    
    finishProgress(() => {
      if (data.success) {
        // 👈 將 data.user.role (權限) 一併存入
        USER = { email: email, uid: data.user.uid, verified: true, loggedIn: true, joinDate: new Date(data.user.createdAt).toLocaleDateString(), token: data.token, role: data.user.role, avatar: selectedAvatar, uid: data.user.uid, removeWatermark: data.user.removeWatermark };
        saveUser();
        appendAuthDebugLog(`驗證成功`, `role=${data.user?.role || 'unknown'}`);
        toast('登入成功 ✅');
        closeOverlay('sub-page');
        restoreAuthOriginPage();
      } else {
        toast('⚠️ ' + data.message);
      }
    });
  } catch (err) {
    finishProgress(() => toast('無法連線至伺服器'));
  }
}

/* ══ 替換：帳號資訊 (開放統計 & 頭像支援 & 在線人數) ══ */
async function openAccountStats() {
  appendAuthDebugLog(`開啟帳號資訊頁`, `user=${USER?.email || 'unknown'}`);
  document.getElementById('sub-title').textContent = '帳號資訊';
  document.getElementById('sub-top-right').innerHTML = '';

  const closeBtn = document.querySelector('#sub-page .top-bar .bar-btn');
  if (closeBtn) closeBtn.style.display = '';

  window.__authTurnstileActive = false;
  document.getElementById('sub-body').innerHTML = `<div style="padding:32px; text-align:center; color:var(--t3);">載入資料中...</div>`;
  openOverlay('sub-page');

  let statsHtml = '';
  let adminOnlineHtml = ''; // 管理員專屬的在線名單 HTML

  try {
    // 💡 加上 Authorization header，讓後端知道我們是不是管理員
    const headers = { 'Content-Type': 'application/json' };
    if (USER && USER.token) headers['Authorization'] = `Bearer ${USER.token}`;

    const statRes = await fetch(`${API_BASE_URL}/stats`, { headers });
    const statData = await statRes.json();
    appendAuthDebugLog(`帳號資訊載入完成`, `success=${statData.success} online=${statData.onlineCount || 0}`);
    if (statData.success) {
      statsHtml = `
        <h4 style="font-size:13px; color:var(--hint-color); margin-bottom:8px;">📊 系統註冊統計</h4>
        <div class="set-list" style="margin-bottom:20px;">
          <div class="set-row"><span class="sn">總申請人數</span><span style="font-family:var(--mono);color:var(--t1);font-weight:700;">${statData.total} 人</span></div>
          <div class="set-row"><span class="sn">已完成驗證</span><span style="font-family:var(--mono);color:var(--green);font-weight:700;">${statData.verified} 人</span></div>
          <div class="set-row"><span class="sn">🟢 目前在線人數</span><span style="font-family:var(--mono);color:var(--green);font-weight:900;">${statData.onlineCount} 人</span></div>
        </div>`;
        
      // 👇 如果是管理員，把具體名單渲染出來
      // 修改原本的渲染邏輯：
      if (USER.role === 'admin') {
        adminOnlineHtml = `
          <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; padding:16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-size:14px; font-weight:900; color:#16a34a;">🟢 在線人數：${statData.onlineCount} 人</div>
            </div>
            <button onclick="openAdminOnlineUsers()" style="background:#10b981; color:#fff; border:none; padding:6px 12px; border-radius:8px; font-size:12px; font-weight:800;">查看名單</button>
          </div>
        `;
      }
    }
  } catch (e) {}

  const avatarImg = USER.avatar 
    ? `<div style="position:relative; display:inline-block;">
         <img src="${USER.avatar}" style="width:192px; height:192px; object-fit:contain; margin-bottom:4px; border:none; border-radius:0; image-rendering: pixelated; image-rendering: crisp-edges;">
         <div onclick="openAvatarSettings()" style="position:absolute; bottom:16px; right:-10px; background:var(--sf); border:2px solid var(--acc); color:var(--acc); width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:14px; box-shadow:0 2px 6px rgba(0,0,0,0.1);">✎</div>
       </div>` 
    : `<div style="font-size:48px; margin-bottom:8px;">${USER.role === 'admin' ? '👑' : '🧑‍🚀'}</div>`;

  let baseHtml = `
    <div style="padding:16px;">
      <div class="card" style="text-align:center; padding:24px 16px; background:#fff; border-color:var(--border);">
        ${avatarImg}
        <div style="font-size:16px; font-weight:700; color:var(--t1); margin-bottom:2px;">${USER.email}</div>
        <div style="font-size:11px; color:var(--t3); font-family:var(--mono); font-weight:800; margin-bottom:8px;">UID: #${USER.uid || '--------'}</div>
        <div style="font-size:12px; color:#fff; background:var(--green); display:inline-block; padding:4px 12px; border-radius:20px; font-weight:700;">✓ 已驗證帳號</div>
      </div>
      
      <h4 style="font-size:13px; color:var(--hint-color); margin-bottom:8px;">個人資料</h4>
      <div class="set-list" style="margin-bottom:20px;">
        <div class="set-row"><span class="sn">加入日期</span><span style="font-family:var(--mono);color:var(--text-blue);font-weight:600;">${USER.joinDate || '未知'}</span></div>
        
        <div class="set-row" onclick="openRecordStats()">
          <span class="sn">個人累計單量</span>
          <span style="font-family:var(--mono);color:var(--text-blue);font-weight:800; margin-right:4px;">${fmt(S.records.filter(r => !r.isPunchOnly).reduce((sum, r) => sum + (parseFloat(r.orders) || 0), 0))} 單</span>
          <span class="arr">›</span>
        </div>
        
        <div class="set-row" onclick="showForcePasswordChange()"><span class="sn" style="color:var(--acc); font-weight:700;">🔑 更改密碼</span><span class="arr">›</span></div>
      </div>
      ${statsHtml}
  `;

  if (USER.role !== 'admin') {
    baseHtml += `<button onclick="logoutAccount()" class="btn-danger" style="width:100%;padding:14px;font-weight:700;font-size:15px;">登出帳號</button></div>`;
    document.getElementById('sub-body').innerHTML = baseHtml;
    return;
  }

  // 管理員專區
  document.getElementById('sub-body').innerHTML = baseHtml + `
    <h4 style="font-size:13px; color:var(--text-red); margin-bottom:8px;">⚙️ 系統管理 (管理員專區)</h4>

    <!-- 👇 插入管理員專屬的在線名單 -->
    ${adminOnlineHtml}

    <button onclick="openAdminUserList()" style="width:100%; padding:14px; border-radius:var(--rs); background:#10b981; color:#fff; font-size:15px; font-weight:800; border:none; margin-bottom:12px; box-shadow:0 4px 12px rgba(16,185,129,0.3); cursor:pointer;">
      👥 管理註冊會員名單 (含搜尋)
    </button>

    <button onclick="openAdminExceptionList()" style="width:100%; padding:14px; border-radius:var(--rs); background:#06b6d4; color:#fff; font-size:15px; font-weight:800; border:none; margin-bottom:12px; box-shadow:0 4px 12px rgba(6,182,212,0.3); cursor:pointer;">
      🛡️ 管理 14 天豁免例外名單
    </button>

    <button onclick="openAdminSystemSettings()" style="width:100%; padding:14px; border-radius:var(--rs); background:#8b5cf6; color:#fff; font-size:15px; font-weight:800; border:none; margin-bottom:12px; box-shadow:0 4px 12px rgba(139,92,246,0.3); cursor:pointer;">
      🔒 編輯系統存取權限
    </button>

    <button onclick="openAdminBannedList()" style="width:100%; padding:14px; border-radius:var(--rs); background:#ef4444; color:#fff; font-size:15px; font-weight:800; border:none; margin-bottom:12px; box-shadow:0 4px 12px rgba(239,68,68,0.3); cursor:pointer;">
      🚫 管理黑名單 (已封鎖帳號)
    </button>

    <button onclick="openAdminGasPriceEdit()" style="width:100%; padding:14px; border-radius:var(--rs); background:var(--blue); color:#fff; font-size:15px; font-weight:800; border:none; margin-bottom:12px; box-shadow:0 4px 12px rgba(59,130,246,0.3); cursor:pointer;">
      ⛽ 編輯全域油價設定
    </button>      

    <button onclick="openAnnouncementEdit()" style="width:100%; padding:14px; border-radius:var(--rs); background:var(--gold); color:#fff; font-size:15px; font-weight:800; border:none; margin-bottom:24px; box-shadow:0 4px 12px rgba(245,158,11,0.3); cursor:pointer;">
      📢 編輯首頁系統公告
    </button>

    <button onclick="logoutWithConfirm()" class="btn-danger" style="width:100%;padding:14px;font-weight:700;font-size:15px;">登出帳號</button>
  </div>`;
}
// 新增：登出確認框
// 搜尋 window.logoutWithConfirm
window.logoutWithConfirm = function() {
  customConfirm('確定要<span style="color:var(--text-blue);font-size:15px;font-weight:750;"> 登出帳號 </span>嗎？').then(ok => {
    if (ok) {
      // 1. 清空狀態
      USER = {email:null, verified:false, loggedIn:false, joinDate:null, token:null, role:"user", uid: null};
      saveUser();
      
      // 🌟 [新增] 強制重新渲染設定頁面，更新「帳號登入狀態」區塊
      renderSettings();

      toast('已登出 ✅');
      closeOverlay('sub-page');

      // 如果人在首頁，也順便更新首頁 UI
      if (S.tab === 'home') renderHome();
    }
  });
};

/* ══ 新增：個人記錄統計 (三種不同風格混合設計，改為計算「總單量」) ══ */
window.openRecordStats = function() {
  document.getElementById('sub-title').textContent = '個人記錄統計';
  
  const closeBtn = document.querySelector('#sub-page .top-bar .bar-btn');
  if (closeBtn) closeBtn.style.display = 'none';
  document.getElementById('sub-top-right').innerHTML = `
    <button onclick="animateSubPageReturn(this, () => openAccountStats())" style="background:linear-gradient(135deg, #3b82f6, #2563eb); color:#ffffff; border:1px solid #1d4ed8; padding:6px 16px; border-radius:20px; font-size:13px; font-weight:900; cursor:pointer; box-shadow:0 4px 12px rgba(37,99,235,0.3); transition:0.2s; letter-spacing:0.5px; text-shadow:0 1px 2px rgba(0,0,0,0.2);">
      🔙 返回
    </button>
  `;

  // 1. 過濾出所有非純打卡的有效記錄
  const validRecs = S.records.filter(r => !r.isPunchOnly);
  
  // 2. 👇 核心修改：計算全部記錄中的「總接單數 (orders)」
  const totalOrders = validRecs.reduce((sum, r) => sum + (parseFloat(r.orders) || 0), 0);
  
  let daysAcc = 0;
  if (validRecs.length > 0) {
    const dates = validRecs.map(r => new Date(r.date)).sort((a, b) => a - b);
    const firstDate = dates[0];
    const today = new Date();
    daysAcc = Math.ceil((today - firstDate) / 86400000) || 1;
  }
  
  // 3. 👇 修改平台與年份的統計，改為累加 orders 
  const platOrderCounts = {}; 
  const yearStats = {};  

  validRecs.forEach(r => {
    const pId = r.platformId || 'unknown';
    const y = (r.date && r.date.substring(0,4)) || '未知';
    const ord = parseFloat(r.orders) || 0; // 取得該筆單數

    // 平台累加單數
    platOrderCounts[pId] = (platOrderCounts[pId] || 0) + ord;
    
    // 年份累加單數
    if (!yearStats[y]) yearStats[y] = { totalOrders: 0, plats: {} };
    yearStats[y].totalOrders += ord;
    yearStats[y].plats[pId] = (yearStats[y].plats[pId] || 0) + ord;
  });

  const sortedYears = Object.keys(yearStats).sort((a,b) => b.localeCompare(a));
  const sortedPlats = Object.entries(platOrderCounts).sort((a,b) => b[1] - a[1]);

  let html = `<div style="padding:16px; padding-bottom:40px; display:flex; flex-direction:column; gap:20px;">`;

  // ==========================================
  // 【風格 1 亮麗炫彩版】晨光極光與動態反光 (Vibrant Sunrise)
  // ==========================================
  html += `
    <style>
      @keyframes sunriseFlow { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
      @keyframes glassShine { 0% { transform: translateX(-150%) rotate(25deg); } 100% { transform: translateX(150%) rotate(25deg); } }
    </style>
    
    <div style="background: linear-gradient(125deg, #FF416C, #FF4B2B, #F9D423, #FF4B2B, #FF416C); background-size: 300% 300%; animation: sunriseFlow 6s ease infinite; border-radius: 24px; padding: 28px 20px; position: relative; overflow: hidden; box-shadow:inset 0 0 0 2px rgba(255,255,255,0.4);">
      
      <div style="position:absolute; top:-50%; left:-50%; width:200%; height:200%; background:linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0) 100%); transform:rotate(25deg); animation: glassShine 4s infinite ease-in-out; pointer-events:none;"></div>
      
      <div style="position:absolute; top:-20px; right:-20px; width:120px; height:120px; border-radius:50%; background:rgba(255,255,255,0.2); filter:blur(20px);"></div>
      <div style="position:absolute; bottom:-30px; left:-30px; width:150px; height:150px; border-radius:50%; background:rgba(255,212,35,0.4); filter:blur(30px);"></div>

      <div style="position: relative; z-index: 1;">
        
        <div style="display:flex; justify-content:center; align-items:center; margin-bottom: 24px;">
          <span style="background: rgba(255,255,255,0.25); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); color: #ffffff; padding: 6px 14px; border-radius: 12px; font-size: 14px; font-weight: 900; letter-spacing: 1.5px; border: 1px solid rgba(255,255,255,0.5); box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
            ✨ 輝煌外送生涯 ✨
          </span>
        </div>

        <div style="text-align:center; margin-bottom: 28px;">
          <!-- 👇 修改文字為「累計完成總單量」 -->
          <div style="font-size: 13px; color: rgba(255,255,255,0.9); font-weight: 800; letter-spacing: 1px; margin-bottom: 8px; text-shadow: 0 1px 2px rgba(0,0,0,0.1);">累計完成總單量</div>
          <!-- 👇 填入的是 totalOrders -->
          <div style="font-family: var(--mono); font-size: 64px; font-weight: 900; color: #ffffff; line-height: 1; text-shadow: 0 4px 15px rgba(0,0,0,0.2), 0 0 40px rgba(255,255,255,0.6); margin-bottom: 6px; letter-spacing:-2px;">
            ${fmt(totalOrders)}
          </div>
          <!-- 👇 修改英文為 Total Orders -->
          <div style="font-size: 12px; color: rgba(255,255,255,0.8); font-weight: 900; text-transform: uppercase; letter-spacing: 3px;">Total Orders</div>
        </div>

        <div style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.4); border-radius: 16px; padding: 12px 16px; display:flex; justify-content:space-between; align-items:center; backdrop-filter: blur(12px); box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <div style="display:flex; align-items:center; gap: 8px;">
            <div style="width: 10px; height: 10px; border-radius: 50%; background: #ffffff; box-shadow: 0 0 10px #ffffff;"></div>
            <span style="color: #ffffff; font-size: 13px; font-weight: 800; letter-spacing:0.5px; text-shadow: 0 1px 2px rgba(0,0,0,0.1);">外送旅程陪伴你</span>
          </div>
          <div style="font-family: var(--mono); font-size: 18px; font-weight: 900; color: #ffffff; text-shadow: 0 2px 4px rgba(0,0,0,0.2);">
            ${daysAcc} <span style="font-size:11px; color:rgba(255,255,255,0.9); font-weight:800;">天</span>
          </div>
        </div>
      </div>
    </div>
  `;

  // ==========================================
  // 【風格 2】馬卡龍 Bento Grid (平台戰力分析)
  // ==========================================
  if (sortedPlats.length > 0) {
    html += `
      <div>
        <div style="font-size:14px; color:var(--t1); font-weight:900; margin-bottom:12px; padding-left:4px; display:flex; align-items:center; gap:6px;">
          <span style="font-size:18px;">📊</span> 平台戰力分析
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
    `;
    const maxPlatOrders = sortedPlats[0][1];
    sortedPlats.forEach(([pid, orderCount]) => {
      const pInfo = getPlatform(pid);
      const color = pInfo.color || '#94a3b8';
      // 👇 使用單數來計算百分比
      const pct = maxPlatOrders > 0 ? Math.round((orderCount / maxPlatOrders) * 100) : 0;
      const totalPct = totalOrders > 0 ? Math.round((orderCount / totalOrders) * 100) : 0;

      html += `
        <div style="background:${color}10; border: 1.5px solid ${color}30; border-radius: 16px; padding: 14px; position: relative; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.02);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
            <span style="font-size:13px; font-weight:900; color:var(--t1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-right:8px;">${safeText(pInfo.name)}</span>
            <span style="background:${color}20; color:${color}; font-size:10px; font-weight:800; padding:2px 6px; border-radius:6px; font-family:var(--mono);">${totalPct}%</span>
          </div>
          <!-- 👇 顯示單數 -->
          <div style="display:flex; align-items:baseline; gap:4px; margin-bottom:10px;">
            <span style="font-family:var(--mono); font-size:24px; font-weight:900; color:${color}; line-height:1;">${fmt(orderCount)}</span>
            <span style="font-size:11px; font-weight:700; color:${color};">單</span>
          </div>
          <div style="height:6px; background:${color}20; border-radius:4px; overflow:hidden;">
            <div style="height:100%; width:${pct}%; background:${color}; border-radius:4px;"></div>
          </div>
        </div>
      `;
    });
    html += `</div></div>`;
  }

  // ==========================================
  // 【風格 3】極簡彩色時間軸 (歷年時光軌跡 - 橫向滑動防擠壓)
  // ==========================================
  if (sortedYears.length > 0) {
    html += `
      <div>
        <div style="font-size:14px; color:var(--t1); font-weight:900; margin-bottom:12px; padding-left:4px; display:flex; align-items:center; gap:6px;">
          <span style="font-size:18px;">⏳</span> 歷年時光軌跡
        </div>
        <div style="position: relative; padding-left: 20px; margin-left: 8px;">
          <div style="position: absolute; top: 10px; bottom: 20px; left: 0; width: 3px; background: linear-gradient(to bottom, #3b82f6, #8b5cf6, #ec4899); border-radius: 2px;"></div>
    `;

    sortedYears.forEach((y, idx) => {
      const isLatest = idx === 0;
      const dotColor = isLatest ? '#3b82f6' : '#cbd5e1';
      const dotBorder = isLatest ? '#eff6ff' : '#f8fafc';
      const yearPlats = Object.entries(yearStats[y].plats).sort((a,b) => b[1] - a[1]);
      
      const tagsHtml = yearPlats.map(([pid, orderCount]) => {
        const pInfo = getPlatform(pid);
        return `<div style="flex-shrink:0; background:${pInfo.color}15; color:${pInfo.color}; border:1px solid ${pInfo.color}30; font-size:11px; font-weight:800; padding:3px 8px; border-radius:8px; display:flex; align-items:center; gap:4px; box-shadow:0 1px 2px rgba(0,0,0,0.02);">
          ${safeText(pInfo.name)} <span style="background:${pInfo.color}; color:#fff; padding:1px 5px; border-radius:4px; font-family:var(--mono); font-size:10px;">${fmt(orderCount)} 單</span>
        </div>`;
      }).join('');

      html += `
        <div style="position: relative; margin-bottom: 16px; background: #ffffff; border-radius: 16px; padding: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.04); border: 1.5px solid #e2e8f0;">
          <div style="position: absolute; left: -26.5px; top: 18px; width: 16px; height: 16px; border-radius: 50%; background: ${dotColor}; border: 4px solid ${dotBorder}; box-shadow: 0 0 0 1px #e2e8f0;"></div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div style="font-size:18px; font-weight:900; color:var(--t1);">${y} <span style="font-size:12px; font-weight:700; color:#64748b;">年</span></div>
            <!-- 👇 顯示年度總單量 -->
            <div style="font-family:var(--mono); font-size:16px; font-weight:900; color:var(--text-blue);">${fmt(yearStats[y].totalOrders)}<span style="font-size:11px;font-weight:600;color: #000;margin:3px 0 0 4px;">單</span></div>
          </div>
          
          <style>.hide-scroll-bar::-webkit-scrollbar { display: none; }</style>
          <div class="hide-scroll-bar" style="display:flex; gap:6px; flex-wrap:nowrap; overflow-x:auto; padding-bottom:4px;">
            ${tagsHtml}
          </div>
        </div>
      `;
    });
    html += `</div></div>`;
  }
  html += `</div>`;
  document.getElementById('sub-body').innerHTML = html;
  openOverlay('sub-page');
}

/* =========================================================
   管理員專區：會員名單、搜尋、刪除與手動建立
   ========================================================= */
// 暫存會員名單，供即時搜尋使用
let adminCachedUsers = [];

/* 1. 開啟獨立的會員名單與搜尋頁面 */
window.openAdminUserList = async function() {
  document.getElementById('sub-title').textContent = '註冊會員名單';
  
  // 👇 強制隱藏左上角的 X 按鈕
  const closeBtn = document.querySelector('#sub-page .top-bar .bar-btn');
  if (closeBtn) closeBtn.style.display = 'none';
  // 右上角加入強化版返回按鈕
  document.getElementById('sub-top-right').innerHTML = `
    <button onclick="animateSubPageReturn(this, () => { document.querySelector('#sub-page .top-bar .bar-btn').style.display=''; openAccountStats(); })" style="background:linear-gradient(135deg, #3b82f6, #2563eb); color:#ffffff; border:1px solid #1d4ed8; padding:6px 16px; border-radius:20px; font-size:13px; font-weight:900; cursor:pointer; box-shadow:0 4px 12px rgba(37,99,235,0.3); transition:0.2s; letter-spacing:0.5px; text-shadow:0 1px 2px rgba(0,0,0,0.2);">🔙 返回</button>
  `;
  
  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px; display:flex; flex-direction:column; height:100%;">
      
      <button onclick="openAdminCreateUser()" style="width:100%; padding:14px; border-radius:var(--rs); background:#10b981; color:#fff; font-size:15px; font-weight:800; border:none; margin-bottom:16px; box-shadow:0 4px 12px rgba(16,185,129,0.3); cursor:pointer; flex-shrink:0;">
        ➕ 手動建立新帳號 (免驗證)
      </button>

      <div class="fg" style="margin-bottom:16px; flex-shrink:0;">
        <input type="text" id="adm-search-user" class="finp" placeholder="🔍 輸入信箱關鍵字搜尋..." oninput="renderAdminUserList(this.value)" style="border:2px solid var(--text-blue); font-weight:800; color:var(--text-blue); background:#eff6ff;">
      </div>

      <div class="card" style="padding:0; flex:1; overflow-y:auto; border:1px solid var(--border);" id="adm-user-list-container">
        <div style="text-align:center; color:var(--t3); padding:30px; font-weight:700;">📡 載入會員資料中...</div>
      </div>
    </div>
  `;
  
  // 向後端請求完整名單
  try {
    const res = await fetch(`${API_BASE_URL}/admin/users`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${USER.token}` // 👈 就是少了這一行！
      },
      body: JSON.stringify({ adminEmail: USER.email }) 
    });
    const data = await res.json();
    if (data.success) {
      adminCachedUsers = data.users;
      renderAdminUserList('');
    } else {
      document.getElementById('adm-user-list-container').innerHTML = `<div style="text-align:center; color:var(--red); padding:30px; font-weight:700;">⚠️ 載入失敗：${data.message}</div>`;
    }
  } catch(e) {
    document.getElementById('adm-user-list-container').innerHTML = `<div style="text-align:center; color:var(--red); padding:30px; font-weight:700;">⚠️ 連線失敗，無法取得資料</div>`;
  }
}

/* 2. 渲染搜尋結果列表 */
window.renderAdminUserList = function(keyword) {
  const container = document.getElementById('adm-user-list-container');
  if (!container) return;

  const kw = (keyword || '').toLowerCase().trim();
  const filtered = adminCachedUsers.filter(u => u.email.toLowerCase().includes(kw));

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--t3); padding:30px; font-weight:700;">沒有找到相符的帳號 📭</div>`;
    return;
  }

  // 取得現在時間並把時分秒歸零，作為「今天」的基準線
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  let html = '';
  filtered.forEach(u => {
    const isWatermarkRemoved = u.remove_watermark === 1;
    const vTag = u.verified 
      ? '<span style="color:var(--green); font-weight:900; background:var(--green-d); padding:3px 8px; border-radius:6px; font-size:10px; border:1px solid #bbf7d0;">已開通</span>' 
      : '<span style="color:var(--t3); font-weight:900; background:var(--bg-input); padding:3px 8px; border-radius:6px; font-size:10px; border:1px solid #e2e8f0;">未驗證</span>';
    const roleTag = u.role === 'admin' ? '👑 ' : '';
    
    // 👇 智慧判斷最後活動時間與日期計算
    let lastActiveStr = '尚未登入';
    const activeTimeMs = u.lastActiveAt || u.createdAt; 
    
    if (activeTimeMs) {
      const d = new Date(activeTimeMs);
      
      // 計算該時間的「午夜零點」，藉此與「今天的午夜零點」精準相減，才能正確跨日！
      const activeMidnight = new Date(d);
      activeMidnight.setHours(0, 0, 0, 0);
      
      const diffDays = Math.round((todayMidnight.getTime() - activeMidnight.getTime()) / 86400000);
      
      let diffStr = '';
      if (diffDays === 0) diffStr = '今天';
      else if (diffDays === 1) diffStr = '昨天';
      else diffStr = `${diffDays}天前`;
      
      // 格式化為: 5/17 23:45 (今天)
      const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      lastActiveStr = `${d.getMonth()+1}/${d.getDate()} ${timeStr} (${diffStr})`;
    }

    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:16px 12px; border-bottom:1px solid var(--border);">
        <div style="flex:1; overflow:hidden; padding-right:10px;">
          <div style="display:flex; align-items:baseline; gap:8px;">
            <span style="font-size:15px; font-weight:900;">${u.email}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
            <!-- 🌟 浮水印控制區 -->
            <div style="display:flex; align-items:center; gap:6px; background:var(--sf2); padding:4px 8px; border-radius:8px; border:1px solid var(--border);">
              <span style="font-size:11px; font-weight:800; color:var(--t2);">移除浮水印</span>
              <label class="switch" style="transform: scale(0.7); margin-left:-5px;">
                <input type="checkbox" ${isWatermarkRemoved ? 'checked' : ''} onchange="adminToggleWatermark('${u.email}', this.checked)">
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>
        <button onclick="adminDeleteUser('${u.email}')" class="btn-danger" style="padding:6px 12px; font-size:12px;">刪除</button>
      </div>
    `;
  });
  container.innerHTML = html;
}
/* 新增管理員操作函式 */
window.adminToggleWatermark = async function(targetEmail, isChecked) {
  try {
    const res = await fetch(`${API_BASE_URL}/admin/update-watermark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${USER.token}` },
      body: JSON.stringify({ 
        targetEmail: targetEmail, 
        removeWatermark: isChecked ? 1 : 0 
      })
    });
    const data = await res.json();
    if (data.success) {
      toast('浮水印權限，已更新 ✅');
    }
  } catch(e) {
    toast('❌ 更新失敗');
  }
}

/* 3. 刪除會員 (支援獨立詢問是否封鎖，並加入最後取消防線) */
window.adminDeleteUser = async function(targetEmail) {
  // 第 1 次確認：刪除帳號
  const okDelete = await customConfirm(`確定要<span style="color:var(--red);"> 刪除 </span>『 <span style="color:var(--green);">${targetEmail}</span> 』嗎？<br><span style="color:var(--text-blue);font-weight:700;">此動作無法復原。</span>`);
  if(!okDelete) return;

  // 第 2 次確認：是否加入黑名單
  const isBan = await customConfirm(`
    <div style="font-size:40px; margin-bottom:8px;">🚫</div>
    是否將『 <span style="color:var(--green);">${targetEmail}</span> 』加入黑名單？<br>
    <span style="color:var(--red); font-weight:700;">(按「確認」封鎖，按「取消」則不封鎖)</span>
  `);
  
  // 第 3 次確認：最後的「取消刪除」防線
  const actionText = isBan ? "<span style='color:var(--red);'>刪除並永久封鎖</span>" : "僅單純刪除帳號";
  const finalCheck = await customConfirm(`
    <div style="font-size:30px; margin-bottom:8px;">⚠️</div>
    即將對『 <span style="color:var(--green);">${targetEmail}</span> 』執行：<br>
    <div style="font-size:18px; font-weight:900; margin:12px 0;">[ ${actionText} ]</div>
    您確定要執行嗎？<br>
    <span style="color:var(--t3); font-size:12px;">(按「 取消 」將放棄此次刪除操作)</span>
  `);
  
  if (!finalCheck) {
    toast('已取消「刪除操作」');
    return;
  }
  
  showProgress('刪除帳號中...');
  try {
    const res = await fetch(`${API_BASE_URL}/admin/delete`, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json','Authorization': `Bearer ${USER.token}` },
      body: JSON.stringify({ adminEmail: USER.email, targetEmail: targetEmail, isBan: isBan })
    });
    const data = await res.json();
    
    finishProgress(() => {
      if(data.success) {
        toast('帳號，已徹底刪除 ✅');
        if (targetEmail === USER.email) {
          logoutAccount(); 
        } else {
          // 在本地端過濾掉被刪除的帳號，保留目前的搜尋關鍵字重新渲染！
          adminCachedUsers = adminCachedUsers.filter(u => u.email !== targetEmail);
          const kw = document.getElementById('adm-search-user')?.value || '';
          renderAdminUserList(kw);
        }
      } else {
        toast('⚠️ 刪除失敗：' + data.message);
      }
    });
  } catch(err) {
    finishProgress(() => toast('連線失敗'));
  }
}

/* 4. 手動建立新帳號介面 */
window.openAdminCreateUser = function() {
  document.getElementById('sub-title').textContent = '手動建立帳號';

  // 👇 強制隱藏左上角的 X 按鈕
  const closeBtn = document.querySelector('#sub-page .top-bar .bar-btn');
  if (closeBtn) closeBtn.style.display = 'none';
  // 右上角加入強化版返回按鈕
  document.getElementById('sub-top-right').innerHTML = `
    <button onclick="animateSubPageReturn(this, () => openAdminUserList())" style="background:linear-gradient(135deg, #10b981, #059669); color:#ffffff; border:1px solid #047857; padding:6px 16px; border-radius:20px; font-size:13px; font-weight:900; cursor:pointer; box-shadow:0 4px 12px rgba(16,185,129,0.3); transition:0.2s; letter-spacing:0.5px; text-shadow:0 1px 2px rgba(0,0,0,0.2);">🔙 返回清單</button>
  `;
  
  document.getElementById('sub-body').innerHTML = `
    <div class="card" style="padding:16px; border:2px solid #10b981; box-shadow:0 4px 16px rgba(16,185,129,0.15);">
      <div style="font-size:12px; color:#065f46; line-height:1.6; font-weight:700; margin-bottom:16px; background:#dcfce7; padding:10px; border-radius:8px;">
        💡 在此建立的帳號將直接跳過 Email 驗證並自動開通，可直接登入！<br>
        ⚠️ 密碼不受強度限制，可自由設定如 1234 等初始密碼。
      </div>

      <div class="fg">
        <label style="font-weight:900; color:#047857;">電子郵件 (登入帳號)</label>
        <input type="email" id="adm-new-email" class="finp" placeholder="例如：test@gmail.com" style="font-family:var(--mono); color:var(--text-blue); font-weight:800; border-color:#6ee7b7;">
      </div>
      
      <div class="fg" style="margin-top:16px;">
        <label style="font-weight:900; color:#047857;">設定初始登入密碼</label>
        <input type="text" id="adm-new-pwd" class="finp" placeholder="例如：1234" style="font-family:var(--mono); color:var(--red); font-weight:900; border-color:#6ee7b7;">
      </div>
    </div>
    
    <button onclick="adminCreateUserSubmit()" class="btn-acc" style="width:100%; padding:14px; font-size:16px; font-weight:900; border-radius:var(--rs); background:#059669; box-shadow:0 6px 16px rgba(16,185,129,0.35); margin-top:12px; transition:0.2s;">
      ✅ 立即建立並開通帳號
    </button>
  `;
}

/* 5. 管理員手動建立帳號 */
window.adminCreateUserSubmit = async function() {
  const email = document.getElementById('adm-new-email').value.trim().toLowerCase();
  const pwd = document.getElementById('adm-new-pwd').value.trim();

  // 🌟 前端即時檢查
  const isGmail = email.endsWith('@gmail.com') || email.endsWith('@googlemail.com');
  if (!isGmail) {
    toast('⚠️ 系統僅限使用 @gmail.com 格式之信箱');
    return;
  }

  showProgress('建立帳號中...');

  try {
    const res = await fetch(`${API_BASE_URL}/admin/create-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json','Authorization': `Bearer ${USER.token}` },
      body: JSON.stringify({
        targetEmail: email,
        targetPassword: pwd
      })
    });
    const data = await res.json();

    finishProgress(() => {
      if (data.success) {
        toast('帳號已建立，並開通 ✅');
        // 自動導回會員名單，並重拉最新資料
        openAdminUserList(); 
      } else {
        toast('⚠️ 建立失敗：' + data.message);
      }
    });
  } catch(err) {
    finishProgress(() => toast('連線失敗，無法建立帳號'));
  }
}
/* =========================================================
   管理員專區：黑名單系統 (封鎖名單管理)
   ========================================================= */
window.openAdminBannedList = async function() {
  document.getElementById('sub-title').textContent = '黑名單 (已封鎖信箱)';
  
  // 👇 強制隱藏左上角的 X 按鈕
  const closeBtn = document.querySelector('#sub-page .top-bar .bar-btn');
  if (closeBtn) closeBtn.style.display = 'none';
  // 右上角加入強化版返回按鈕
  document.getElementById('sub-top-right').innerHTML = `
    <button onclick="animateSubPageReturn(this, () => { document.querySelector('#sub-page .top-bar .bar-btn').style.display=''; openAccountStats(); })" style="background:linear-gradient(135deg, #3b82f6, #2563eb); color:#ffffff; border:1px solid #1d4ed8; padding:6px 16px; border-radius:20px; font-size:13px; font-weight:900; cursor:pointer; box-shadow:0 4px 12px rgba(37,99,235,0.3); transition:0.2s; letter-spacing:0.5px; text-shadow:0 1px 2px rgba(0,0,0,0.2);">🔙 返回</button>
  `;
  
  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px; display:flex; flex-direction:column; height:100%;">
      <div style="font-size:13px; color:var(--text-red); background:#fef2f2; border:1px solid #fecdd3; padding:12px; border-radius:12px; margin-bottom:16px; font-weight:700; line-height:1.6;">
        💡 在此列表中的信箱，將永遠無法再次註冊新帳號。<br>若誤鎖，可點擊「解除封鎖」恢復其註冊權利。
      </div>

      <div class="card" style="padding:0; flex:1; overflow-y:auto; border:1px solid var(--border);" id="adm-banned-list-container">
        <div style="text-align:center; color:var(--t3); padding:30px; font-weight:700;">📡 載入黑名單中...</div>
      </div>
    </div>
  `;

  // 取得黑名單
  try {
    const res = await fetch(`${API_BASE_URL}/admin/banned-list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${USER.token}` },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.success) {
      renderAdminBannedList(data.banned);
    } else {
      document.getElementById('adm-banned-list-container').innerHTML = `<div style="text-align:center; color:var(--red); padding:30px; font-weight:700;">⚠️ 載入失敗：${data.message}</div>`;
    }
  } catch(e) {
    document.getElementById('adm-banned-list-container').innerHTML = `<div style="text-align:center; color:var(--red); padding:30px; font-weight:700;">⚠️ 連線失敗，無法取得資料</div>`;
  }
}
window.renderAdminBannedList = function(bannedList) {
  const container = document.getElementById('adm-banned-list-container');
  if (!container) return;

  if (bannedList.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--t3); padding:40px; font-weight:700;">目前沒有任何黑名單 🛡️</div>`;
    return;
  }

  let html = '';
  bannedList.forEach(b => {
    // 轉換時間格式
    const d = new Date(b.createdAt);
    const dateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:16px 12px; border-bottom:1px solid var(--border);">
        <div style="flex:1; overflow:hidden; padding-right:10px;">
          <div style="font-size:15px; font-weight:900; color:var(--red); margin-bottom:6px; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">🚫 ${b.email}</div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:11px; color:#64748b; background:#f1f5f9; padding:2px 6px; border-radius:6px; font-family:var(--mono); font-weight:700; border:1px solid #e2e8f0;">封鎖時間: ${dateStr}</span>
          </div>
        </div>
        <button onclick="adminUnbanUser('${b.email}')" style="background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; padding:8px 12px; border-radius:10px; font-size:13px; font-weight:900; cursor:pointer; flex-shrink:0; box-shadow:0 2px 4px rgba(37,99,235,0.1); transition:0.2s;">解除封鎖</button>
      </div>
    `;
  });
  container.innerHTML = html;
}
window.adminUnbanUser = async function(targetEmail) {
  const ok = await customConfirm(`確定要解除封鎖【 <b>${targetEmail}</b> 】嗎？<br><span style="color:var(--t2); font-size:13px;">解除後，該信箱將可再次註冊帳號。</span>`);
  if(!ok) return;
  
  showProgress('解除封鎖中...');
  try {
    const res = await fetch(`${API_BASE_URL}/admin/unban`, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${USER.token}` },
      body: JSON.stringify({ targetEmail: targetEmail })
    });
    const data = await res.json();
    
    finishProgress(() => {
      if(data.success) {
        toast('已解除封鎖 ✅');
        openAdminBannedList(); // 重新拉取並渲染名單
      } else {
        toast('⚠️ 處理失敗：' + data.message);
      }
    });
  } catch(err) {
    finishProgress(() => toast('連線失敗'));
  }
}

/* =========================================================
   管理員專區：14 天豁免例外名單管理
   ========================================================= */
window.openAdminExceptionList = async function() {
  document.getElementById('sub-title').textContent = '14天豁免例外名單';
  
  const closeBtn = document.querySelector('#sub-page .top-bar .bar-btn');
  if (closeBtn) closeBtn.style.display = 'none';
  document.getElementById('sub-top-right').innerHTML = `
    <button onclick="animateSubPageReturn(this, () => { document.querySelector('#sub-page .top-bar .bar-btn').style.display=''; openAccountStats(); })" style="background:linear-gradient(135deg, #3b82f6, #2563eb); color:#ffffff; border:1px solid #1d4ed8; padding:6px 16px; border-radius:20px; font-size:13px; font-weight:900; cursor:pointer;">🔙 返回</button>
  `;
  
  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px; display:flex; flex-direction:column; height:100%;">
      <div style="font-size:13px; color:#0f766e; background:#ccfbf1; border:1px solid #99f6e4; padding:12px; border-radius:12px; margin-bottom:16px; font-weight:700; line-height:1.6;">
        💡 在此名單中的帳號，將<b>永遠不會因為 14 天未活動而被自動登出</b>。
      </div>

      <div style="display:flex; gap:8px; margin-bottom:16px;">
        <input type="email" id="adm-exc-email" class="finp" placeholder="輸入要豁免的 Email..." style="flex:1; border:2px solid #10b981; font-weight:800;">
        <button onclick="adminAddExceptionSubmit()" style="background:#10b981; color:#fff; border:none; padding:8px 16px; border-radius:12px; font-size:14px; font-weight:800; cursor:pointer; flex-shrink:0;">＋ 新增豁免</button>
      </div>

      <div class="card" style="padding:0; flex:1; overflow-y:auto; border:1px solid var(--border);" id="adm-exc-list-container">
        <div style="text-align:center; color:var(--t3); padding:30px; font-weight:700;">📡 載入豁免名單中...</div>
      </div>
    </div>
  `;

  // 取得例外名單
  try {
    const res = await fetch(`${API_BASE_URL}/admin/exception-list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${USER.token}` },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.success) {
      renderAdminExceptionList(data.exceptions);
    } else {
      document.getElementById('adm-exc-list-container').innerHTML = `<div style="text-align:center; color:var(--red); padding:30px; font-weight:700;">⚠️ 載入失敗：${data.message}</div>`;
    }
  } catch(e) {
    document.getElementById('adm-exc-list-container').innerHTML = `<div style="text-align:center; color:var(--red); padding:30px; font-weight:700;">⚠️ 連線失敗</div>`;
  }
}

function renderAdminExceptionList(exceptions) {
  const container = document.getElementById('adm-exc-list-container');
  if (!container) return;

  if (exceptions.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--t3); padding:40px; font-weight:700;">目前沒有任何豁免帳號 📭</div>`;
    return;
  }

  let html = '';
  exceptions.forEach(item => {
    const d = new Date(item.createdAt);
    const dateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;

    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:16px 12px; border-bottom:1px solid var(--border);">
        <div>
          <div style="font-size:15px; font-weight:900; color:#0f766e;">🛡️ ${item.email}</div>
          <div style="font-size:11px; color:#64748b; margin-top:2px;">加入時間: ${dateStr}</div>
        </div>
        <button onclick="adminRemoveException('${item.email}')" style="background:#fef2f2; color:#ef4444; border:1px solid #fecdd3; padding:6px 12px; border-radius:10px; font-size:12px; font-weight:800; cursor:pointer;">移除豁免</button>
      </div>
    `;
  });
  container.innerHTML = html;
}

window.adminAddExceptionSubmit = async function() {
  const email = document.getElementById('adm-exc-email').value.trim();
  if (!email) { toast('請輸入 Email'); return; }

  showProgress('處理中...');
  try {
    const res = await fetch(`${API_BASE_URL}/admin/add-exception`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${USER.token}` },
      body: JSON.stringify({ targetEmail: email })
    });
    const data = await res.json();
    finishProgress(() => {
      if (data.success) {
        toast('已加入 14 天豁免名單 ✅');
        openAdminExceptionList();
      } else {
        toast('⚠️ ' + data.message);
      }
    });
  } catch(e) { finishProgress(() => toast('連線失敗')); }
}

window.adminRemoveException = async function(targetEmail) {
  const ok = await customConfirm(`確定要移除【 <b>${targetEmail}</b> 】的 14 天豁免權限嗎？`);
  if (!ok) return;

  showProgress('處理中...');
  try {
    const res = await fetch(`${API_BASE_URL}/admin/remove-exception`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${USER.token}` },
      body: JSON.stringify({ targetEmail: targetEmail })
    });
    const data = await res.json();
    finishProgress(() => {
      if (data.success) {
        toast('已移除豁免權限 ✅');
        openAdminExceptionList();
      } else {
        toast('⚠️ ' + data.message);
      }
    });
  } catch(e) { finishProgress(() => toast('連線失敗')); }
}

/* ✨ 新增：管理員編輯系統存取權限 */
function openAdminSystemSettings() {
  document.getElementById('sub-title').textContent = '系統權限設定';
  
  // 👇 強制隱藏左上角的 X 按鈕
  const closeBtn = document.querySelector('#sub-page .top-bar .bar-btn');
  if (closeBtn) closeBtn.style.display = 'none';
  // 右上角加入強化版返回按鈕
  document.getElementById('sub-top-right').innerHTML = `
    <button onclick="animateSubPageReturn(this, () => { document.querySelector('#sub-page .top-bar .bar-btn').style.display=''; openAccountStats(); })" style="background:linear-gradient(135deg, #3b82f6, #2563eb); color:#ffffff; border:1px solid #1d4ed8; padding:6px 16px; border-radius:20px; font-size:13px; font-weight:900; cursor:pointer; box-shadow:0 4px 12px rgba(37,99,235,0.3); transition:0.2s; letter-spacing:0.5px; text-shadow:0 1px 2px rgba(0,0,0,0.2);">🔙 返回</button>
  `;
  
  document.getElementById('sub-body').innerHTML = `
    <div class="card" style="padding:16px;">
      <div style="font-size:12px; color:var(--hint-color); line-height:1.6; font-weight:700; margin-bottom:16px;">
        💡 在此控制 APP 的開放程度。若開啟，訪客必須註冊登入才能新增資料；若關閉，則所有人皆可隨意新增記錄 (資料僅存於他們的本機)。
      </div>
      <div style="border-top:1px dashed var(--border); margin-bottom:16px;"></div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <span style="font-size:15px; font-weight:800; color:var(--t1);">🔒 必須登入才能新增記錄</span>
        <label class="switch">
          <input type="checkbox" id="adm-req-login" ${GLOBAL_REQUIRE_LOGIN ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>

      <div style="border-top:1px dashed var(--border); margin-bottom:16px;"></div>

      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; flex-direction:column; gap:4px;">
          <span style="font-size:15px; font-weight:800; color:var(--t1);">🌐 開放註冊新帳號</span>
          <span style="font-size:11px; color:var(--t3); font-weight:600;">關閉後，登入畫面將隱藏「註冊」按鈕</span>
        </div>
        <label class="switch">
          <input type="checkbox" id="adm-allow-reg" ${GLOBAL_ALLOW_REGISTRATION ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
    </div>
    
    <button onclick="saveAdminSystemSettings()" class="btn-acc" style="width:100%; padding:14px; font-size:15px; font-weight:800; border-radius:var(--rs); box-shadow:0 4px 12px rgba(255,107,53,0.3); margin-top:8px;">✅ 儲存並同步至雲端</button>
  `;
  document.getElementById('sub-page').style.zIndex = '1100'; 
}
/* ✨ 新增：同步系統權限至雲端 */
async function saveAdminSystemSettings() {
  const reqLogin = document.getElementById('adm-req-login').checked;
  const allowReg = document.getElementById('adm-allow-reg').checked;
  
  showProgress('同步設定至伺服器...');

  try {
    const res = await fetch(`${API_BASE_URL}/admin/system`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json','Authorization': `Bearer ${USER.token}` },
      body: JSON.stringify({
        adminEmail: USER.email,
        requireLoginToAdd: reqLogin,
        allowRegistration: allowReg // 👈 傳送註冊開關設定
      })
    });
    const data = await res.json();

    finishProgress(() => {
      if (data.success) {
        GLOBAL_REQUIRE_LOGIN = reqLogin;
        GLOBAL_ALLOW_REGISTRATION = allowReg; 
        toast('系統存取權限，已更新 ✅');
        document.getElementById('sub-page').style.zIndex = '200';
        openAccountStats();
      } else {
        toast('⚠️ 同步失敗：' + data.message);
      }
    });
  } catch(err) {
    finishProgress(() => toast('連線失敗，無法同步設定'));
  }
}

/* ✨ 新增：管理員編輯全域油價設定 */
function openAdminGasPriceEdit() {
  document.getElementById('sub-title').textContent = '全域油價設定';
  
  // 👇 強制隱藏左上角的 X 按鈕
  const closeBtn = document.querySelector('#sub-page .top-bar .bar-btn');
  if (closeBtn) closeBtn.style.display = 'none';
  // 右上角加入強化版返回按鈕
  document.getElementById('sub-top-right').innerHTML = `
    <button onclick="animateSubPageReturn(this, () => { document.querySelector('#sub-page .top-bar .bar-btn').style.display=''; openAccountStats(); })" style="background:linear-gradient(135deg, #3b82f6, #2563eb); color:#ffffff; border:1px solid #1d4ed8; padding:6px 16px; border-radius:20px; font-size:13px; font-weight:900; cursor:pointer; box-shadow:0 4px 12px rgba(37,99,235,0.3); transition:0.2s; letter-spacing:0.5px; text-shadow:0 1px 2px rgba(0,0,0,0.2);">🔙 返回</button>
  `;
  
  // 預設油價
  let gp = { '92': 29.5, '95': 31.0, '98': 33.0 };
  try { 
    const saved = JSON.parse(localStorage.getItem('delivery_global_gas_prices'));
    if (saved) gp = saved;
  } catch(e) {}

  document.getElementById('sub-body').innerHTML = `
    <div class="card" style="display:flex; flex-direction:column; gap:16px; padding:16px;">
      <div style="font-size:12px; color:var(--hint-color); line-height:1.6; font-weight:700;">
        💡 在此設定的油價將會同步給所有外送員，他們新增車輛紀錄時將自動帶入此價格，且一般使用者無法手動修改。
      </div>
      <div style="border-top:1px dashed var(--border);"></div>
      <div class="fg">
        <label style="font-weight:700; color:var(--t1);">92 無鉛汽油 (NT$)</label>
        <input type="number" id="gp-92" class="finp" value="${gp['92']}" step="0.1" style="font-family:var(--mono); font-size:16px; font-weight:700; color:var(--acc);">
      </div>
      <div class="fg">
        <label style="font-weight:700; color:var(--t1);">95 無鉛汽油 (NT$)</label>
        <input type="number" id="gp-95" class="finp" value="${gp['95']}" step="0.1" style="font-family:var(--mono); font-size:16px; font-weight:700; color:var(--acc);">
      </div>
      <div class="fg">
        <label style="font-weight:700; color:var(--t1);">98 無鉛汽油 (NT$)</label>
        <input type="number" id="gp-98" class="finp" value="${gp['98']}" step="0.1" style="font-family:var(--mono); font-size:16px; font-weight:700; color:var(--acc);">
      </div>
    </div>
    
    <button onclick="saveAdminGasPrice()" class="btn-acc" style="width:100%; padding:14px; font-size:15px; font-weight:800; border-radius:var(--rs); box-shadow:0 4px 12px rgba(255,107,53,0.3); margin-top:8px;">✅ 發布全域油價</button>
  `;
  document.getElementById('sub-page').style.zIndex = '1100'; 
}

/* ✨ 修改：管理員真正將油價同步至 Cloudflare KV */
async function saveAdminGasPrice() {
  const gp = {
    '92': pf(document.getElementById('gp-92').value) || 29.5,
    '95': pf(document.getElementById('gp-95').value) || 31.0,
    '98': pf(document.getElementById('gp-98').value) || 33.0
  };

  showProgress('同步油價至伺服器...');

  try {
    const res = await fetch(`${API_BASE_URL}/admin/gas-price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json','Authorization': `Bearer ${USER.token}` },
      body: JSON.stringify({
        adminEmail: USER.email,
        prices: gp
      })
    });
    const data = await res.json();

    finishProgress(() => {
      if (data.success) {
        // 同步成功後，也更新自己手機的本地暫存
        localStorage.setItem('delivery_global_gas_prices', JSON.stringify(gp));
        toast('全域油價「已更新」，並同步至雲端 ✅');
        document.getElementById('sub-page').style.zIndex = '200';
        openAccountStats();
      } else {
        toast('⚠️ 同步失敗：' + data.message);
      }
    });
  } catch(err) {
    finishProgress(() => toast('連線失敗，無法同步油價'));
  }
}
/* 新增：管理員查看在線名單 (加入重新整理) */
window.openAdminOnlineUsers = async function() {
  document.getElementById('sub-title').textContent = '目前在線使用者';

  // 👇 強制隱藏左上角的 X 按鈕
  const closeBtn = document.querySelector('#sub-page .top-bar .bar-btn');
  if (closeBtn) closeBtn.style.display = 'none';
  // 右上角加入強化版返回按鈕
  document.getElementById('sub-top-right').innerHTML = `
    <button onclick="animateSubPageReturn(this, () => { document.querySelector('#sub-page .top-bar .bar-btn').style.display=''; openAccountStats(); })" style="background:linear-gradient(135deg, #3b82f6, #2563eb); color:#ffffff; border:1px solid #1d4ed8; padding:6px 16px; border-radius:20px; font-size:13px; font-weight:900; cursor:pointer; box-shadow:0 4px 12px rgba(37,99,235,0.3); transition:0.2s; letter-spacing:0.5px; text-shadow:0 1px 2px rgba(0,0,0,0.2);">🔙 返回</button>
  `;

  const subBody = document.getElementById('sub-body');
  if (!subBody) return;

  subBody.innerHTML = `
    <div style="text-align:center; padding:40px; color:var(--t3);">
      📡 正在與伺服器連線...
    </div>
  `;

  try {
    const headers = { 
      'Content-Type': 'application/json', 
      'Authorization': `Bearer ${USER.token}` 
    };
    
    const statRes = await fetch(`${API_BASE_URL}/stats?t=${Date.now()}`, { headers }); 
    const statData = await statRes.json();
    
    let listHtml = '';
    if (statData.success && statData.onlineUsers && statData.onlineUsers.length > 0) {
      listHtml = statData.onlineUsers.map(email => `
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:14px; background:#ffffff; padding:12px; border-radius:12px; margin-bottom:8px; border:1px solid #e2e8f0; box-shadow:0 2px 4px rgba(0,0,0,0.02);">
          <span style="font-weight:700; color:#1e293b;">${safeText(email)}</span>
          <span style="color:#10b981; font-weight:900;">在線中</span>
        </div>
      `).join('');
    } else {
      listHtml = `<div class="empty-tip">目前無人上線 (或資料同步中)</div>`;
    }

    subBody.innerHTML = `
      <div style="padding:10px 16px;">
        <div style="font-size:16px; font-weight:900; color:var(--t1); margin-bottom:16px; background:#eff6ff; padding:10px; border-radius:10px;justify-content: space-between;display: flex; flex-direction: row; align-items: center;">
          目前在線人數： ${statData.onlineCount || 0} 人

          <!-- 重新整理按鈕 -->
          <button onclick="openAdminOnlineUsers()" 
                  style="width:45%; background:var(--green); color:#fff; border:none; padding:4px 8px; border-radius:16px; font-size:16px; font-weight:750; box-shadow:0 4px 12px rgba(34,197,94,0.3);margin-bottom:10px; transition:0.2s; cursor:pointer;">
            ↺ 重新整理
          </button>
        </div>
        ${listHtml}
      </div>
    `;
    
  } catch (err) {
    console.error(err);
    subBody.innerHTML = `
      <div style="text-align:center; padding:40px; color:var(--red);">
        ⚠️ 連線失敗<br><br>
        <button onclick="openAdminOnlineUsers()" 
                style="padding:10px 24px; background:var(--red); color:#fff; border:none; border-radius:12px; font-weight:700;">
          重試
        </button>
      </div>`;
  }
};

/* ══ 修正：開啟編輯頁時自動清空欄位資料 ══ */
window.openAnnouncementEdit = function() {
  openOverlay('sub-page');
  
  requestAnimationFrame(() => {
    document.getElementById('sub-title').textContent = '編輯公告';
    const closeBtn = document.querySelector('#sub-page .top-bar .bar-btn');
    if (closeBtn) closeBtn.style.display = 'none';

    document.getElementById('sub-top-right').innerHTML = `
      <button onclick="animateSubPageReturn(this, () => openAccountStats())" style="background:linear-gradient(135deg, #3b82f6, #2563eb); color:#ffffff; border:1px solid #1d4ed8; padding:6px 16px; border-radius:20px; font-size:13px; font-weight:900; cursor:pointer;">🔙 返回</button>
    `;

    const tags = ['改版公告', '新功能公告', 'Bug修復公告', '系統公告'];

    // 💡 這裡將所有欄位設為初始值，不抓取現有公告
    document.getElementById('sub-body').innerHTML = `
      <div style="padding:16px; display:flex; flex-direction:column; gap:16px;">
        <button onclick="animateSubPageReturn(this, () => openAnnouncementManagement())" style="width:100%; padding:12px; background:#f1f5f9; color:#475569; border:2px solid #cbd5e1; border-radius:12px; font-weight:800; font-size:14px; cursor:pointer;">
          📋 進入「公告管理中心」 (查看歷史與回收)
        </button>

        <div style="background: #eff6ff; border:1px solid #bfdbfe; border-radius:16px; padding:14px;">
          <div style="font-size:12px; font-weight:900; color:#2563eb; margin-bottom:10px;">🏷️ 版本資訊</div>
          <div style="display:flex; gap:10px;">
            <div class="fg" style="flex:1;"><label>版本代號</label><input type="text" class="finp" id="ann-ver" value="" placeholder="例: 1.2" style="padding:8px;"></div>
            <div class="fg" style="flex:1.2;"><label>發布日期</label><input type="date" class="finp" id="ann-date" value="${todayStr()}" style="padding:8px;"></div>
          </div>
        </div>

        <div style="background:#fff7ed; padding:15px; border-radius:16px; border:2px solid #fed7aa;">
          <label style="font-size:12px; font-weight:900; color:#64748b; margin-bottom:8px; display:block;">公告標題</label>
          <div style="display:flex; gap:6px; margin-bottom:10px; overflow-x:auto; padding-bottom:4px;">
              ${tags.map(t => `<button type="button" class="tag-btn" onclick="document.getElementById('ann-title').value='${t}'">${t}</button>`).join('')}
          </div>
          <input type="text" class="finp" id="ann-title" value="" placeholder="輸入標題..." style="border:2px solid #3b82f6;">
        </div>

        <div style="background:#fff7ed; padding:15px; border-radius:16px; border:2px solid #fed7aa;">
          <label style="font-size:12px; font-weight:900; color:#64748b; margin-bottom:8px; display:block;">公告內容</label>
          <textarea class="finp" id="ann-content" rows="6" placeholder="輸入公告詳細內容..." style="width:100%; padding:10px;"></textarea>
        </div>

        <div style="background: #f0fdf4; border:1px solid #bbf7d0; border-radius:16px; padding:14px;">
          <div style="font-size:12px; font-weight:900; color:#059669; margin-bottom:10px;">⚙️ 進階設定</div>
          <div class="fg" style="margin-bottom:12px;">
            <label>顯示樣式</label>
            <select class="fsel" id="ann-style" style="padding:8px;">
              <option value="golden-luxury">👑 金框奢華風</option>
              <option value="cute-gold">🌸 櫻花幻境</option>
              <option value="crystal-aurora">💎 極光水晶</option>
              <option value="gem-feast">✨ 華麗寶石盛宴</option>
              <option value="candy-dream">🍭 夢幻糖果王國</option>
            </select>
          </div>
          <div style="display:flex; align-items:center; justify-content:space-between; padding:4px 0;">
            <span style="font-size:14px; font-weight:800;">是否啟用公告</span>
            <label class="switch"><input type="checkbox" id="ann-enabled" checked><span class="slider"></span></label>
          </div>
        </div>

        <button onclick="saveAnnouncement()" class="btn-acc" style="width:100%; padding:16px; font-size:16px; font-weight:900; border-radius:16px; background:#1e293b; color:#fff;">
          🚀 立即發布新公告
        </button>
      </div>
    `;
  });
};
/* ══ 修正：儲存公告（防止覆蓋，自動移入歷史） ══ */
window.saveAnnouncement = function() {
    const ver = document.getElementById('ann-ver').value.trim();
    const title = document.getElementById('ann-title').value.trim();
    const content = document.getElementById('ann-content').value.trim();
    const style = document.getElementById('ann-style').value;
    const date = document.getElementById('ann-date').value || todayStr();

    if (!ver) { toast('⚠️ 錯誤：「版本號」不能為空！'); return; }

    // 初始化容器
    if (!Array.isArray(S.settings.announcements)) S.settings.announcements = [];
    if (!S.settings.annHistory) S.settings.annHistory = [];
    
    // 檢查版本是否重複 (發布中與歷史都要看)
    const isDuplicate = S.settings.announcements.some(a => a.version === ver) || 
                       S.settings.annHistory.some(h => h.version === ver);
    
    if (isDuplicate) {
        toast(`⚠️ 版本 v${ver} 已存在，請更換「版本號」`);
        return;
    }

    // 儲存新公告
    const newAnn = { 
        enabled: document.getElementById('ann-enabled').checked, 
        title, content, style, version: ver, date 
    };

    if (!Array.isArray(S.settings.announcements)) S.settings.announcements = [];
    S.settings.announcements.unshift(newAnn);
    
    // 清除單數格式，統一化數據
    S.settings.announcement = null; 

    // 清除該版本的封鎖
    localStorage.removeItem('ann_block_' + ver);
    sessionStorage.removeItem('ann_read_' + ver); // 舊資料相容清理
    annShownThisVisit.delete(ver); // 同步清除本次停留的暫存記錄，避免剛發布/還原的公告被誤擋

    saveSettings();
    closeOverlay('sub-page');
    toast(`公告 v${ver} ，已發布 ✅`);
    
    // 💡 [修正] 這裡使用 true，強行穿透視窗檢查邏輯
    setTimeout(() => checkAndShowAnnouncement(true), 800);
};
// 獨立出來的實際儲存動作
function performSaveAnnouncement(ver, title, content, style, date) {
    // 若目前有公告且版本不同，移入歷史
    if (S.settings.announcement && S.settings.announcement.version !== ver) {
        const alreadyInHistory = S.settings.annHistory.some(h => h.version === S.settings.announcement.version);
        if (!alreadyInHistory) {
            S.settings.annHistory.unshift(S.settings.announcement);
        }
    }

    // 儲存新公告
    S.settings.announcement = { 
        enabled: document.getElementById('ann-enabled').checked, 
        title, content, style, version: ver, date 
    };
    
    // 💡 [核心修正]：發布新版本時，清除所有可能導致阻擋的本地標記
    localStorage.removeItem('ann_block_' + ver);
    sessionStorage.removeItem('ann_read_' + ver); // 舊資料相容清理
    annShownThisVisit.delete(ver); // 同步清除本次停留的暫存記錄，避免剛發布/還原的公告被誤擋
    localStorage.removeItem('delivery_ann_dismissed_ver'); // 清除舊版全域標記

    saveSettings();
    closeOverlay('sub-page');
    toast(`公告 v${ver} ，已發布 ✅`);
    
    // 發布後立刻嘗試在首頁顯示
    if (S.tab === 'home') setTimeout(() => checkAndShowAnnouncement(), 500);
}
/* ══ 修正：管理中心歷史紀錄補回放大功能 ══ */
window.openAnnouncementManagement = function() {
  document.getElementById('sub-title').textContent = '公告管理中心';
  const topBar = document.querySelector('#sub-page .top-bar');
  topBar.style.background = '#2e1065'; document.getElementById('sub-title').style.color = '#f5f3ff';
  document.getElementById('sub-top-right').innerHTML = `<button onclick="animateSubPageReturn(this, () => { resetHeaderColor(); openAnnouncementEdit(); })" style="background:#f5f3ff; color:#6d28d9; border:none; padding:6px 16px; border-radius:20px; font-size:13px; font-weight:900; cursor:pointer;">🔙 返回</button>`;

  const activeAnns = Array.isArray(S.settings.announcements) ? S.settings.announcements : [];
  const history = S.settings.annHistory || [];
  const styleMap = { 'golden-luxury':'👑 金框','cute-gold':'🌸 櫻花','crystal-aurora':'💎 水晶','gem-feast':'✨ 寶石','candy-dream':'🍭 糖果' };

  let html = `<div style="padding:16px; padding-bottom:80px;">`;

  // 內部元件生成器 (支援發布中與歷史紀錄)
  const buildAnnItem = (ann, idx, isActive) => {
    const escapedContent = ann.content.replace(/'/g, "\\'").replace(/"/g, "&quot;").replace(/\n/g, "\\n");
    const escapedTitle = ann.title.replace(/'/g, "\\'");
    
    return `
      <div style="background:#fff; border:2px solid ${isActive?'#6d28d9':'#e2e8f0'}; border-radius:16px; padding:14px; margin-bottom:12px; box-shadow:0 4px 12px rgba(0,0,0,0.05);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
          <span style="background:${isActive?'#6d28d9':'#64748b'}; color:#fff; padding:2px 8px; border-radius:6px; font-size:11px;">v${ann.version} | ${ann.date}</span>
          <span style="background:#f1f5f9; color:#475569; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:700;">${styleMap[ann.style] || '一般'}</span>
        </div>
        <div style="font-weight:900; color:#1e1b4b; font-size:15px; margin-bottom:6px;">${ann.title}</div>
        
        <!-- 💡 歷史與發布中皆有放大功能 -->
        <div onclick="zoomAnnContent('${escapedTitle}', '${escapedContent}')" style="font-size:12px; color:#475569; background:#f8fafc; padding:10px; border-radius:10px; border:1px solid #e2e8f0; margin-bottom:10px; max-height:60px; overflow:hidden; position:relative; cursor:zoom-in;">
          ${safeText(ann.content)}
          <div style="position:absolute; bottom:0; left:0; right:0; height:20px; background:linear-gradient(transparent, #f8fafc); pointer-events:none;"></div>
        </div>

        ${isActive ? 
          `<button onclick="archiveSpecificToHistory(${idx})" style="width:100%; padding:8px; background:#f5f3ff; color:#6d28d9; border:1px solid #ddd6fe; border-radius:8px; font-size:12px; font-weight:800; cursor:pointer;">📥 收回 (入歷史)</button>` : 
          `<div style="display:flex; justify-content:flex-end; gap:10px;">
            <span onclick="restoreAnnouncement(${idx})" style="color:#2563eb; font-size:12px; cursor:pointer; font-weight:700;">🔄 重新發布</span>
            <span onclick="deleteHistoryAnnouncement(${idx})" style="color:#dc2626; font-size:12px; cursor:pointer; font-weight:700;">🗑 刪除</span>
          </div>`
        }
      </div>`;
  };

  html += `<h4 style="color:#6d28d9; font-size:13px; margin-bottom:10px;">📡 目前發布中 (${activeAnns.length})</h4>`;
  if (activeAnns.length > 0) activeAnns.forEach((ann, i) => html += buildAnnItem(ann, i, true));
  else html += `<div class="empty-tip">無發布中的公告</div>`;

  html += `<h4 style="color:#475569; font-size:13px; margin-bottom:10px; margin-top:30px;">📜 歷史發布紀錄 (${history.length})</h4>`;
  if (history.length > 0) history.forEach((h, i) => html += buildAnnItem(h, i, false));
  else html += `<div class="empty-tip">無歷史紀錄</div>`;

  html += `</div>`;
  document.getElementById('sub-body').innerHTML = html;
};
/* ══ 修正：放大公告內容（解決首行對齊與間距過大問題） ══ */
window.zoomAnnContent = function(title, content) {
    const zoomDiv = document.createElement('div');
    zoomDiv.id = 'ann-zoom-overlay';
    zoomDiv.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:3000000;
        display:flex; align-items:center; justify-content:center; padding:24px;
        backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
    `;
    
    // 1. 處理內容：還原換行符並移除字串前後多餘的空白/換行
    const formattedContent = content.replace(/\\n/g, '\n').trim();

    zoomDiv.innerHTML = `
        <div style="background:#fff; border-radius:24px; width:100%; max-width:340px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 20px 50px rgba(0,0,0,0.5); animation: ann-card-pop 0.3s ease-out;">
            <!-- 頂部 Header -->
            <div style="background:#f1f5f9; padding:16px 20px; border-bottom:1px solid #e2e8f0; display:flex; align-items:center;">
                <div style="width:24px;"></div>
                <span style="flex:1; text-align:center; font-weight:900; color:#1e293b; font-size:16px; letter-spacing:1px;">公告內容全文</span>
                <span onclick="this.closest('#ann-zoom-overlay').remove()" style="width:24px; font-size:24px; color:#94a3b8; cursor:pointer; text-align:right; line-height:1;">✕</span>
            </div>

            <!-- 內容區 -->
            <div style="padding:12px 20px 24px 20px; max-height:60vh; overflow-y:auto; background:#ffffff; display:flex; flex-direction:column; align-items:flex-start;">
                <!-- 公告標題：下邊距縮小到 4px -->
                <div style="font-weight:900; font-size:18px; color:#2563eb; margin:0 0 4px 0; border-left:4px solid #2563eb; padding:2px 0 2px 12px; line-height:1.4; text-align:left; width:100%;">
                    ${title}
                </div>
                <!-- 公告內文：使用 trim() 確保首行靠左，移除所有繼承的置中屬性 -->
                <div style="font-size:15px; line-height:1.7; color:#334155; white-space:pre-wrap; text-align:left; width:100%; word-break:break-all; display:block;">${safeText(formattedContent)}</div>
            </div>

            <!-- 底部按鈕 -->
            <div style="padding:12px 20px; background:#f8fafc; text-align:center; border-top:1px solid #f1f5f9;">
                <button onclick="this.closest('#ann-zoom-overlay').remove()" style="width:100%; padding:12px; background:#1e293b; color:#fff; border:none; border-radius:12px; font-weight:800; cursor:pointer;">關閉視窗</button>
            </div>
        </div>
    `;
    
    zoomDiv.onclick = function(e) { if (e.target === zoomDiv) zoomDiv.remove(); };
    document.body.appendChild(zoomDiv);
};
// 收回特定公告
window.archiveSpecificToHistory = function(idx) {
    const target = S.settings.announcements[idx];
    if (!S.settings.annHistory) S.settings.annHistory = [];
    S.settings.annHistory.unshift(target);
    S.settings.announcements.splice(idx, 1);
    saveSettings();
    toast('公告，已收回 ✅');
    openAnnouncementManagement();
};

// 重新發布並解鎖
window.restoreAnnouncement = function(idx) {
    const target = S.settings.annHistory[idx];
    const ver = target.version;
    if (!Array.isArray(S.settings.announcements)) S.settings.announcements = [];
    
    S.settings.announcements.unshift(target);
    S.settings.annHistory.splice(idx, 1);

    // 💡 關鍵修正：解鎖
    localStorage.removeItem('ann_block_' + ver);
    sessionStorage.removeItem('ann_read_' + ver); // 舊資料相容清理
    annShownThisVisit.delete(ver); // 同步清除本次停留的暫存記錄，避免剛發布/還原的公告被誤擋
    
    saveSettings();
    toast(`🚀 v${ver} ，已重新發布`);
    openAnnouncementManagement();
};
// 刪除公告
window.deleteHistoryAnnouncement = function(idx) {
    customConfirm('確定要永久刪除，這筆歷史紀錄嗎？').then(ok => {
        if (ok) {
            S.settings.annHistory.splice(idx, 1);
            saveSettings();
            openAnnouncementManagement();
        }
    });
};
// 輔助功能：還原 Header 顏色
function resetHeaderColor() {
  const topBar = document.querySelector('#sub-page .top-bar');
  topBar.style.background = '#ffffff';
  document.getElementById('sub-title').style.color = '#2563eb';
}
// 功能：撤回公告
window.deleteActiveAnnouncement = async function() {
  const ok = await customConfirm("確定要撤回此公告嗎？<br>撤回後使用者將不再看到它。");
  if (!ok) return;
  
  // 移入歷史
  if (!S.settings.annHistory) S.settings.annHistory = [];
  S.settings.annHistory.unshift(S.settings.announcement);
  
  // 清空當前公告
  S.settings.announcement = null;
  saveSettings();
  toast("「公告」已撤回 ✅");
  openAnnouncementManagement();
};



// 版本紀錄
/* ══ 智慧版本內文渲染 (修正對齊與縮小行距) ══ */
function renderVersionNote(note) {
  if (!note) return '';
  let safe = escapeHtml(note);
  
  let lines = safe.split('\n');
  let formattedLines = lines.map(line => {
    let hasTag = /^(?:\[(\d+)\]|(\d+)\.)\s*(.*)/.test(line);
    if (hasTag) {
      return line.replace(/^(?:\[(\d+)\]|(\d+)\.)\s*(.*)/g, (match, p1, p2, rest) => {
        const num = p1 || p2;
        return `<div style="display:flex; align-items:center; gap:4px;margin-bottom:5px;"><span style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; background:#2563eb; color:#ffffff; border-radius:50%; font-weight:900; font-size:12px; font-family:var(--mono); line-height:1;">${num}</span><span style="font-weight:750; color:#1e293b; flex:1; line-height:1.3;">${rest}</span></div>`;
      });
    }
    return line ? line + '<br>' : '';
  });
  
  return formattedLines.join('');
}

/* ══ 快速插入數字標籤至光標位置 ══ */
window.insertVersionTag = function(num, textareaId) {
  const el = document.getElementById(textareaId);
  if (!el) return;
  const tag = `[${num}] `;
  const start = el.selectionStart || 0;
  const end = el.selectionEnd || 0;
  const val = el.value;
  
  // 如果前方有字且不是換行，自動補換行
  let prefix = (start > 0 && val[start - 1] !== '\n') ? '\n' : '';
  
  el.value = val.substring(0, start) + prefix + tag + val.substring(end);
  el.focus();
  el.selectionStart = el.selectionEnd = start + prefix.length + tag.length;
};

// 5. 版本紀錄內容摺疊
window.toggleVersionCollapse = function(idx) {
  const body = document.getElementById(`ver-body-${idx}`);
  const btn = document.getElementById(`ver-toggle-btn-${idx}`);
  const icon = document.getElementById(`ver-toggle-icon-${idx}`);
  if (!body) return;
  if (navigator.vibrate) try { navigator.vibrate(12); } catch(e){}

  const isCollapsed = body.style.maxHeight === '0px' || body.style.maxHeight === '';
  requestAnimationFrame(() => {
    if (isCollapsed) {
      body.style.maxHeight = body.scrollHeight + 60 + 'px';
      if (icon) icon.style.transform = 'rotate(180deg)';
      if (btn) btn.innerHTML = '▲ 收起內容';
    } else {
      body.style.maxHeight = '0px';
      if (icon) icon.style.transform = 'rotate(0deg)';
      if (btn) btn.innerHTML = '▼ 展開內容';
    }
  });
};

// 版本紀錄
// 1. 統一的開啟版本紀錄 (進入點)
window.openVersionHistory = function() {
  document.getElementById('sub-title').textContent = '版本紀錄';

  // 右上角：admin 才顯示「新增紀錄」
  document.getElementById('sub-top-right').innerHTML = USER.role === 'admin'
    ? `<button onclick="openAddVersion()" class="btn-acc" style="padding:6px 14px; border-radius:20px; font-size:13px;">＋ 新增紀錄</button>`
    : '';

  // 排序：將日期轉為時間戳記進行降冪排序
  const versions = Array.isArray(S.settings.versions) ? [...S.settings.versions] : [];
  versions.sort((a, b) => new Date(b.date) - new Date(a.date));

  let html = `<div class="version-container">`;
  
  if (versions.length > 0) {
    versions.forEach((v, idx) => {
      const isLatest = (idx === 0);

      html += `
        <div class="version-item ${isLatest ? 'latest' : ''}">
          <div class="version-dot"></div>
          <div class="version-card">
            <!-- 點擊 Header 可展開/收起 -->
            <div class="version-header" onclick="toggleVersionCollapse(${idx})">
              <span class="version-ver">
                  <span style="margin-right:4px;">v</span>${safeText(v.ver)} 
                  ${isLatest ? '<span class="version-ver-badge">最新</span>' : ''}
              </span>
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="version-date">${safeText(v.date)}</span>
                <span id="ver-toggle-icon-${idx}" style="font-size:12px; transition:transform 0.3s ease; color:#2563eb; font-weight:900; transform:rotate(0deg);">▼</span>
              </div>
            </div>

            <!-- 🌟 摺疊內容區：預設全部關閉 (max-height: 0px) -->
            <div id="ver-body-${idx}" style="max-height:0px; overflow:hidden; transition:max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1);">
              <div class="version-body">${renderVersionNote(v.note)}</div>
              
              <!-- 操作按鈕區 (跳過權限限制) -->
              <div style="padding:8px 16px 12px; display:flex; justify-content:space-between; align-items:center; border-top:1.5px dashed #e2e8f0; margin-top:4px;">
                <button id="ver-toggle-btn-${idx}" onclick="event.stopPropagation(); toggleVersionCollapse(${idx})" style="background:transparent; border:none; color:#2563eb; font-size:12px; font-weight:800; cursor:pointer; padding:0;">
                  ▼ 展開內容
                </button>
                <div style="display:flex; gap:8px;">
                  <button onclick="openEditVersion('${v.ver}')" class="btn-acc" style="padding:4px 12px; font-size:11px; font-weight:800;">編輯</button>
                  <button onclick="deleteVersion('${v.ver}')" style="padding:4px 12px; font-size:11px; font-weight:800; background:#fef2f2; color:#dc2626; border:1px solid #fecdd3; border-radius:12px; cursor:pointer;">刪除</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    });
  } else {
    html += `<div class="empty-tip">目前尚無版本更新紀錄</div>`;
  }
  
  html += `</div>`;
  document.getElementById('sub-body').innerHTML = html;

  // 左上角 X 改為 flipCloseOverlay
  const closeBtn = document.querySelector('#sub-page .top-bar .bar-btn');
  if (closeBtn) {
    closeBtn.style.display = '';
    closeBtn.onclick = function() { flipCloseOverlay(this, 'sub-page'); };
  }

  document.getElementById('sub-page').style.zIndex = '1100';
  openOverlay('sub-page');
};

// 2. 新增版本頁面 (含圓形藍底白字數字快捷標籤)
window.openAddVersion = function() {
  document.getElementById('sub-title').textContent = '新增版本';
  const closeBtn = document.querySelector('#sub-page .top-bar .bar-btn');
  if (closeBtn) closeBtn.style.display = 'none';

  document.getElementById('sub-top-right').innerHTML = `
    <button onclick="animateSubPageReturn(this, () => openVersionHistory())" class="btn-acc" style="padding:6px 14px; border-radius:20px; font-size:13px;">🔙 返回</button>
  `;

  // 生成 1~10 的數字按鈕
  let numTagsHtml = '';
  for (let i = 1; i <= 10; i++) {
    numTagsHtml += `<button type="button" onclick="insertVersionTag(${i}, 'new-note')" style="width:26px; height:26px; border-radius:50%; background:#2563eb; color:#ffffff; border:none; font-size:12px; font-weight:900; font-family:var(--mono); cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 4px rgba(37,99,235,0.25); flex-shrink:0; transition:transform 0.15s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">${i}</button>`;
  }

  document.getElementById('sub-body').innerHTML = `
    <div style="padding:20px;">
      <div class="fg"><label>版本號</label><input type="text" class="finp" id="new-ver" value="1.15.117"></div>
      <div class="fg"><label>日期</label><input type="date" class="finp" id="new-date" value="${todayStr()}"></div>
      <div class="fg">
        <label style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span>內容</span>
          <span style="font-size:11px; color:#2563eb; font-weight:800;">點擊快速插入標籤 ➔</span>
        </label>
        <div style="display:flex; gap:8px; overflow-x:auto; padding:4px 2px 8px 2px; margin-bottom:6px;" class="hide-scroll">
          ${numTagsHtml}
        </div>
        <textarea class="finp" id="new-note" rows="6" placeholder="點擊上方數字標籤可快速新增項次..."></textarea>
      </div>
      <button onclick="saveNewVersion()" class="btn-acc" style="width:100%; padding:14px; margin-top:12px;">儲存</button>
    </div>
  `;
};

// 3. 編輯版本頁面
window.openEditVersion = function(ver) {
  const v = S.settings.versions.find(x => x.ver === ver);
  if (!v) return;

  document.getElementById('sub-title').textContent = '編輯版本紀錄';
  const closeBtn = document.querySelector('#sub-page .top-bar .bar-btn');
  if (closeBtn) closeBtn.style.display = 'none';

  document.getElementById('sub-top-right').innerHTML = `
    <button onclick="animateSubPageReturn(this, () => openVersionHistory())" class="btn-acc" style="padding:6px 14px; border-radius:20px; font-size:13px;">🔙 返回</button>
  `;

  let numTagsHtml = '';
  for (let i = 1; i <= 10; i++) {
    numTagsHtml += `<button type="button" onclick="insertVersionTag(${i}, 'edit-note')" style="width:26px; height:26px; border-radius:50%; background:#2563eb; color:#ffffff; border:none; font-size:12px; font-weight:900; font-family:var(--mono); cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 4px rgba(37,99,235,0.25); flex-shrink:0; transition:transform 0.15s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">${i}</button>`;
  }

  document.getElementById('sub-body').innerHTML = `
    <div style="padding:20px;">
      <div class="fg"><label>版本號</label><input type="text" class="finp" id="edit-ver" value="${safeText(v.ver)}" readonly style="background:#f1f5f9;"></div>
      <div class="fg"><label>日期</label><input type="date" class="finp" id="edit-date" value="${v.date}"></div>
      <div class="fg">
        <label style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span>內容</span>
          <span style="font-size:11px; color:#2563eb; font-weight:800;">點擊快速插入標籤 ➔</span>
        </label>
        <div style="display:flex; gap:8px; overflow-x:auto; padding:4px 2px 8px 2px; margin-bottom:6px;" class="hide-scroll">
          ${numTagsHtml}
        </div>
        <textarea class="finp" id="edit-note" rows="6">${safeText(v.note)}</textarea>
      </div>
      <button onclick="saveEditVersion()" class="btn-acc" style="width:100%; padding:14px; margin-top:12px;">更新儲存</button>
    </div>
  `;
};
window.saveNewVersion = function() {
  if (!S.settings.versions) S.settings.versions = [];
  
  S.settings.versions.unshift({
    ver: (document.getElementById('new-ver').value || '1.0.0').trim(),
    date: document.getElementById('new-date').value || todayStr(),
    note: (document.getElementById('new-note').value || '').trim()
  });
  
  saveSettings();
  toast('版本紀錄，已新增 ✅');
  openVersionHistory(); // 直接呼叫函式重新渲染即可，無需 setTimeout
};
window.saveEditVersion = function() {
  const ver = document.getElementById('edit-ver').value;
  const note = document.getElementById('edit-note').value;
  const date = document.getElementById('edit-date').value;

  const v = S.settings.versions.find(x => x.ver === ver);
  if (v) {
    v.note = note;
    v.date = date;
    saveSettings();
    toast('版本，已更新 ✅');
    openVersionHistory();
  }
};
// 刪除版本
window.deleteVersion = async function(ver) {
  const ok = await customConfirm(`確定要刪除版本 v${ver} 嗎？`);
  if (!ok) return;

  S.settings.versions = S.settings.versions.filter(x => x.ver !== ver);
  saveSettings();
  toast('🗑️ 版本紀錄，已刪除');
  openVersionHistory();
};

/* ══ 踢下線檢查 (處理強制登出與 31 天未活動) ══ */
/* ══ 檢查帳號狀態 (新增同步浮水印設定) ══ */
async function checkAccountStatus() {
  if (!USER.loggedIn) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/auth/check`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${USER.token}` 
      },
      body: JSON.stringify({ email: USER.email }) 
    });
    const data = await res.json();
    
    if (data.active) {
      // 🌟 關鍵：將最新權限更新到記憶體
      USER.removeWatermark = data.removeWatermark; 
      saveUser(); // 存入 localStorage，下次重開才會生效

      return true;
    } else {
      // 處理登出邏輯 (原本的踢下線、過期等)
      logoutAccount(); 
      return false;
    }
  } catch(e) {
    return true; // 網路斷線時維持現狀
  }
}

// 攔截 confirmAddRecord (新增記錄) 加入檢查
const originalConfirmAddRecord = confirmAddRecord;
confirmAddRecord = async function() {
  if (GLOBAL_REQUIRE_LOGIN && !USER.loggedIn) { 
    showLoginRequiredWarning(); 
    return; 
  }
  // 呼叫原本的儲存函式
  await originalConfirmAddRecord();
}

/* ══ 登出清空權限 ══ */
function logoutAccount() {
  USER = { email: null, verified: false, loggedIn: false, role: 'user', uid: null };
  saveUser();
  
  window.__authFlowLocked = false;
  localStorage.removeItem('auth_flow_active');
  localStorage.removeItem('auth_last_active');
  localStorage.removeItem('auth_origin_tab');

  // 🌟 [新增] 強制重新渲染設定頁面
  renderSettings();

  toast('已「登出帳號」✅');
  
  if (S.tab === 'settings') {
    renderSettings(); // 雙重確保
  } else if (S.tab === 'home') {
    renderHome();
  } else {
    goPage('home');
  }
  
  closeOverlay('sub-page'); 
}

/* ══ 升級版：外觀與主題設定 (深色模式與自訂背景) ══ */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', 'light');
}

function applyBackground() {
  document.body.style.background = '';
  document.body.style.boxShadow = 'none';
}

/* ══ 全新美化版：平台列表與規則設定 ══ */
function openPlatformList() {
  document.getElementById('sub-title').textContent = '平台列表與規則';
  document.getElementById('sub-top-right').innerHTML = `<button onclick="closeOverlay('sub-page'); goPage('home');" style="background:var(--t1); color:#fff; border:none; padding:6px 14px; border-radius:16px; font-size:13px; font-weight:700; cursor:pointer; box-shadow:0 4px 10px rgba(0,0,0,0.15);">完成</button>`;
  
  const platforms = Array.isArray(S.platforms) ? S.platforms : DEFAULT_PLATFORMS.map(p => ({ ...p }));
  
  let listHtml = '';
  platforms.forEach(p => {
    // 動態生成每個平台的專屬開關顏色 (開啟時，開關會變成該平台的顏色)
    const switchStyle = `
      <style>
        #switch-${p.id}:checked + .slider { background-color: ${p.color} !important; }
        #switch-${p.id}:checked + .slider:before { box-shadow: 0 2px 6px ${p.color}80; }
      </style>
    `;
    
    listHtml += `
      ${switchStyle}
      <div style="background:#fff; border: 2px solid ${p.active ? p.color : 'var(--border)'}; border-radius:20px; padding:16px; margin-bottom:16px; box-shadow:0 8px 20px rgba(0,0,0,0.03); display:flex; align-items:flex-start; gap:14px; transition:0.3s; position:relative; overflow:hidden;">
        
        <!-- 背景裝飾圓圈 (啟用時顯示) -->
        <div style="position:absolute; right:-20px; top:-20px; width:100px; height:100px; background:${p.color}; opacity:${p.active ? '0.05' : '0'}; border-radius:50%; z-index:0; transition:0.3s;"></div>
        
        <!-- 平台大寫字母圖示 -->
        <div style="width:50px; height:50px; border-radius:14px; background:${p.active ? p.color+'15' : 'var(--sf2)'}; color:${p.active ? p.color : 'var(--t3)'}; display:flex; align-items:center; justify-content:center; font-size:26px; font-weight:900; flex-shrink:0; z-index:1; transition:0.3s; border:1px solid ${p.active ? p.color+'40' : 'transparent'};">
          ${safeText(p.name).charAt(0).toUpperCase()}
        </div>
        
        <!-- 平台資訊區 -->
        <div style="flex:1; z-index:1;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div style="font-size:18px; font-weight:900; color:${p.active ? 'var(--t1)' : 'var(--t2)'}; transition:0.3s;">${safeText(p.name)}</div>
            
            <!-- 專屬顏色的滑動開關 -->
            <label class="switch">
              <input type="checkbox" id="switch-${p.id}" ${p.active ? 'checked' : ''} onchange="togglePlatform('${safeText(p.id)}', this.checked)">
              <span class="slider"></span>
            </label>
          </div>
          
          <!-- 狀態標籤 -->
          <div style="margin-bottom:12px;">
            ${p.active 
              ? `<span style="background:${p.color}15; color:${p.color}; font-size:11px; padding:4px 10px; border-radius:8px; font-weight:800; border:1px solid ${p.color}30;">✅ 狀態：已啟用</span>` 
              : `<span style="background:var(--bg-input); color:var(--t3); font-size:11px; padding:4px 10px; border-radius:8px; font-weight:800; border:1px solid var(--border);">❌ 狀態：未啟用</span>`
            }
          </div>
          
          <!-- 結算與發薪規則 -->
          <div style="font-size:12px; color:${p.active ? 'var(--t2)' : 'var(--t3)'}; font-weight:600; line-height:1.6; background:${p.active ? '#f8fafc' : 'transparent'}; padding:${p.active ? '10px' : '0'}; border-radius:10px; border:1px dashed ${p.active ? '#cbd5e1' : 'transparent'}; transition:0.3s;">
            <span style="font-weight:800; color:${p.active ? 'var(--text-blue)' : 'var(--t3)'}; margin-bottom:4px; display:block;">📝 結算與發薪規則：</span>
            ${p.ruleDesc ? p.ruleDesc.replace(/｜/g, '<br>') : '無特定規則'}
          </div>
        </div>
      </div>
    `;
  });

  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px;">
      <div style="font-size:13px; color:var(--hint-color); line-height:1.6; font-weight:700; margin-bottom:20px; background:var(--blue-d); padding:12px; border-radius:12px;">
        💡 啟用您有在跑的平台，開啟後即可於首頁與新增記錄中選擇。
      </div>
      ${listHtml}
    </div>
  `;
  openOverlay('sub-page');
}
/* 快速開關狀態切換函式 */
window.togglePlatform = function(id, isChecked) {
  const p = S.platforms.find(x => x.id === id);
  if (p) {
    p.active = isChecked;
    savePlatforms();
    if (S.tab === 'home') renderHome();
    renderSettings();
    openPlatformList(); // 重新渲染列表以更新卡片狀態與顏色
  }
}

/* ══ 收入目標設定 (精美卡片化設計) ══ */
function openGoalSettings() { 
  document.getElementById('sub-title').textContent = '收入目標設定'; 
  document.getElementById('sub-top-right').innerHTML = '';
  document.getElementById('sub-add-btn')?.style.setProperty('display', 'none'); 
  const g = S.settings.goals || {}; 
  
  const wVal = g.weekly > 0 ? g.weekly : '';
  const mVal = g.monthly > 0 ? g.monthly : '';
  const yVal = g.yearly > 0 ? g.yearly : '';

  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px; padding-bottom:32px;">
      <div style="font-size:13px; color:var(--hint-color); line-height:1.6; font-weight:700; margin-bottom:20px; background:var(--blue-d); padding:12px 16px; border-radius:12px; border:1px solid #bfdbfe;">
        💡 設定您的外送收入目標。<br>設定後即可在首頁的「目標進度」頁籤追蹤您的達標狀況與剩餘天數！
      </div>
      
      <div style="background:#ffffff; border-radius:24px; padding:16px 14px; border:2px solid #e2e8f0;">
        <div style="display:flex; flex-direction:column; gap:16px;">
          
          <!-- 週目標卡片 -->
          <div style="background:linear-gradient(135deg, #eff6ff 0%, #ffffff 100%); border:2px solid #bfdbfe; border-radius:20px; padding:16px; box-shadow:0 6px 16px rgba(37,99,235,0.06); position:relative; overflow:hidden;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="width:40px; height:40px; background:#dbeafe; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:20px; box-shadow:inset 0 -2px 4px rgba(0,0,0,0.05);">🏃</div>
                <div>
                  <div style="font-size:15px; font-weight:900; color:#1e3a8a; letter-spacing:0.5px;">本週目標</div>
                  <div style="font-size:11px; font-family:var(--mono); color:#3b82f6; font-weight:700;">Weekly Goal</div>
                </div>
              </div>
            </div>
            <div style="position:relative;">
              <span style="position:absolute; left:16px; top:50%; transform:translateY(-50%); font-size:16px; font-weight:900; color:#2563eb; font-family:var(--mono);">NT$</span>
              <input type="number" id="g-weekly" value="${wVal}" placeholder="請輸入金額" inputmode="decimal" style="width:100%; padding:14px 16px 14px 60px; background:#ffffff; border:1.5px solid #93c5fd; border-radius:12px; font-family:var(--mono); font-size:20px; font-weight:900; color:#1d4ed8; outline:none; transition:0.2s;">
            </div>
          </div>
          
          <!-- 月目標卡片 -->
          <div style="background:linear-gradient(135deg, #f3e8ff 0%, #ffffff 100%); border:2px solid #e9d5ff; border-radius:20px; padding:16px; box-shadow:0 6px 16px rgba(168,85,247,0.06); position:relative; overflow:hidden;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="width:40px; height:40px; background:#f3e8ff; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:20px; box-shadow:inset 0 -2px 4px rgba(0,0,0,0.05);">🔥</div>
                <div>
                  <div style="font-size:15px; font-weight:900; color:#581c87; letter-spacing:0.5px;">本月目標</div>
                  <div style="font-size:11px; font-family:var(--mono); color:#9333ea; font-weight:700;">Monthly Goal</div>
                </div>
              </div>
            </div>
            <div style="position:relative;">
              <span style="position:absolute; left:16px; top:50%; transform:translateY(-50%); font-size:16px; font-weight:900; color:#9333ea; font-family:var(--mono);">NT$</span>
              <input type="number" id="g-monthly" value="${mVal}" placeholder="請輸入金額" inputmode="decimal" style="width:100%; padding:14px 16px 14px 60px; background:#ffffff; border:1.5px solid #d8b4fe; border-radius:12px; font-family:var(--mono); font-size:20px; font-weight:900; color:#7e22ce; outline:none; transition:0.2s;">
            </div>
          </div>

          <!-- 年目標卡片 -->
          <div style="background:linear-gradient(135deg, #f0fdfa 0%, #ffffff 100%); border:2px solid #99f6e4; border-radius:20px; padding:16px; box-shadow:0 6px 16px rgba(13,148,136,0.06); position:relative; overflow:hidden;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="width:40px; height:40px; background:#ccfbf1; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:20px; box-shadow:inset 0 -2px 4px rgba(0,0,0,0.05);">👑</div>
                <div>
                  <div style="font-size:15px; font-weight:900; color:#134e4a; letter-spacing:0.5px;">全年目標</div>
                  <div style="font-size:11px; font-family:var(--mono); color:#0d9488; font-weight:700;">Yearly Goal</div>
                </div>
              </div>
            </div>
            <div style="position:relative;">
              <span style="position:absolute; left:16px; top:50%; transform:translateY(-50%); font-size:16px; font-weight:900; color:#0d9488; font-family:var(--mono);">NT$</span>
              <input type="number" id="g-yearly" value="${yVal}" placeholder="請輸入金額" inputmode="decimal" style="width:100%; padding:14px 16px 14px 60px; background:#ffffff; border:1.5px solid #5eead4; border-radius:12px; font-family:var(--mono); font-size:20px; font-weight:900; color:#0f766e; outline:none; transition:0.2s;">
            </div>
          </div>
        </div>
      </div>
      
      <button onclick="saveGoals()" class="btn-acc" style="width:100%; padding:16px; font-size:16px; font-weight:900; border-radius:16px; box-shadow:0 8px 24px rgba(255,107,53,0.3); margin-top:24px;">
        💾 儲存收入目標設定
      </button>
    </div>
    
    <style>
      /* 讓聚焦時邊框發光 */
      #g-weekly:focus { box-shadow: 0 0 0 4px rgba(59,130,246,0.15); border-color: #3b82f6 !important; }
      #g-monthly:focus { box-shadow: 0 0 0 4px rgba(168,85,247,0.15); border-color: #a855f7 !important; }
      #g-yearly:focus { box-shadow: 0 0 0 4px rgba(13,148,136,0.15); border-color: #0d9488 !important; }
    </style>
  `; 
  openOverlay('sub-page'); 
}
function saveGoals() { 
  S.settings.goals = { 
    weekly: pf(document.getElementById('g-weekly').value), 
    monthly: pf(document.getElementById('g-monthly').value),
    yearly: pf(document.getElementById('g-yearly').value)
  }; 
  saveSettings(); 
  closeOverlay('sub-page'); 
  renderSettings(); 
  if(S.tab === 'home') renderHome();
  toast('目標設定，已儲存 ✅'); 
}

/* ══ 進階獎勵項目清單與設定 (支援折疊、停用、刪除) ══ */
let editingRewardId = null;
let tempTiers = [];

function openRewardSettings() {
  document.getElementById('sub-title').textContent = '獎勵項目設定';
  document.getElementById('sub-top-right').innerHTML = `<button onclick="openAddReward()" style="background:var(--acc); color:#fff; border:none; padding:6px 14px; border-radius:16px; font-size:13px; font-weight:900; cursor:pointer; box-shadow:0 2px 6px rgba(255,107,53,0.3);">＋ 新增</button>`;

  let html = `<div style="padding:16px; display:flex; flex-direction:column; gap:12px;">`;
  
  if (!S.settings.rewards || S.settings.rewards.length === 0) {
    html += `<div class="empty-tip">目前無設定任何獎勵</div>`;
  } else {
    // 1. 將獎勵依照平台分群
    const groupedRewards = {};
    S.settings.rewards.forEach(r => {
      if (!groupedRewards[r.platformId]) groupedRewards[r.platformId] = [];
      groupedRewards[r.platformId].push(r);
    });

    // 2. 針對每個平台繪製一個「可折疊的卡片框」
    for (let platId in groupedRewards) {
      const plat = getPlatform(platId);
      const platColor = plat.color || '#94a3b8';
      const platName = plat.name || '未知平台';
      const rList = groupedRewards[platId];

      html += `
      <div style="background:#ffffff; border-radius:16px; border:2px solid ${platColor}50; box-shadow:0 4px 12px rgba(0,0,0,0.02); overflow:hidden;">
        
        <!-- 平台群組頭部 (點擊可展開/收起) -->
        <div onclick="toggleRewardGroup('${platId}')" style="background:${platColor}15; padding:12px 16px; display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="background:${platColor}; color:#fff; width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-weight:900;">${platName.charAt(0)}</span>
            <span style="font-size:16px; font-weight:900; color:var(--t1);">${platName}</span>
            <span style="background:#fff; color:${platColor}; font-size:16px; font-weight:900; padding:4px 12px; border-radius:8px; margin-left:4px;">${rList.length} <span style="font-size:10px; font-weight:500;">組</span></span>
          </div>
          <div id="rw-grp-icon-${platId}" style="color:${platColor};font-size:22px;font-weight:900;transition:0.3s;transform:rotate(0deg);">▼</div>
        </div>

        <!-- 👇 修改 1：拔除外層 padding，讓折疊時高度能真正歸零，不會露出一截白邊 -->
        <div id="rw-grp-body-${platId}" style="max-height:0px; overflow:hidden; transition:max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1);">
          <!-- 將 padding 移到內層容器 -->
          <div style="display:flex; flex-direction:column; gap:10px; padding:12px;">
      `;

      // 3. 繪製清單內部卡片
      rList.forEach(r => {
        const isSystem = ['fp_m_w', 'fp_t_s', 'fp_sun'].includes(r.id);
        const isActive = r.active !== false; 
        
        let dateStr = r.recurring 
          ? '🔄 每週自動循環' 
          : `📅 ${r.startDate.substring(5)} ${r.startTime||'00:00'} ~ ${r.endDate.substring(5)} ${r.endTime||'23:59'}`;
          
        let tiersHtml = (r.tiers || []).map(t => `<span style="background:var(--sf2); padding:3px 8px; border-radius:6px; font-size:10px; font-weight:800; font-family:var(--mono); color:var(--t2);">滿${t.orders}單 $${t.amount}</span>`).join('');

        let actionHtml = '';
        if (isSystem) {
          actionHtml = `<span style="background:var(--sf2); color:var(--t3); padding:4px 10px; border-radius:8px; font-size:11px; font-weight:800; border:1px dashed var(--border);">🔒 內建模板不可改</span>`;
        } else {
          actionHtml = `
            <div style="display:flex; align-items:center; gap:8px;">
              <label class="switch" style="transform: scale(0.8); margin-right:4px;">
                <input type="checkbox" ${isActive ? 'checked' : ''} onchange="toggleRewardActive('${r.id}', this.checked)">
                <span class="slider"></span>
              </label>
              <button onclick="openEditReward('${r.id}')" style="background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; padding:6px 12px; border-radius:8px; font-size:12px; font-weight:800; cursor:pointer; box-shadow:0 2px 4px rgba(37,99,235,0.05); transition:0.2s;">編輯</button>
              <button onclick="deleteReward('${r.id}')" style="background:#fef2f2; color:#dc2626; border:1px solid #fecdd3; padding:6px 12px; border-radius:8px; font-size:12px; font-weight:800; cursor:pointer; box-shadow:0 2px 4px rgba(220,38,38,0.05); transition:0.2s;">刪除</button>
            </div>
          `;
        }

        html += `
          <!-- 👇 修改 2：內部卡片邊框套用平台專屬顏色，並加入左側粗色條，提升一體感 -->
          <div style="border: 2px solid ${isActive ? platColor+'30' : '#e2e8f0'}; border-radius:12px; padding:12px 12px 12px 16px; opacity:${isActive ? '1' : '0.5'}; transition:0.3s; background:${isActive ? '#fff' : '#f8fafc'}; position:relative; overflow:hidden;">
            
            <div style="position:absolute; left:0; top:0; bottom:0; width:5px; background:${isActive ? platColor : '#cbd5e1'};"></div>

            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
              <span style="font-size:15px; font-weight:900; color:var(--t1);">${safeText(r.name)}</span>
              ${!isActive ? `<span style="font-size:10px; background:var(--t3); color:#fff; padding:2px 6px; border-radius:4px; font-weight:800;">已停用</span>` : ''}
            </div>

            <div style="font-size:11px; color:var(--t2); font-weight:700; margin-bottom:12px; display:inline-block; background:var(--sf2); padding:2px 8px; border-radius:6px;">
              ${dateStr}
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px;">
              ${tiersHtml}
            </div>

            <div style="display:flex; justify-content:flex-end; border-top:1px dashed var(--border); padding-top:10px;">
              ${actionHtml}
            </div>
          </div>
        `;
      });

      html += `</div></div></div>`; // 結束群組內部與外框
    }
  }
  html += `</div>`;
  document.getElementById('sub-body').innerHTML = html;
  openOverlay('sub-page');
}

// 7. 獎勵設定平台群組摺疊
window.toggleRewardGroup = function(platId) {
  const body = document.getElementById(`rw-grp-body-${platId}`);
  const icon = document.getElementById(`rw-grp-icon-${platId}`);
  if (!body || !icon) return;
  if (navigator.vibrate) try { navigator.vibrate(12); } catch(e){}

  requestAnimationFrame(() => {
    if (body.style.maxHeight === '0px') {
      body.style.maxHeight = '2000px';
      icon.style.transform = 'rotate(180deg)';
    } else {
      body.style.maxHeight = '0px';
      icon.style.transform = 'rotate(0deg)';
    }
  });
};

/* 切換獎勵啟用狀態 */
window.toggleRewardActive = function(id, isChecked) {
  const r = S.settings.rewards.find(x => x.id === id);
  if (r) {
    r.active = isChecked;
    saveSettings();
    openRewardSettings(); // 重新渲染刷新透明度
    if(S.tab === 'home') renderHome();
    toast(isChecked ? '獎勵已「啟用」✅' : '⏸️ 獎勵已「停用」');
  }
}

/* 刪除自訂獎勵 */
window.deleteReward = async function(id) {
  const r = S.settings.rewards.find(x => x.id === id);
  if (!r) return;
  const ok = await customConfirm(`確定要刪除「${r.name}」嗎？<br><span style="color:var(--t3); font-size:12px;">刪除後，無法復原</span>`); 
  if (!ok) return; 
  
  S.settings.rewards = S.settings.rewards.filter(x => x.id !== id);
  saveSettings(); 
  openRewardSettings(); 
  if(S.tab === 'home') renderHome();
  toast('獎勵，已刪除 ✅'); 
}

/* ══ 新增與編輯表單共用邏輯 ══ */
window.openAddReward = function() { 
  editingRewardId = null;
  document.getElementById('sub-title').textContent = '新增進階獎勵項目'; 
  
  // 👇 強制隱藏左上角的 X 按鈕
  const closeBtn = document.querySelector('#sub-page .top-bar .bar-btn');
  if (closeBtn) closeBtn.style.display = 'none';
  // 👇 注入返回清單按鈕
  document.getElementById('sub-top-right').innerHTML = `
    
    <button onclick="animateSubPageReturn(this, () =>{document.querySelector('#sub-page .top-bar .bar-btn').style.display = 'flex';openRewardSettings();} )" style="background:linear-gradient(135deg, #8b5cf6, #7c3aed); color:#ffffff; border:1px solid #6d28d9; padding:6px 8px; border-radius:20px; font-size:13px; font-weight:900; cursor:pointer; box-shadow:0 4px 12px rgba(139,92,246,0.3); transition:0.2s; letter-spacing:0.5px; text-shadow:0 1px 2px rgba(0,0,0,0.2);">🔙 返回清單</button>
  `;
  
  tempTiers = [{orders:'', amount:''}, {orders:'', amount:''}];
  renderRewardForm();
}

window.openEditReward = function(id) {
  const r = S.settings.rewards.find(x => x.id === id);
  if(!r) return;
  editingRewardId = id;
  document.getElementById('sub-title').textContent = '編輯獎勵項目'; 
  
  // 👇 強制隱藏左上角的 X 按鈕
  const closeBtn = document.querySelector('#sub-page .top-bar .bar-btn');
  if (closeBtn) closeBtn.style.display = 'none';
  // 👇 注入返回清單按鈕
  document.getElementById('sub-top-right').innerHTML = `
    <button onclick="animateSubPageReturn(this, () => { document.querySelector('#sub-page .top-bar .bar-btn').style.display=''; openRewardSettings(); })" style="background:linear-gradient(135deg, #3b82f6, #2563eb); color:#ffffff; border:1px solid #1d4ed8; padding:6px 16px; border-radius:20px; font-size:13px; font-weight:900; cursor:pointer; box-shadow:0 4px 12px rgba(37,99,235,0.3); transition:0.2s; letter-spacing:0.5px; text-shadow:0 1px 2px rgba(0,0,0,0.2);">🔙 返回清單</button>
  `;
  
  // 深拷貝一份階距陣列，避免直接修改到原始資料
  tempTiers = JSON.parse(JSON.stringify(r.tiers || []));
  renderRewardForm(r);
}

// 👇 輔助函式：在重新渲染前，先把畫面上已經輸入的值保存起來，避免清空
function saveTempFormState() {
  const currentData = {
    name: document.getElementById('rw-name')?.value || '',
    platformId: document.getElementById('rw-plat')?.value || '',
    startDate: document.getElementById('rw-start')?.value || todayStr(),
    endDate: document.getElementById('rw-end')?.value || todayStr(),
    startTime: document.getElementById('rw-start-time')?.value || '00:00',
    endTime: document.getElementById('rw-end-time')?.value || '23:59',
    recurring: document.getElementById('rw-recurring')?.checked || false,
  };
  return currentData;
}

window.addRewardTier = function() {
  const savedState = saveTempFormState();
  tempTiers.push({orders:'', amount:''});
  renderRewardForm(savedState);
}

window.removeRewardTier = function(idx) {
  if (tempTiers.length <= 1) { toast('⚠️ 至少需要「保留一階獎勵」'); return; }
  const savedState = saveTempFormState();
  tempTiers.splice(idx, 1);
  renderRewardForm(savedState);
}

function renderRewardForm(data = null) {
  const pId = data ? data.platformId : (S.platforms.find(p=>p.active)?.id || '');
  const platOpts = S.platforms.filter(p=>p.active).map(p=>`<option value="${safeText(p.id)}" ${p.id===pId?'selected':''}>${safeText(p.name)}</option>`).join(''); 
  let tiersHtml = '';
  
  // 美化每一階的獎勵區塊
  tempTiers.forEach((t, idx) => {
    const badgeColors = ['#f59e0b', '#94a3b8', '#d97706'];
    const bColor = badgeColors[idx] || '#64748b';
    const bBg = badgeColors[idx] ? badgeColors[idx] + '20' : '#f1f5f9';

    tiersHtml += `
      <div style="background:#ffffff; border:1.5px solid #cbd5e1; padding:12px; border-radius:12px; margin-bottom:10px; position:relative; box-shadow:0 2px 6px rgba(0,0,0,0.02);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div style="background:${bBg}; color:${bColor}; font-size:11px; font-weight:900; padding:4px 10px; border-radius:8px; display:flex; align-items:center; gap:4px; border:1px solid ${bColor}40;">
            <span style="font-size:13px;">${idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '🏅'}</span> 第 ${idx+1} 階
          </div>
          ${tempTiers.length > 1 ? `<button onclick="removeRewardTier(${idx})" style="background:var(--red-d); color:var(--red); border:none; width:26px; height:26px; border-radius:6px; font-size:14px; font-weight:900; cursor:pointer; display:flex; align-items:center; justify-content:center;">✕</button>` : ''}
        </div>

        <div style="display:flex; gap:10px;">
          <div class="fg" style="flex:1; margin-bottom:0;">
            <label style="font-size:12px; color:var(--t2); letter-spacing:0.5px;">📦 滿幾單</label>
            <div style="position:relative;">
              <input type="number" class="finp" value="${t.orders === 0 || t.orders === '0' ? '' : (t.orders ?? '')}" inputmode="numeric" onchange="tempTiers[${idx}].orders=this.value" style="font-family:var(--mono); font-weight:800; color:var(--text-blue); padding-right:30px;">
              <span style="position:absolute; right:12px; top:50%; transform:translateY(-50%); font-size:13px; color:#000; font-weight:600;">單</span>
            </div>
          </div>
          <div class="fg" style="flex:1; margin-bottom:0;">
            <label style="font-size:12px; color:var(--t2); letter-spacing:0.5px;">💰 獎金</label>
            <div style="position:relative;">
              <span style="position:absolute; left:12px; top:50%; transform:translateY(-50%); font-size:14px; color:var(--acc); font-weight:900; font-family:var(--mono);">$</span>
              <input type="number" class="finp" value="${t.amount === 0 || t.amount === '0' ? '' : (t.amount ?? '')}" inputmode="numeric" onchange="tempTiers[${idx}].amount=this.value" style="font-family:var(--mono); font-weight:800; color:var(--acc); padding-left:26px;">
            </div>
          </div>
        </div>
      </div>`;
  });

  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px;">
      
      <!-- 區塊 1：基本資訊 -->
      <div class="card" style="padding:16px; border:1px solid #bfdbfe; box-shadow:0 4px 12px rgba(59,130,246,0.08);">
        <div style="font-size:13px; font-weight:800; color:var(--blue); margin-bottom:12px; display:flex; align-items:center; gap:6px;">
          <span style="font-size:16px;">🏷️</span> 獎勵基本設定
        </div>
        <div class="fg" style="margin-bottom:12px">
          <label style="color:var(--t1);">獎勵名稱</label>
          <input type="text" class="finp" id="rw-name" value="${data ? safeText(data.name) : ''}" placeholder="例如：週末衝單獎勵" style="font-weight:700;">
        </div>
        <div class="fg" style="margin-bottom:4px">
          <label style="color:var(--t1);">適用平台</label>
          <select class="fsel" id="rw-plat" style="font-weight:800; color:var(--t1);">${platOpts}</select>
        </div>
      </div>

      <!-- 區塊 2：日期與時間設定 -->
      <div class="card" style="padding:16px; border:1px solid #e9d5ff; box-shadow:0 4px 12px rgba(168,85,247,0.08);">
        <div style="font-size:13px; font-weight:800; color:#9333ea; margin-bottom:12px; display:flex; align-items:center; gap:6px;">
          <span style="font-size:16px;">⏳</span> 期間與循環規則
        </div>
        
        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <div class="fg" style="flex:1; margin-bottom:0;"><label style="color:var(--t1);">開始日期</label><input type="date" class="finp" id="rw-start" value="${data ? (data.startDate||todayStr()) : todayStr()}" style="font-family:var(--mono); font-weight:700; color:var(--text-blue); padding:8px;"></div>
          <div class="fg" style="flex:1; margin-bottom:0;"><label style="color:var(--t1);">結束日期</label><input type="date" class="finp" id="rw-end" value="${data ? (data.endDate||todayStr()) : todayStr()}" style="font-family:var(--mono); font-weight:700; color:var(--text-red); padding:8px;"></div>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:14px;">
          <div class="fg" style="flex:1; margin-bottom:0;"><label style="color:var(--t1);">開始時間 (選填)</label><input type="time" class="finp" id="rw-start-time" value="${data ? (data.startTime||'00:00') : '00:00'}" style="font-family:var(--mono); font-weight:700; color:var(--text-blue); padding:8px;"></div>
          <div class="fg" style="flex:1; margin-bottom:0;"><label style="color:var(--t1);">結束時間 (選填)</label><input type="time" class="finp" id="rw-end-time" value="${data ? (data.endTime||'23:59') : '23:59'}" style="font-family:var(--mono); font-weight:700; color:var(--text-red); padding:8px;"></div>
        </div>

        <div style="background:#fdf4ff; border:1px solid #f3e8ff; border-radius:12px; padding:10px 14px; display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; flex-direction:column; gap:2px;">
            <span style="font-size:13px; font-weight:800; color:#7e22ce;">🔄 依週期固定循環</span>
            <span style="font-size:10px; color:#a855f7; font-weight:600;">開啟將自動套用至每週，無視上方日期時間</span>
          </div>
          <label class="switch"><input type="checkbox" id="rw-recurring" ${data && data.recurring ? 'checked' : ''}><span class="slider"></span></label>
        </div>
      </div>

      <!-- 區塊 3：階距設定 -->
      <div class="card" style="padding:16px; background:var(--sf2); border:1px solid var(--border);">
        <div style="font-size:13px; font-weight:800; color:var(--t1); margin-bottom:12px; display:flex; align-items:center; gap:6px;">
          <span style="font-size:16px;">📈</span> 設定達標階距
        </div>
        ${tiersHtml}
        <button onclick="addRewardTier()" style="width:100%; padding:12px; border:2px dashed #94a3b8; background:transparent; color:#475569; border-radius:12px; cursor:pointer; font-weight:800; font-size:13px; margin-top:4px; transition:0.2s;">➕ 再新增一階獎勵</button>
      </div>

      <button onclick="submitRewardSave()" class="btn-acc" style="width:100%; padding:16px; font-size:16px; font-weight:900; border-radius:14px; box-shadow:0 8px 24px rgba(255,107,53,0.35); margin-top:8px;">
        💾 儲存並發布獎勵
      </button>
    </div>
  `; 
  openOverlay('sub-page'); 
}

window.submitRewardSave = function() { 
  const name = document.getElementById('rw-name').value.trim(); 
  if (!name) { toast('請輸入「獎勵名稱」'); return; } 
  if (!S.settings.rewards) S.settings.rewards=[]; 
  
  const tiers = tempTiers.map(t => ({ orders: pf(t.orders), amount: pf(t.amount) })).filter(t => t.orders > 0 && t.amount > 0);
  if(tiers.length === 0) { toast('請至少設定「一階有效的獎勵」'); return; }

  const newRewardData = { 
    id: editingRewardId || newId(), 
    name, 
    platformId: document.getElementById('rw-plat').value, 
    startDate: document.getElementById('rw-start').value,
    endDate: document.getElementById('rw-end').value,
    startTime: document.getElementById('rw-start-time').value || '00:00',
    endTime: document.getElementById('rw-end-time').value || '23:59',
    recurring: document.getElementById('rw-recurring').checked,
    tiers: tiers,
    active: true // 儲存時預設為啟用
  }; 

  if (editingRewardId) {
    const idx = S.settings.rewards.findIndex(x => x.id === editingRewardId);
    if (idx >= 0) {
      // 保留原本的停用/啟用狀態
      newRewardData.active = S.settings.rewards[idx].active !== false;
      S.settings.rewards[idx] = newRewardData;
    }
  } else {
    S.settings.rewards.push(newRewardData); 
  }

  saveSettings(); 
  openRewardSettings(); // 直接切回清單頁
  if(S.tab === 'home') renderHome();
  toast('獎勵設定，已儲存 ✅'); 
}

function doBackup() {
  const fileName = `外送記錄${todayStr()}.json`;
  const data = buildBackupPayload(fileName);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  showBackupResultBox(data.exportSummary);
}

function doRestore() { 
  const fi = document.getElementById('restore-file'); 
  fi.onchange = async () => { 
    const file = fi.files[0]; 
    if(!file) return; 
    try { 
      const text = await file.text(); 
      const data = JSON.parse(text); 
      // 👇 將檔案名稱安全地顯示在確認視窗中
      const ok = await customConfirm(`
        <span style="font-size:20px;font-weight:750;">確定使用<br>「 <span style="color:var(--blue);font-family:var(--mono);">${safeText(file.name)}</span> 」<br>
          <span style="display:inline;color:#ff0000;font-size:24px;font-weight:600;margin-right:5px;">覆蓋</span>目前資料？<br><br>

          <span style="font-size:17px;font-weight:650;background: #20ab2e66;border-radius:20px;padding:3px 10px;margin-bottom:8px;">※ 如果目前的資料還有用，</span><br>
          <span style="font-size:17px;font-weight:650;background: #20ab2e66;border-radius:20px;padding:3px 10px;">建議先按取消，去備份資料。</span>
        </span>`);
      if (!ok) return; 
      
      if (data.records) { S.records=data.records; saveRecords(); } 
      if (data.platforms) { S.platforms=data.platforms; savePlatforms(); } 
      if (data.settings) { S.settings=data.settings; saveSettings(); } 
      if (data.vehicles) { S.vehicles=data.vehicles; saveVehicles(); } 
      if (data.vehicleRecs) { S.vehicleRecs=data.vehicleRecs; saveVehicleRecs(); } 
      if (data.generalExpenses) { S.generalExpenses=data.generalExpenses; saveGeneralExpenses(); }
      
      toast('還原「成功」✅'); 
      renderSettings(); 
      renderHome(); 
    } catch { 
      toast('❌ 檔案格式「錯誤」'); 
    } 
    fi.value='';
  };
  fi.click();
}


/* ════════════════════════ 匯出 Excel、試算表 (開始) ══════════════════ */
/* ══ 輔助：將小數工時轉為「X 小時 Y 分鐘」格式 ══ */
function fmtHoursToChinese(hVal) {
  const h = parseFloat(hVal) || 0;
  if (h <= 0) return '0 小時 0 分鐘';
  const totalMins = Math.round(h * 60);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${hrs} 小時 ${mins} 分鐘`;
}

/* ══ 1. 匯出 Excel 選擇彈窗 (包含一般試算表 & 差額補償表) ══ */
function openExportModal() {
  document.getElementById('sub-title').textContent = '匯出 Excel 試算表';
  document.getElementById('sub-top-right').innerHTML = '';

  // 抓取記錄中包含的所有年份
  let years = new Set();
  S.records.forEach(r => { if(r.date) years.add(r.date.substring(0,4)); });
  S.vehicleRecs.forEach(r => { if(r.date) years.add(r.date.substring(0,4)); });
  
  let yearArr = Array.from(years).sort((a,b) => b.localeCompare(a)); 
  if(yearArr.length === 0) yearArr = [new Date().getFullYear().toString()];

  let optionsHtml = `<option value="all">全部年份</option>`;
  yearArr.forEach(y => {
    const isCurrent = y === new Date().getFullYear().toString();
    optionsHtml += `<option value="${y}" ${isCurrent ? 'selected' : ''}>${y} 年</option>`;
  });

  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px;">
      
      <!-- 區塊一：一般全項試算表匯出 -->
      <div class="card" style="padding:16px; margin-bottom:20px; border:1.5px solid #bfdbfe; background:#eff6ff;">
        <div style="font-size:15px; font-weight:900; color:#1e3a8a; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
          <span>📊</span> 一般全項試算表匯出
        </div>
        <div style="font-size:12px; color:#3b82f6; font-weight:600; margin-bottom:12px; line-height:1.5;">
          匯出包含行程、打卡、小費、油資、保養等多活頁簿 Excel 檔案。
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <select id="export-year-select" class="fsel" style="flex:1;background:#fff;font-size:18px; font-weight:850; text-align:center;color: #ff7300;">
            ${optionsHtml}
          </select>
          <button onclick="executeExcelExport()" class="btn-acc" style="padding:10px 16px; font-size:14px; font-weight:800; border-radius:12px;">確定匯出</button>
        </div>
      </div>

      <!-- 區塊二：專法差額補償表 -->
      <div class="card" style="padding:16px; border:1.5px solid #fed7aa; background:#fff7ed;">
        <div style="font-size:18px; font-weight:800; color: #ff5015; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
          <span>📄</span> 匯出「專法差額補償表」
        </div>
        <div style="font-size:14px; color: #1d9421; font-weight:650; margin-bottom:12px; line-height:1.5;letter-spacing:0.6px;">
          自動比對訂單，篩選出應補償差額之訂單。
        </div>

        <!-- 模式切換：單日 / 多日 -->
        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <button type="button" id="btn-comp-mode-single" onclick="setCompDateMode('single')" style="flex:1; padding:8px; border-radius:10px; font-size:12px; font-weight:800; border:1.5px solid #f97316; background:#f97316; color:#fff; cursor:pointer;">單日模式</button>
          <button type="button" id="btn-comp-mode-range" onclick="setCompDateMode('range')" style="flex:1; padding:8px; border-radius:10px; font-size:12px; font-weight:800; border:1.5px solid #cbd5e1; background:#ffffff; color:#64748b; cursor:pointer;">多日範圍</button>
        </div>

        <!-- 單日日期選擇 -->
        <div id="comp-single-wrap" class="fg" style="margin-bottom:12px;">
          <label style="font-size:12px;font-weight:700; color:#9a3412;">📅 選擇日期</label>
          <input type="date" id="comp-date-single" class="finp" value="${todayStr()}">
        </div>

        <!-- 多日範圍選擇 -->
        <div id="comp-range-wrap" style="display:none; gap:8px; margin-bottom:12px;">
          <div class="fg" style="flex:1; margin-bottom:0;">
            <label style="font-size:12px;font-weight:700; color:#9a3412;">開始日期</label>
            <input type="date" id="comp-date-from" class="finp" value="${todayStr()}">
          </div>
          <div class="fg" style="flex:1; margin-bottom:0;">
            <label style="font-size:12px;font-weight:700; color:#9a3412;">結束日期</label>
            <input type="date" id="comp-date-to" class="finp" value="${todayStr()}">
          </div>
        </div>

        <!-- 差額金額門檻設定 -->
        <div class="fg" style="margin-bottom:16px;">
          <label style="font-size:12px;font-weight:700; color:#9a3412;">超過差額門檻 ($) <span style="font-size:12px;color:#ea580c;">(預設0元，即差額 > 門檻才匯出)</span></label>
          <input type="number" id="comp-min-diff" class="finp" value="0" min="0" placeholder="0" style="font-family:var(--mono); font-weight:900; color:#ea580c;">
        </div>

        <button onclick="executeCompensationExport()" class="btn-acc" style="width:100%; padding:12px; font-size:15px; font-weight:900; border-radius:12px; background:#ea580c; box-shadow:0 4px 12px rgba(234,88,12,0.3);">📄 匯出差額補償表 (.xlsx)</button>
      </div>

    </div>
  `;
  openOverlay('sub-page');
}

/* 切換單日 / 多日模式 UI */
window.setCompDateMode = function(mode) {
  const btnSingle = document.getElementById('btn-comp-mode-single');
  const btnRange = document.getElementById('btn-comp-mode-range');
  const singleWrap = document.getElementById('comp-single-wrap');
  const rangeWrap = document.getElementById('comp-range-wrap');

  if (!btnSingle || !btnRange) return;

  if (mode === 'single') {
    btnSingle.style.background = '#f97316';
    btnSingle.style.borderColor = '#f97316';
    btnSingle.style.color = '#ffffff';

    btnRange.style.background = '#ffffff';
    btnRange.style.borderColor = '#cbd5e1';
    btnRange.style.color = '#64748b';

    singleWrap.style.display = 'block';
    rangeWrap.style.display = 'none';
  } else {
    btnRange.style.background = '#f97316';
    btnRange.style.borderColor = '#f97316';
    btnRange.style.color = '#ffffff';

    btnSingle.style.background = '#ffffff';
    btnSingle.style.borderColor = '#cbd5e1';
    btnSingle.style.color = '#64748b';

    singleWrap.style.display = 'none';
    rangeWrap.style.display = 'flex';
  }
};

/* 執行一般 Excel 匯出觸發 */
window.executeExcelExport = function() {
  const targetYear = document.getElementById('export-year-select').value;
  closeOverlay('sub-page');
  doExportExcel(targetYear);
}

/* 2. 一般多活頁簿 Excel 匯出（工時改為：X 小時 Y 分鐘） */
function doExportExcel(targetYear) {
  if (typeof XLSX === 'undefined') {
    toast('⚠️ Excel 匯出套件載入中，請稍後再試');
    return;
  }

  showProgress('匯出 Excel 檔案中...');

  setTimeout(() => {
    const isMatch = (r) => targetYear === 'all' || (r.date && r.date.startsWith(targetYear));

    // 1. 行程記錄 (工時改為 X 小時 Y 分鐘)
    const regularRecs = S.records.filter(r => isMatch(r) && !r.isCashTip && !r.isPunchOnly).map(r => {
      const p = getPlatform(r.platformId);
      return { 
        '日期': r.date, 
        '時間': r.time||'', 
        '平台': p.name, 
        '接單數': r.orders||0, 
        '行程收入': r.income||0, 
        '固定獎勵': r.bonus||0, 
        '臨時獎勵': r.tempBonus||0, 
        'APP小費': r.tips||0, 
        '總收入': recTotal(r), 
        '工時': fmtHoursToChinese(r.hours), // 👈 格式修改
        '備註': r.note||'' 
      };
    });

    // 2. 純打卡工時記錄 (工時改為 X 小時 Y 分鐘)
    const punchRecs = S.records.filter(r => isMatch(r) && r.isPunchOnly).map(r => {
      return { 
        '日期': r.date, 
        '上線時間': r.punchIn||'', 
        '下線時間': r.punchOut||'', 
        '總工時': fmtHoursToChinese(r.hours) // 👈 格式修改
      };
    });

    // 3. 現金小費
    const cashTipRecs = S.records.filter(r => isMatch(r) && r.isCashTip).map(r => {
      const p = getPlatform(r.platformId);
      return { '日期': r.date, '時間': r.time||'', '平台': p.name, '客給金額': r.givenAmt||0, '應收金額': r.costAmt||0, '實收小費': r.cashTipAmt||0, '備註': r.note||'' };
    });

    // 4. 加油記錄
    const gasRecs = S.vehicleRecs.filter(r => isMatch(r) && r.type === 'fuel' && r.fuelType !== 'electric').map(r => {
      const v = S.vehicles.find(x => x.id === r.vehicleId);
      const diff = pf(r.km) - pf(r.prevKm);
      return { '日期': r.date, '時間': r.time||'', '車輛名稱': v ? v.name : '未知', '油品': r.fuelType||'', '上次里程': r.prevKm||0, '加油里程': r.km||0, '行駛里程': diff > 0 ? diff : 0, '加油量(L)': r.liters||0, '單價': r.price||0, '折扣': r.discount||0, '花費金額': r.amount||0 };
    });

    // 5. 電動車換電
    const evRecs = S.vehicleRecs.filter(r => isMatch(r) && r.type === 'fuel' && r.fuelType === 'electric').map(r => {
      const v = S.vehicles.find(x => x.id === r.vehicleId);
      const diff = pf(r.km) - pf(r.prevKm);
      return { '日期': r.date, '時間': r.time||'', '車輛名稱': v ? v.name : '未知', '上次里程': r.prevKm||0, '換電里程': r.km||0, '行駛里程': diff > 0 ? diff : 0, '繳交月租費': r.amount||0 };
    });

    // 6. 保養維修記錄
    const maintRecs = S.vehicleRecs.filter(r => isMatch(r) && r.type === 'maintenance').map(r => {
      const v = S.vehicles.find(x => x.id === r.vehicleId);
      const catStr = r.maintCategory === 'repair' ? '維修' : '保養';
      let detailStr = (r.items||[]).join(', ');
      if (r.itemDetails && r.itemDetails.length > 0) {
          detailStr = r.itemDetails.map(d => `${d.name}($${d.amount})`).join(', ');
      }
      return { '日期': r.date, '時間': r.time||'', '車輛名稱': v ? v.name : '未知', '類別': catStr, '保養里程': r.km||0, '項目與明細': detailStr, '總花費金額': r.amount||0, '店家': r.shop||'', '付款方式': r.payMethod||'', '備註': r.note||'' };
    });

    const safeData = (arr) => arr.length > 0 ? arr : [{'系統提示': '該年份尚無此項目記錄'}];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeData(regularRecs)), "行程記錄");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeData(punchRecs)), "純打卡工時");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeData(cashTipRecs)), "現金小費");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeData(gasRecs)), "加油記錄");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeData(evRecs)), "電動車里程");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeData(maintRecs)), "保養維修");

    const fileNameYear = targetYear === 'all' ? '全部' : targetYear;
    try {
      XLSX.writeFile(wb, `外送記錄（${fileNameYear}年）${todayStr()}.xlsx`);
      finishProgress(() => toast(`${fileNameYear}年 Excel 匯出完成 ✅`));
    } catch (err) {
      finishProgress(() => toast('❌ 匯出失敗，請重試'));
    }
  }, 700); 
}

/* 3. 執行「訂單計時差額補償表」匯出觸發 */
window.executeCompensationExport = function() {
  const isRange = document.getElementById('comp-range-wrap').style.display !== 'none';
  let startDate = '', endDate = '';

  if (isRange) {
    startDate = document.getElementById('comp-date-from').value;
    endDate = document.getElementById('comp-date-to').value;
  } else {
    startDate = document.getElementById('comp-date-single').value;
    endDate = startDate;
  }

  if (!startDate || !endDate) {
    toast('⚠️ 請選擇完整的「日期」');
    return;
  }

  if (startDate > endDate) {
    toast('⚠️ 「開始日期」不能大於「結束日期」');
    return;
  }

  const minDiff = parseFloat(document.getElementById('comp-min-diff').value) || 0;

  closeOverlay('sub-page');
  doExportCompensationSheet(startDate, endDate, minDiff);
};

/* 4. 真正產生「專法差額補償表」 (原生 .xlsx 多工作表/頁籤方案) */
function doExportCompensationSheet(startDate, endDate, minDiffThreshold) {
  if (typeof XLSX === 'undefined') {
    toast('⚠️ Excel 匯出套件載入中，請稍後再試');
    return;
  }

  showProgress('產生多頁籤 Excel 檔案中...');

  setTimeout(() => {
    ensureOrderTripsLoaded();
    const minDiff = parseFloat(minDiffThreshold) || 0;

    // 1. 篩選日期區間內的行程
    const targetTrips = S.orderTrips.filter(t => t.date >= startDate && t.date <= endDate);

    // 2. 按平台分群 (Group by Platform)
    const platformGroups = {};

    targetTrips.forEach(trip => {
      const plat = getPlatform(trip.platformId);
      const orders = [trip.main, ...(trip.bundled || []), ...(trip.midway || [])].filter(Boolean);
      const is3Batch = orders.length === 3; // 判斷是否為一次派 3 單

      orders.forEach(o => {
        const amt = pf(o.amount);
        const durMs = calcOrderDurationMs(o);
        const law = o.status === 'done' ? pf(o.lawPay) : calcLawPay(durMs);
        const diff = law - amt;

        // 門檻篩選：專法薪資 > 接單金額 且 差額 > 門檻
        if (law > amt && diff > minDiff) {
          if (!platformGroups[trip.platformId]) {
            platformGroups[trip.platformId] = {
              platInfo: plat,
              items: []
            };
          }

          platformGroups[trip.platformId].items.push({
            date: trip.date,
            orderNo: o.orderNo || '無單號',
            startTs: o.startTs,
            endTs: o.endTs,
            amount: amt,
            lawPay: law,
            diff: diff,
            is3Batch: is3Batch
          });
        }
      });
    });

    const platformKeys = Object.keys(platformGroups);
    if (platformKeys.length === 0) {
      finishProgress(() => toast(`⚠️ 該區間內無符合條件（差額 > ${minDiff} 元）之訂單`));
      return;
    }

    const dateRangeStr = (startDate === endDate)
      ? `日期：${startDate.replace(/-/g, '/')}`
      : `日期範圍：${startDate.replace(/-/g, '/')} ~ ${endDate.replace(/-/g, '/')}`;

    // 3. 建立 XLSX 原生活頁簿 (Workbook)
    const wb = XLSX.utils.book_new();

    platformKeys.forEach((pId) => {
      const group = platformGroups[pId];
      const plat = group.platInfo;
      const items = group.items;

      // 排序：先按日期，再按開始時間
      items.sort((a,b) => a.date.localeCompare(b.date) || (a.startTs || 0) - (b.startTs || 0));

      let totalAmount = 0;
      let totalLaw = 0;
      let totalDiff = 0;

      const rows = [];

      // 需求 1: 標題改為 外送訂單，專法差額補償表
      rows.push(['外送訂單，專法差額補償表']); // Row 0
      // 需求 2: 刪除門檻資訊，僅留日期
      rows.push([dateRangeStr]);            // Row 1
      // 需求 8: 在日期下方標示平台資訊
      rows.push([`平台：${plat.name}`]);    // Row 2
      rows.push([]);                        // Row 3 (空白列)

      // 需求 10 & 8: 刪除平台欄位，新增編號欄位 (Row 4)
      rows.push(['編號', '日期', '單號', '開始時間', '結束時間', '接單金額 ($)', '專法薪資 ($)', '應補償差額 ($)', '備註']);

      items.forEach((item, idx) => {
        totalAmount += item.amount;
        totalLaw += item.lawPay;
        totalDiff += item.diff;

        const startStr = item.startTs ? new Date(item.startTs).toTimeString().slice(0, 8) : '--:--:--';
        const endStr = item.endTs ? new Date(item.endTs).toTimeString().slice(0, 8) : '--:--:--';

        // 需求 4: 派3單時在開始時間標註 𖦹 符號
        const startDisplay = item.is3Batch ? `${startStr} 𖦹` : startStr;

        rows.push([
          idx + 1,                            // 需求 10: 編號
          item.date.replace(/-/g, '/'),       // 日期
          item.orderNo,                       // 單號
          startDisplay,                       // 開始時間
          endStr,                             // 結束時間
          item.amount,                        // 接單金額
          item.lawPay,                        // 專法薪資
          item.diff,                          // 應補償差額
          ''                                  // 需求 3: 備註留空手寫
        ]);
      });

      // 需求 10: 刪除「共X筆」，標示「總計」 (Row N)
      const totalRowIdx = rows.length;
      rows.push(['總計', '', '', '', '', totalAmount, totalLaw, totalDiff, '']);

      const ws = XLSX.utils.aoa_to_sheet(rows);

      // 設定儲存格合併 (Merges)
      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }, // 標題合併 A1:I1
        { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } }, // 日期合併 A2:I2
        { s: { r: 2, c: 0 }, e: { r: 2, c: 8 } }, // 平台合併 A3:I3
        { s: { r: totalRowIdx, c: 0 }, e: { r: totalRowIdx, c: 4 } } // 總計標籤合併 A{N}:E{N}
      ];

      // 設定理想欄寬 (Column Widths)
      ws['!cols'] = [
        { wch: 8 },  // 編號
        { wch: 14 }, // 日期
        { wch: 16 }, // 單號
        { wch: 16 }, // 開始時間
        { wch: 14 }, // 結束時間
        { wch: 14 }, // 接單金額
        { wch: 14 }, // 專法薪資
        { wch: 16 }, // 應補償差額
        { wch: 14 }  // 備註
      ];

      // 需求 7: 以平台名稱建立獨立工作表頁籤 (例如: [Uber Eats], [foodpanda])
      let sheetName = plat.name.replace(/[:\\/?*\[\]]/g, '').substring(0, 30) || `平台_${pId}`;
      
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    // 4. 匯出原生多頁籤 .xlsx 檔案
    const fileNameDate = (startDate === endDate) ? startDate : `${startDate}_至_${endDate}`;
    try {
      XLSX.writeFile(wb, `外送訂單，專法差額補償表_${fileNameDate}.xlsx`);
      finishProgress(() => toast('📄 多頁籤 Excel 匯出完成 ✅'));
    } catch (err) {
      finishProgress(() => toast('❌ 匯出失敗，請重試'));
    }
  }, 700);
}
/* ════════════════════════ 匯出 Excel、試算表 (結束) ══════════════════ */

/* ══ 清除所有記錄與車輛資料 (加強版) ══ */
async function doClearData() { 
  const msg = `
    <div style="font-size:48px; margin-bottom:12px; text-align:center;">🗑️</div>
    <div style="font-size:20px; font-weight:900; color:var(--red); margin-bottom:12px; text-align:center;">確定清除<span style="color: #0033ff;"> 所有記錄 </span>嗎？</div>
    <div style="font-size:14px; color:var(--t1); line-height:1.6; text-align:center; margin-bottom:16px;">
      將清空您的「每日外送記錄」、「車輛保養/加油」、「花費支出」、「訂單計時」等等...，所有全部的記錄。
    </div>
    <div style="font-size:16px; color: #ff0000; font-weight:800; text-align:center; background:var(--red-d); border: 1.5px solid rgba(239,68,68,0.3); padding:8px; border-radius:8px;">
      ⚠️ 此動作《 無法復原 》，<br><span style="color:var(--text-blue); font-weight:750;">【 確定 】繼續？</span>
    </div>
  `;
  const ok = await customConfirm(msg); 
  if (!ok) return; 

  showProgress('正在清除資料...');

  // 1. 清除記憶體中的所有紀錄
  S.records = []; 
  S.vehicles = []; 
  S.vehicleRecs = []; 
  S.orderTrips = []; // 👈 新增：清除計時資料
  
  // 2. 移除 LocalStorage 相關 Key
  localStorage.removeItem(KEYS.records);
  localStorage.removeItem(KEYS.vehicles);
  localStorage.removeItem(KEYS.vehicleRecs);
  localStorage.removeItem('delivery_order_trips'); // 👈 新增：清除計時存檔
  localStorage.removeItem('delivery_general_expenses');

  // 3. 清除 IndexedDB
  await idbDelete('records');
  await idbDelete('vehicleRecs');
  await idbDelete('generalExpenses');
  
  setTimeout(() => {
    finishProgress(() => {
      renderSettings();
      if (S.tab === 'home') renderHome();
      toast('已清除「所有記錄」✅');
    });
  }, 500); // 給予 500ms 緩衝確保 DB 操作完成
}

/* ══ 重置所有設定和資料 (安全重啟版) ══ */
async function doReset() { 
  const msg = `
    <div style="font-size:48px; margin-bottom:12px; text-align:center; animation: waveHand 2s infinite;">🚨</div>
    <div style="font-size:20px; font-weight:900; color:var(--red); margin-bottom:12px; text-align:center;">重置所有設定和資料</div>
    <div style="font-size:14px; color:var(--t1); line-height:1.6; text-align:center; margin-bottom:16px;">
      App 將完全恢復到，剛安裝的<span style="color:var(--text-blue);font-size:16px;font-weight:800;"> 初始狀態 </span>！<br>
    </div>
    <div style="font-size:16px; color: #ff0000; font-weight:700; text-align:center; background:var(--red-d); border: 1.5px solid rgba(239,68,68,0.3); padding:8px; border-radius:8px;">
      ⚠️ 此動作《 無法復原 》，<br><span style="color:var(--text-blue); font-weight:750;">【 確定 】繼續？</span>
    </div>
  `;
  const ok = await customConfirm(msg); 
  if (!ok) return; 

  showProgress('系統重置中，請稍候...');

  // 1. 立即清除所有暫存標記與資料
  const keysToClear = [
    'delivery_setup_completed', 
    KEYS.platforms, 
    KEYS.settings, 
    KEYS.punch, 
    KEYS.vehicles, 
    'delivery_general_expenses',
    'delivery_order_trips', // 👈 新增
    'delivery_current_tab'
  ];
  keysToClear.forEach(k => localStorage.removeItem(k));

  // 2. 清除 IndexedDB
  await idbDelete('records');
  await idbDelete('vehicleRecs');
  await idbDelete('generalExpenses');

  // 3. 重置記憶體變數
  S.records = []; 
  S.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); 
  S.platforms = DEFAULT_PLATFORMS.map(p => ({...p, active: false}));
  S.vehicles = []; 
  S.vehicleRecs = []; 
  S.orderTrips = []; 
  S.punch = null;
  S.tab = 'home';

  // 4. 【核心關鍵】強迫關閉所有開啟中的彈窗
  document.querySelectorAll('.overlay-page').forEach(el => el.classList.remove('show'));
  
  setTimeout(() => {
    finishProgress(() => {
      // 5. 強制切換到首頁
      goPage('home', true);

      // 6. 【緩衝機制】延遲 800ms 後再觸發引導，確保首頁已渲染完畢
      setTimeout(() => {
        window.__initSetupPending = false; // 強制解鎖標記
        checkAndPromptPlatformSetup();
        toast('已成功重置至：「初始狀態」✅');
      }, 800);
    });
  }, 1000); // 延長進度條停留時間，確保後台緩存清理乾淨
}

/* ══ 聯絡我們：信箱與一鍵複製 ══ */
function openContactUs() {
  const email = 'cws38721@gmail.com'; 
  
  document.getElementById('contact-body').innerHTML = `
    <div style="padding:16px; text-align:center;">
      <div style="font-size:54px; margin-bottom:16px;">✉️</div>
      <div style="font-size:15px; font-weight:700; color:var(--t1); margin-bottom:12px; line-height:1.6;">
        如有任何問題、功能建議，<br>或帳號相關協助，歡迎來信：
      </div>
      <div style="font-family:var(--mono); font-size:20px; font-weight:800; color:var(--acc); margin-bottom:24px; background:var(--bg-input); padding:16px; border-radius:12px; border:2px dashed var(--acc);">
        ${email}
      </div>
      <button onclick="copyEmailToClipboard('${email}')" class="btn-acc" style="width:100%; padding:14px; font-size:15px; font-weight:800; border-radius:var(--rs); box-shadow:0 4px 12px rgba(255,107,53,0.3);">
        📋 一鍵複製信箱
      </button>
    </div>
  `;
  
  openOverlay('contact-page');
}

// 支援各種手機瀏覽器的一鍵複製功能 (Fallback 機制)
function copyEmailToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      toast('信箱「已複製」✅');
    }).catch(() => {
      fallbackCopyTextToClipboard(text);
    });
  } else {
    fallbackCopyTextToClipboard(text);
  }
}

function fallbackCopyTextToClipboard(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  // 避免手機畫面往下捲動
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    toast('信箱「已複製」✅');
  } catch (err) {
    toast('⚠️ 複製失敗，請「長按信箱」手動複製');
  }
  document.body.removeChild(textArea);
}

/* ══ 替換：隱私權政策彈窗 (加入禁止條款與全螢幕獨立視窗) ══ */
function openPrivacyPolicy(fromRegister = false) {
  let btnHtml = '';
  if (fromRegister) {
    btnHtml = `<button onclick="agreePrivacyPolicy()" class="btn-acc" style="width:100%;padding:14px;font-size:16px;font-weight:600;border-radius:var(--rs); margin-top:24px; box-shadow:0 4px 12px rgba(255,107,53,0.3);">✅ 我已完整閱讀並同意</button>`;
  }

  document.getElementById('privacy-body').innerHTML = `
    <div style="font-size:13px; color:var(--t1); line-height:1.8; padding:15px 12px; background: hsl(0, 0%, 100%); border-radius:12px; margin:8px;">
      
      <!-- 👇 1. 新增「禁止條款」獨立小標題 -->
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:3px; padding-bottom:3px;">
        <div style="width:7px; height:31px; background:#ff0000; border-radius:4px;"></div>
        <span style="background:rgba(255, 0, 0, 0.2);font-size:18px;font-weight:800;color:#000;letter-spacing:1px;padding:0px 14px;border-radius:8px;margin-left:-15.5px;">&nbsp;禁止條款</span>
      </div>
      
      <!-- 👇 2. 禁止條款內容框 (左上角不再有圓角，與上方標題無縫接合) -->
      <div style="background:rgba(239, 68, 68, 0.9); border:2px solid #be2323; border-radius:16px; padding:16px 14px; margin-bottom:40px;">
        <div style="color:#ffffff; font-size:16px; font-weight:800; line-height:1.6; letter-spacing:0.5px;">
          禁止使用此 APP 資訊，在【 所有 】社群平台上，炫耀或分享跑外送的數據有多強、均幾多厲害、薪水賺得有多高！
        </div>
      </div>

      <!-- 👇 3. 新增「隱私權政策」獨立小標題 -->
      <div style="display:flex; align-items:center; gap:8px; margin:5px 0; border-top:3.5px dashed #ff2d2d; padding-top:10px;">
        <div style="width:7px; height:31px; background:#2563eb; border-radius:4px;"></div>
        <span style="background:rgba(37,99,235,0.2);font-size:18px;font-weight:800;color:#000;letter-spacing:1px;padding:0px 14px;border-radius:8px;margin-left:-15.5px;">&nbsp;隱私權政策</span>
      </div>
      
      <div style="color:var(--text-blue); font-size:16px; font-weight:700; margin-bottom:3px;">1. 我們使用到的資料</div>
      <div style="background: #ffffff; padding:0px 0px 5px 12px; border-radius:12px; margin-bottom:8px;">
        • 您的【 電子郵件信箱 】。<br>
      </div>

      <div style="color:var(--text-blue); font-size:16px; font-weight:700; margin-bottom:3px;">2. 我們如何使用資料</div>
      <div style="background: #ffffff; padding:0px 0px 5px 12px; border-radius:12px; margin-bottom:8px;">
        • 作為「註冊帳號」與「登入驗證」使用。<br>
        • 用於統計「總使用人數」，不做任何商業或其它用途。
      </div>

      <div style="color:var(--text-blue); font-size:16px; font-weight:700; margin-bottom:3px;">3. 資料及使用安全</div>
      <div style="background: rgba(140, 255, 167, 0.3); padding:10px 6px 10px 6px; border-radius:12px; border:1.5px solid rgb(54, 139, 27); margin-bottom:8px;">
        
        <div style="display:flex; align-items:center; gap:6px; color: #c300ff; font-weight:700; font-size:14px; margin-bottom:6px;">
          <span>🛡️</span> 基礎防禦與本機隱私
        </div>
        <div style="padding-left:4px; margin-bottom:12px;">
          • 採用 Cloudflare 部署，預設啟用最高等級 <b>TLS 1.3 (HTTPS)</b> 加密傳輸。<br>
          • 您的外送記錄與資料，<b>僅儲存於「您的個人裝置」上</b>，絕不會上傳至任何雲端伺服器。
        </div>

        <div style="display:flex; align-items:center; gap:6px; color:var(--red); font-weight:700; font-size:14px; margin-top:16px; margin-bottom:6px;">
          <span>🔐</span> 軍規級密碼安全 (PBKDF2) </div>
        <div style="padding-left:4px;">
          • 我們採用美國國家標準技術研究所 (NIST) 認可的 <b>PBKDF2</b> 安全演算法。<br>
          <div style="margin-top:8px; padding:10px; border-left:3px solid var(--acc); background: #ffffff; border-radius:4px 8px 8px 4px;">
            <span style="color:var(--acc); font-weight:700;">優勢一：</span>每次產生獨立隨機鹽值（Salting），徹底無效化彩虹表（Rainbow Table）攻擊。<br>
            <span style="color:var(--acc); font-weight:700;">優勢二：</span>超高強度迭代運算（高達 10 萬次），大幅增加暴力破解所需的時間與成本。<br>
            <span style="color:var(--acc); font-weight:700;">優勢三：</span>強制嚴格的「12 位數密碼長度與複雜度」要求，從源頭阻斷字典攻擊。
          </div>
        </div>
      </div>

      <div style="color:var(--text-blue); font-size:16px; font-weight:700; margin-bottom:3px;">4. 您的權利與聯絡方式</div>
      <div style="background: #ffffff; padding:0px 0px 5px 12px; border-radius:12px; margin-bottom:16px;">
        • 您可隨時聯繫我們，要求永久刪除您的註冊帳號。<br>
        • 如有任何問題，請透過【設定】↓<br>
        &nbsp;&nbsp;&nbsp;→「關於我們」→『聯絡我們』，與我們聯繫。
      </div>

      ${btnHtml}
      <div style="height:32px;"></div>
    </div>
  `;
  
  openOverlay('privacy-page');
}

/* ══ 同意隱私權後，關閉全螢幕視窗並回到註冊頁 ══ */
function agreePrivacyPolicy() {
  privacyAgreed = true;
  
  // 關閉隱私權頁面，下方原本的註冊頁 (sub-page) 就會完美顯露出來
  closeOverlay('privacy-page');
  
  // 動態修改註冊表單上的勾選框，而不重新渲染整個表單，以保留使用者輸入的帳密！
  const chkBox = document.getElementById('privacy-chk-box');
  const chkText = document.getElementById('privacy-chk-text');
  if (chkBox) {
    chkBox.style.borderColor = 'var(--acc)';
    chkBox.style.background = 'var(--acc)';
    chkBox.innerHTML = '<span style="color:#fff; font-size:14px; font-weight:900;">✓</span>';
  }
  if (chkText) {
    chkText.style.color = 'var(--t1)';
  }
}

/* ══ 驗證工時輸入限制 ══ */
function enforceTimeLimits() {
  const hEl = document.getElementById('f-hrs-val');
  const mEl = document.getElementById('f-min-val');
  if (!hEl || !mEl) return;
  
  if (hEl.value !== '') {
    let h = parseInt(hEl.value);
    if (h < 0) hEl.value = 0;
    if (h > 24) hEl.value = 24;
  }
  if (mEl.value !== '') {
    let m = parseInt(mEl.value);
    if (m < 0) mEl.value = 0;
    if (m > 59) mEl.value = 59;
  }
  if (parseInt(hEl.value) === 24) {
    mEl.value = 0;
  }
}

/* ══ 驗證工時邏輯規則 (失去焦點時觸發) ══ */
function enforceTimeRules() {
  const hEl = document.getElementById('f-hrs-val');
  const mEl = document.getElementById('f-min-val');
  if (!hEl || !mEl) return;

  let h = parseInt(hEl.value || 0);
  let m = parseInt(mEl.value || 0);

  if (h === 24) {
    mEl.value = 0;
  } else if (h === 0) {
    if (m === 0 && (hEl.value !== '' || mEl.value !== '')) {
       mEl.value = 1;
       toast('⏱️ 工時不能為 0，已自動設為 1 分鐘');
    }
  }
}

/* ══ 智慧油價系統 (帶入管理員全域預設，且允許自行修改) ══ */
window.applyGlobalGasPrice = function() {
  const fuelTypeEl = document.getElementById('vr-fuel-type');
  const priceEl = document.getElementById('vr-price');

  if (!fuelTypeEl || !priceEl) return;

  const type = fuelTypeEl.value;

  // 預設油價
  let gp = { '92': 29.5, '95': 31.0, '98': 33.0 };
  
  try { 
    const saved = JSON.parse(localStorage.getItem('delivery_global_gas_prices'));
    // 🛡️ 防呆機制：將預設值與本地存檔「合併」，避免缺少單一油品導致無法更新
    if (saved && typeof saved === 'object') {
      gp = { ...gp, ...saved }; 
    }
  } catch(e) {
    console.error("油價讀取失敗，使用預設值", e);
  }

  // 確保價格存在（即便是 0 也能寫入）
  if (gp[type] !== undefined) {
    // 自動帶入對應的油價
    priceEl.value = gp[type];
    
    // 確保輸入框為可編輯狀態
    priceEl.readOnly = false;
    priceEl.style.opacity = '1';
    priceEl.style.pointerEvents = 'auto';
    
    // 觸發總計計算
    calcVehFuel(); 
  }
};

/* ══ Service Worker 註冊（自動判斷環境） ══ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (isLocalDevelopment()) {
      console.log('🟡 本地開發模式：Service Worker 已停用');
      
      // 強制清除所有已註冊的 SW
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let registration of registrations) {
          registration.unregister();
        }
      });
      return;
    }

    // 正式環境才註冊
    navigator.serviceWorker.register('/sw.js')
      .then(r => {
        console.log('✅ SW 已註冊', r.scope);
        r.update();
      })
      .catch(e => console.warn('SW 註冊失敗', e));
  });
}

/* ══ 升級版：外觀與自訂背景套用 ══ */
function applyBackground() {
  const bg = S.settings.bg;
  const root = document.documentElement;
  
  if (bg && bg !== '#fafafa' && bg !== '#424242') {
    // 設定身體背景圖片與白色半透明遮罩
    document.body.style.background = `url('${bg}') center/cover fixed no-repeat`;
    document.body.style.boxShadow = 'inset 0 0 0 9999px rgba(255, 255, 255, 0.3)';
    
    // 讓主頁面透明化以透出背景圖
    root.style.setProperty('--bg', 'transparent');
    root.style.setProperty('--bg-header', 'rgba(255, 255, 255, 0.6)');
    root.style.setProperty('--overlay-bg', 'rgba(240, 244, 248, 0.95)');
  } else {
    // 沒選背景圖時，恢復純色
    document.body.style.background = ''; 
    document.body.style.boxShadow = 'none';
    
    root.style.setProperty('--bg', '#f0f4f8');
    root.style.setProperty('--bg-header', 'rgba(240, 244, 248, 0.85)');
    root.style.setProperty('--overlay-bg', '#f0f4f8');
  }
}

/* =========================================================
   密碼管理專區 (更改密碼 / 忘記密碼)
   ========================================================= */

/* --- 1. 更改密碼 (包含 1234 強制更改) --- */
window.showForcePasswordChange = function(isForced = false) {
  window.__authFlowLocked = true;
  window.__authTurnstileActive = true;
  window.__authFlowOriginTab = S.tab || 'home';
  document.getElementById('sub-title').textContent = isForced ? '⚠️ 安全要求：請立即更改密碼' : '安全設定：更改密碼';
  
  // 👇 不論是否強制，統一隱藏左上角的 X 按鈕
  const closeBtn = document.querySelector('#sub-page .top-bar .bar-btn');
  if (closeBtn) closeBtn.style.display = 'none';
  
  // 👇 根據是否強制，決定右上角要不要放「返回」按鈕
  if (isForced) {
    document.getElementById('sub-top-right').innerHTML = ''; // 強制狀態，不給退路
    document.getElementById('sub-page').style.pointerEvents = 'auto'; 
    document.getElementById('sub-page').dataset.forced = 'true'; 
    toast('⚠️ 您的密碼「強度過低」，或為「初始密碼」，請立即更改！', 5000);
  } else {
    // 主動修改狀態，右上角加入返回按鈕
    document.getElementById('sub-top-right').innerHTML = `
      <button onclick="animateSubPageReturn(this, () => { document.querySelector('#sub-page .top-bar .bar-btn').style.display=''; openAccountStats(); })" style="background:linear-gradient(135deg, #3b82f6, #2563eb); color:#ffffff; border:1px solid #1d4ed8; padding:6px 16px; border-radius:20px; font-size:13px; font-weight:900; cursor:pointer; box-shadow:0 4px 12px rgba(37,99,235,0.3); transition:0.2s; letter-spacing:0.5px; text-shadow:0 1px 2px rgba(0,0,0,0.2);">🔙 返回</button>
    `;
    document.getElementById('sub-page').dataset.forced = 'false';
  }

  document.getElementById('sub-body').innerHTML = `
    <div style="padding:16px;">
      
      <!-- 👇 重新設計：密碼規則與溫馨提示區塊 -->
      <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:20px;">
        
        <!-- 1. 密碼規則框 (濃縮為1行) -->
        <div style="background:#fef2f2; border:1.5px solid #fecdd3; border-radius:12px; padding:10px 8px;">
          <div style="display:flex; align-items:center; gap:6px; color:#e11d48; font-weight:800; font-size:14px; margin-bottom:10px;">
            <span style="font-size:16px;">🛡️</span> 必須符合以下密碼規則
          </div>
          <div style="color:#000000;font-size:11px;line-height:1.5;font-weight:650;display:flex;flex-wrap:wrap;gap:4px;"> 至少 
            <span style="background:#fee2e2; color:#ff0909; padding:3px 4px; border-radius:6px; font-family:var(--mono); font-weight:700; border:1px solid #fca5a5;letter-spacing:0.7px;">12 位數</span>，包含
            <span style="background:#e0e7ff; color:#2563eb; padding:3px 4px; border-radius:6px; font-weight:700; border:1px solid #bfdbfe;">大小寫英文</span>、
            <span style="background:#e8fff0; color:#16a34a; padding:3px 4px; border-radius:6px; font-weight:600; border:1px solid #bbf7d0;">數字</span> 與 
            <span style="background:#f3e8ff; color:#9333ea; padding:3px 4px; border-radius:6px; font-weight:700; border:1px solid #e9d5ff;">特殊符號</span>。
          </div>
        </div>

        <!-- 2. 密碼設定建議 (藍黃高對比科技風) -->
        <div style="background:linear-gradient(180deg, #263c6a 0%, #3f7fbf 50%, #7bb2e6 100%); border-radius:12px; padding:12px; position:relative; overflow:hidden; box-shadow:0 6px 16px rgba(30,58,138,0.2);">
          <div style="position:absolute; inset:0; opacity:0.12; background-image: linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px); background-size: 16px 16px;"></div>
          <!-- 裝飾背景圈 -->
          <div style="position:absolute; right:-20px; top:-20px; width:80px; height:80px; border-radius:50%; background:rgba(57, 182, 255, 0.3);"></div>
          
          <div style="display:flex; align-items:center; gap:6px; color:#60a5fa; font-weight:750; font-size:18px; margin-bottom:8px; position:relative; z-index:1;">
            <span style="font-size:16px;">💡</span> <span style="border:none;background:#ffffff;letter-spacing:0.5px;border-radius:8px;padding:0 6px;">設定建議與提醒</span>
          </div>
          
          <div style="position:relative; z-index:1;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
              <span style="color:#ffffff; font-size:14px; font-weight:700;">不會設定密碼？使用這個 👉</span>
              <a href="https://1password.com/zh-tw/password-generator" target="_blank" style="background:#3b82f6; color:#fff; padding:4px 10px; border-radius:8px; text-decoration:none; font-weight:850; font-size:12px; box-shadow:0 2px 4px rgba(0,0,0,0.2); border:1px solid #60a5fa;">1Password 生成器 ➔</a>
            </div>
            <div style="display:block;color:#000000;font-size:14px;font-weight:700;background:#adf7ff;border-left:5px solid #facc15;padding:8px;border-radius:10px;">
              <div style="width:120px;color:#ff0909;font-size:17px;font-weight:650;background:#fee2e2;border:1px solid #fca5a5;letter-spacing:0.7px;padding:2px 6px;border-radius:6px;margin-bottom:10px;">⚠️ 注意提醒</div>
              <div style="line-height:1.7;">密碼生成後，請務必 <span style="color:#ff1d1d;padding:1px 5px;border-radius:6px;border:none;background:#ffffff;">先複製儲存<span style="color:#000000;">，</span>並妥善保存</span> ，<br>以免遺失導致無法登入！</div>
            </div>
          </div>
        </div>

      </div>

      <div class="fg" style="margin-bottom:16px;">
        <label style="font-weight:700; color:var(--t1);">輸入新密碼</label>
        <input type="password" class="finp" id="cp-new1" placeholder="請符合上方規則">
      </div>
      <div class="fg" style="margin-bottom:24px;">
        <label style="font-weight:700; color:var(--t1);">再次確認新密碼</label>
        <input type="password" class="finp" id="cp-new2" placeholder="請再次輸入新密碼">
      </div>

      <button onclick="submitChangePassword()" class="btn-acc" style="width:100%; padding:14px; font-size:15px; font-weight:800; border-radius:var(--rs); box-shadow:0 4px 12px rgba(255,107,53,0.3);">✅ 確認更改密碼</button>
    </div>
  `;
  document.getElementById('sub-page').style.zIndex = '1100';
  openOverlay('sub-page');
}

/* 7. 修正：提交密碼修改完成後自動恢復原頁面 */
window.submitChangePassword = async function() {
  const p1 = document.getElementById('cp-new1').value;
  const p2 = document.getElementById('cp-new2').value;

  if (p1 !== p2) { toast('⚠️ 兩次密碼，輸入不一致'); return; }
  const pwdRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9\s])\S{12,}$/;
  if (!pwdRegex.test(p1)) { toast('⚠️ 密碼「強度不足」，請確認是否「符合所有規則」'); return; }

  showProgress('密碼更新中...');
  try {
    const res = await fetch(`${API_BASE_URL}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json','Authorization': `Bearer ${USER.token}` },
      body: JSON.stringify({ newPassword: p1 })
    });
    const data = await res.json();
    finishProgress(() => {
      if (data.success) {
        toast('密碼「已更改」✅');
        
        USER.isPasswordWeak = false;
        saveUser();

        const topBarEl = document.querySelector('.overlay-page .top-bar');
        const closeBtnEl = topBarEl ? topBarEl.querySelector('.bar-btn') : null;
        if (closeBtnEl) closeBtnEl.style.display = '';
        document.getElementById('sub-page').dataset.forced = 'false';

        document.getElementById('sub-page').style.zIndex = '200';
        closeOverlay('sub-page');
        
        // 👈 修改完成後自動完成跳轉
        restoreAuthOriginPage();
      } else {
        toast('⚠️ ' + data.message);
      }
    });
  } catch(e) {
    finishProgress(() => toast('連線失敗'));
  }
}

/* 4. 忘記密碼頁面 (白框包覆) */
window.openForgotPassword = function() {
  const titleEl = document.getElementById('auth-page-title');
  if (titleEl) titleEl.textContent = '忘記密碼';

  updateAuthTopRight(); // 👈 注入右上角按鈕

  const container = getAuthContainer();
  if (!container) return;

  container.innerHTML = `
    <!-- 🚀 白底大框背景包覆 -->
    <div style="background:#ffffff; border-radius:20px; border:2px solid #e2e8f0; padding:20px 16px; box-shadow:0 8px 24px rgba(0,0,0,0.03); margin-top:4px;">
      <p style="font-size:13px; color:var(--t2); margin-bottom:20px; font-weight:600; line-height:1.6;">
        請輸入您註冊時的電子郵件，我們將發送一組 6 位數驗證碼給您以重設密碼。<br><br>
        <span style="color:var(--red);">⚠️ 安全限制：1小時僅限1次，單日2次，7天內最多3次。</span>
      </p>
      
      <div class="fg" style="margin-bottom:24px;">
        <label style="font-weight:700; color:var(--t1);">註冊信箱</label>
        <input type="email" class="finp" id="fp-email" placeholder="您的帳號@gmail.com">
      </div>

      <div style="display:flex; gap:10px;">
        <button onclick="openAuthModal()" class="btn-acc" style="flex:1; padding:14px; background:var(--sf2); color:var(--t2); border:1px solid var(--border); font-weight:700; cursor:pointer;">返回登入</button>
        <button onclick="requestForgotPassword()" class="btn-acc" style="flex:2; padding:14px; font-size:15px; font-weight:800; border-radius:var(--rs); box-shadow:0 4px 12px rgba(255,107,53,0.3);">寄送驗證碼</button>
      </div>
    </div>
  `;
  goPage('auth', true);
};

/* 5. 重設密碼驗證碼頁面 (白框包覆) */
function showResetPasswordUI(email) {
  const titleEl = document.getElementById('auth-page-title');
  if (titleEl) titleEl.textContent = '重設密碼';

  updateAuthTopRight(); // 👈 注入右上角按鈕

  const container = getAuthContainer();
  container.innerHTML = `
    <!-- 🚀 白底大框背景包覆 -->
    <div style="background:#ffffff; border-radius:20px; border:2px solid #e2e8f0; padding:20px 16px; box-shadow:0 8px 24px rgba(0,0,0,0.03); margin-top:4px;">
      <p style="font-size:13px; color:var(--green); font-weight:700; background:var(--green-d); padding:12px; border-radius:12px; margin-bottom:16px;">
        驗證碼已發送至 ${email}<br><span style="font-size:11px; color:var(--t2);">請於 10 分鐘內輸入</span>
      </p>

      <div class="fg" style="margin-bottom:16px;">
        <label style="font-weight:700; color:var(--t1);">6 位數驗證碼</label>
        <input type="number" class="finp" id="rp-code" style="font-size:20px; letter-spacing:4px; text-align:center; font-family:var(--mono);">
      </div>

      <div class="fg" style="margin-bottom:16px;">
        <label style="font-weight:700; color:var(--t1);">設定新密碼</label>
        <input type="password" class="finp" id="rp-new" placeholder="12位含大小寫、數字與特殊符號">
      </div>

      <div style="font-size:11px; color:var(--t3); margin-bottom:24px; line-height:1.5;">
        需要密碼靈感？ <a href="https://1password.com/zh-tw/password-generator" target="_blank" style="color:var(--text-blue);">1Password 密碼生成器</a>
      </div>

      <div style="display:flex; gap:10px;">
        <button onclick="openAuthModal()" class="btn-acc" style="flex:1; padding:14px; background:var(--sf2); color:var(--t2); border:1px solid var(--border); font-weight:700; cursor:pointer;">返回登入</button>
        <button onclick="submitResetPassword('${email}')" class="btn-acc" style="flex:2; padding:14px; font-size:15px; font-weight:800; border-radius:var(--rs); box-shadow:0 4px 12px rgba(255,107,53,0.3);">✅ 驗證並重設密碼</button>
      </div>
    </div>
  `;
}

window.requestForgotPassword = async function() {
  const email = document.getElementById('fp-email').value.trim().toLowerCase();
  
  // 🌟 前端即時檢查
  const isGmail = email.endsWith('@gmail.com') || email.endsWith('@googlemail.com');
  if (!isGmail) {
    toast('⚠️ 系統僅限使用 @gmail.com 格式之信箱');
    return;
  }

  showProgress('發送請求中...');
  try {
    const res = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    finishProgress(() => {
      if (data.success) {
        toast('驗證碼，已寄出 ✅');
        showResetPasswordUI(email);
      } else {
        toast('⚠️ ' + data.message);
      }
    });
  } catch(e) { finishProgress(() => toast('連線失敗')); }
}

window.submitResetPassword = async function(email) {
  const code = document.getElementById('rp-code').value.trim();
  const pwd = document.getElementById('rp-new').value;

  const pwdRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9\s])\S{12,}$/;
  if (!pwdRegex.test(pwd)) { toast('⚠️ 密碼「強度不足」，請確認「是否符合規則」'); return; }

  showProgress('驗證與重設中...');
  try {
    const res = await fetch(`${API_BASE_URL}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, newPassword: pwd })
    });
    const data = await res.json();
    finishProgress(() => {
      if (data.success) {
        toast(data.message + '✅');
        openAuthModal(); // 回到登入畫面
      } else {
        toast('⚠️ ' + data.message);
      }
    });
  } catch(e) { finishProgress(() => toast('連線失敗')); }
}

/* ══ 真正儲存為實體檔案至本機資料夾 (File System API 或 下載) ══ */
async function confirmBackupToFile() {
  const ok = await customConfirm('是否要儲存「備份檔」到本機？');
  if (ok) {
    await doBackupToFile();
  }
}

/* ══ 建立備份資料（摘要資訊放在物件最下方） ══ */
function buildBackupPayload(fileName) {
  const tripCount = (S.records || []).filter(r => !r.isCashTip && !r.isPunchOnly).length;
  const fuelCount = (S.vehicleRecs || []).filter(r => r.type === 'fuel').length;
  const maintCount = (S.vehicleRecs || []).filter(r => r.type === 'maintenance').length;
  const expCount = (S.generalExpenses || []).length;

  // 主資料在前，摘要固定寫在最下方（JSON 最後一個 key）
  return {
    exportedAt: new Date().toISOString(),
    records: S.records || [],
    platforms: S.platforms || [],
    settings: S.settings || {},
    vehicles: S.vehicles || [],
    vehicleRecs: S.vehicleRecs || [],
    generalExpenses: S.generalExpenses || [],
    // 👇 檔案最下方：存檔摘要
    exportSummary: {
      fileName: fileName,
      tripRecords: tripCount,
      fuelRecords: fuelCount,
      maintRecords: maintCount,
      expenseRecords: expCount,
      savedAt: new Date().toLocaleString('zh-TW', { hour12: false })
    }
  };
}

/* ══ 漂浮資訊框：顯示存檔結果 ══ */
function showBackupResultBox(info) {
  const old = document.getElementById('backup-result-overlay');
  if (old) old.remove();

  const ov = document.createElement('div');
  ov.id = 'backup-result-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:999998;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,0.45);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity 0.25s ease;';

  ov.innerHTML = `
    <div style="background:#ffffff;border-radius:24px;width:100%;max-width:340px;box-shadow:0 20px 50px rgba(0,0,0,0.2);overflow:hidden;transform:translateY(16px);transition:transform 0.3s cubic-bezier(0.175,0.885,0.32,1.275);">
      <div style="background:linear-gradient(135deg,#10b981 0%,#059669 100%);padding:18px 20px;text-align:center;">
        <div style="font-size:36px;margin-bottom:6px;">✅</div>
        <div style="font-size:26px;font-weight:800;color:#fff;letter-spacing:1.5px;">存檔完成</div>
      </div>
      <div style="padding:3px 20px 8px;">
        <div style="font-size:13px;font-weight:700;color:#64748b;margin-bottom:0;">檔案名稱</div>
        <div style="font-family:var(--mono);font-size:17px;font-weight:800;color: #00aaff;background: hsl(322, 100%, 96%);padding:3px 12px;border-radius:18px;border:1px solid hsl(321, 100%, 85%);text-align:center;letter-spacing:0.8px;margin-bottom:30px;">${safeText(info.fileName)}</div>

        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 28px 10px 12px;background:#eff6ff;border-radius:12px;border:1px solid #bfdbfe;">
            <span style="font-size:14px;font-weight:700;color:#1d4ed8;">📋 行程記錄</span>
            <span style="font-family:var(--mono);font-size:18px;font-weight:900;color: #1d54ea;">${info.tripRecords} <span style="font-size:11px;font-weight:650;">筆</span></span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 28px 10px 12px;background:#fff7ed;border-radius:12px;border:1px solid #fed7aa;">
            <span style="font-size:14px;font-weight:700;color:#e84708;">⛽ 加油／換電</span>
            <span style="font-family:var(--mono);font-size:18px;font-weight:900;color: #e84708;">${info.fuelRecords} <span style="font-size:11px;font-weight:650;">筆</span></span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 28px 10px 12px;background:#ecfdf5;border-radius:12px;border:1px solid #a7f3d0;">
            <span style="font-size:14px;font-weight:700;color:#009a6e;">🔧 保養維修</span>
            <span style="font-family:var(--mono);font-size:18px;font-weight:900;color: #009a6e;">${info.maintRecords} <span style="font-size:11px;font-weight:650;">筆</span></span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 28px 10px 12px;background:#fef2f2;border-radius:12px;border:1px solid #fecdd3;">
            <span style="font-size:14px;font-weight:700;color:#e71b1b;">💸 支出花費</span>
            <span style="font-family:var(--mono);font-size:18px;font-weight:900;color: #e71b1b;">${info.expenseRecords} <span style="font-size:11px;font-weight:650;">筆</span></span>
          </div>
        </div>
      </div>
      <div style="padding:12px 20px 20px;">
        <button id="backup-result-ok" style="width:100%;padding:8px 14px;border:none;border-radius:14px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;font-size:24px;font-weight:750;cursor:pointer;box-shadow:0 4px 2px rgba(16,185,129,0.4);letter-spacing:2.5px;">知道了</button>
      </div>
    </div>
  `;

  document.body.appendChild(ov);
  requestAnimationFrame(() => {
    ov.style.opacity = '1';
    const box = ov.firstElementChild;
    if (box) box.style.transform = 'translateY(0)';
  });

  const close = () => {
    ov.style.opacity = '0';
    setTimeout(() => ov.remove(), 250);
  };
  ov.querySelector('#backup-result-ok').addEventListener('click', close);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
}

async function doBackupToFile() {
  const fileName = `外送記錄${todayStr()}.json`;
  const data = buildBackupPayload(fileName);
  const summary = data.exportSummary;
  const jsonStr = JSON.stringify(data, null, 2);

  try {
    // 優先嘗試使用 File System Access API (支援 Chrome/Edge/Android)
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types:[{ description: 'JSON File', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(jsonStr);
      await writable.close();
      
      // ✅ 只有在這裡 (真正寫入檔案完畢後) 才會更新備份時間
      updateLocalBackupTime();
      showBackupResultBox(summary);
      
    } else {
      // 蘋果 iOS / Safari 降級使用傳統下載模式
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      
      // ⚠️ 備註：傳統下載模式無法偵測使用者是否點擊取消，所以只要點了就會更新時間
      updateLocalBackupTime();
      showBackupResultBox(summary);
    }
  } catch (err) {
    // 如果使用者按了「取消」，瀏覽器會拋出 AbortError，此時什麼都不做 (也不會更新時間)
    if (err.name === 'AbortError') {
      console.log('使用者取消了儲存檔案');
    } else {
      console.error(err);
      toast('⚠️ 儲存失敗');
    }
  }
}

// 將更新時間的邏輯抽出來，讓程式碼更乾淨
function updateLocalBackupTime() {
  const now = new Date();
  S.settings.lastLocalBackup = `${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  saveSettings();
  renderSettings(); // 重新渲染設定頁面，更新顯示的時間
}

/* ══ 初次使用平台懸浮設定 (全新專屬色彩美化版) ══ */
window.checkAndPromptPlatformSetup = function() {
  // 如果已經在排隊顯示了，就不重複執行
  if (window.__initSetupPending) return;

  const isSetupCompleted = localStorage.getItem('delivery_setup_completed') === 'true';
  // 如果已經設定完成，就不用彈窗
  if (isSetupCompleted) return;

  // 確保現在人在首頁，且沒有其他重要彈窗開著，才顯示引導
  const isAnyOverlayOpen = document.querySelector('.overlay-page.show:not(#init-setup-overlay)');
  
  if (S.tab === 'home' && !isAnyOverlayOpen) {
    window.__initSetupPending = true;
    showInitialSetupModal();
  } else {
    // 如果環境不安全（例如還在切換頁面），每秒檢查一次，直到可以顯示為止
    setTimeout(checkAndPromptPlatformSetup, 1000);
  }
};

/* --- 修正：讓帳號忙碌狀態在 PWA 重啟後依然有效 --- */
function isAuthFlowBusy() {
  // 👈 [關鍵]：重啟後，DOM 的 class 會消失，所以必須先看硬碟標記
  const isAuthActive = localStorage.getItem('auth_flow_active') === 'true';
  const subPage = document.getElementById('sub-page');
  const isSubPageShow = !!(subPage && subPage.classList.contains('show'));
  
  // 如果硬碟說在忙，或者視窗真的開著，就算忙碌
  return isAuthActive || isSubPageShow || window.__authFlowLocked || window.__authTurnstileActive;
}

/* 6. 修正：成功登入後的恢復跳轉 */
function restoreAuthOriginPage() {
  let targetTab = localStorage.getItem('auth_origin_tab') || 'settings';
  if (targetTab === 'auth') targetTab = 'settings'; // 👈 防呆：避免循環跳回登入頁
  
  localStorage.removeItem('auth_flow_active'); 
  localStorage.removeItem('auth_last_active');
  localStorage.removeItem('auth_origin_tab');
  window.__authFlowLocked = false;
  
  goPage(targetTab, true);
}

function shouldBlockAuthSensitiveUi(action = 'ui') {
  if (isAuthFlowBusy()) {
    appendAuthDebugLog(`阻止 ${action}`, '帳號流程正在進行中');
    return true;
  }
  return false;
}

function setActiveTab(name, { force = false } = {}) {
  if (!force && shouldBlockAuthSensitiveUi(`切換頁面:${name}`)) return false;
  S.tab = name;
  document.body.setAttribute('data-tab', name);
  if (name) updateNavIndicator(name);
  return true;
}

function waitForSafeMomentThenShowSetup(attempt = 0) {
  const isAnyOverlayOpen = document.querySelector('.overlay-page.show');
  const isSafeMoment = S.tab === 'home' && !isAnyOverlayOpen && !isAuthFlowBusy();

  if (isSafeMoment || attempt >= 50) { // 最多等 15 秒（50 x 300ms），避免萬一條件一直不成立而永遠不出現
    window.__initSetupPending = false;
    showInitialSetupModal();
  } else {
    setTimeout(() => waitForSafeMomentThenShowSetup(attempt + 1), 300);
  }
}

// 獨立出來的點擊切換樣式邏輯
window.toggleInitPlat = function(row, platId, color) {
  const chk = row.querySelector('.init-plat-chk');
  const ring = row.querySelector('.check-ring');
  chk.checked = !chk.checked;

  if (chk.checked) {
    row.style.borderColor = color;
    row.style.backgroundColor = color + '0D'; // 加上約 5% 透明度的背景色
    ring.style.backgroundColor = color;
    ring.style.borderColor = color;
    ring.innerHTML = '<span style="color:#fff; font-size:14px; font-weight:900;">✓</span>';
  } else {
    row.style.borderColor = 'var(--border)';
    row.style.backgroundColor = '#ffffff';
    ring.style.backgroundColor = 'transparent';
    ring.style.borderColor = '#cbd5e1';
    ring.innerHTML = '';
  }
}

function showInitialSetupModal() {
  if (isAuthFlowBusy()) {
    appendAuthDebugLog(`略過首次設定視窗`, `帳號流程忙碌中`);
    window.__initSetupPending = false;
    return;
  }

  // 🛡️ 二次防呆：若畫面上已經有一份引導視窗，就不要再疊加第二份
  //    （避免出現「兩個視窗疊在一起、按鈕點不到」的狀況）
  const existing = document.getElementById('init-setup-overlay');
  if (existing) existing.remove();

  const ov = document.createElement('div');
  ov.id = 'init-setup-overlay';
  // 使用更清新的毛玻璃背景
  ov.style.cssText = "position:fixed; inset:0; background:rgba(241, 245, 249, 0.85); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); z-index:999999; display:flex; align-items:center; justify-content:center; padding:24px; opacity:0; transition:0.4s;";
  
  // 透過 DEFAULT_PLATFORMS 動態產生帶有平台專屬顏色的卡片
  let platHtml = DEFAULT_PLATFORMS.map(p => `
    <div onclick="toggleInitPlat(this, '${p.id}', '${p.color}')" style="border: 2px solid var(--border); border-radius: 16px; padding: 14px 16px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: 0.2s; background: #ffffff; box-shadow: 0 4px 10px rgba(0,0,0,0.02);">
      <div style="display:flex; align-items:center; gap: 12px;">
         <div style="width: 42px; height: 42px; border-radius: 12px; background: ${p.color}15; color: ${p.color}; display:flex; align-items:center; justify-content:center; font-size: 22px; font-weight:900;">
           ${p.name.charAt(0)}
         </div>
         <span style="font-size: 16px; font-weight: 800; color: var(--t1);">${p.name}</span>
      </div>
      <div class="check-ring" style="width: 24px; height: 24px; border-radius: 50%; border: 2px solid #cbd5e1; display:flex; align-items:center; justify-content:center; transition:0.2s;">
      </div>
      <input type="checkbox" class="init-plat-chk" value="${p.id}" style="display:none;">
    </div>
  `).join('');

  ov.innerHTML = `
    <div style="background:#fff; border-radius:24px; padding:28px 24px; width:100%; max-width:360px; box-shadow:0 20px 50px rgba(0,0,0,0.15); transform:translateY(30px); transition:0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);" id="init-setup-box">
      <h3 style="text-align:center; font-size:24px; font-weight:900; color:var(--t1); margin-bottom:8px;">歡迎使用</h3>
      <p style="text-align:center; font-size:14px; color:var(--t2); font-weight:600; margin-bottom:24px; line-height:1.5;">請先勾選您目前有在跑的外送平台<br><span style="font-size:12px; color:var(--hint-color);">(日後可在設定中隨時更改)</span></p>
      
      ${platHtml}
      
      <button id="init-setup-btn" style="width:100%; background:var(--t1); color:#fff; border:none; padding:16px; border-radius:16px; font-size:16px; font-weight:800; margin-top:12px; box-shadow:0 6px 16px rgba(0,0,0,0.2); cursor:pointer; transition:0.2s;">開始記錄 ➔</button>
    </div>
    <style>
      @keyframes waveHand { 0%, 100% { transform: rotate(0deg); } 25% { transform: rotate(-15deg); } 75% { transform: rotate(15deg); } }
      #init-setup-btn:active { transform: scale(0.96); }
    </style>
  `;
  document.body.appendChild(ov);

  requestAnimationFrame(() => {
    ov.style.opacity = '1';
    document.getElementById('init-setup-box').style.transform = 'translateY(0)';
  });

  document.getElementById('init-setup-btn').addEventListener('click', () => {
    const checks = ov.querySelectorAll('.init-plat-chk');
    let hasChecked = false;
    checks.forEach(chk => {
      const p = S.platforms.find(x => x.id === chk.value);
      if (p) p.active = chk.checked;
      if (chk.checked) hasChecked = true;
    });

    if (!hasChecked) { toast('⚠️ 請至少選擇「一個平台」'); return; }

    savePlatforms();
    localStorage.setItem('delivery_setup_completed', 'true');
    ov.remove();

    if (!isAuthFlowBusy()) {
        // 只有真的沒事才跳回首頁
        goPage('home'); 
        toast('設定完成 ✅');
    } else {
        // iOS PWA 恢復中，安靜消失
        renderHome();
        renderSettings();
    }
  });
}

/* ══ 讓「底部導覽列的滑動背景膠囊」能夠在手機轉向（直向轉橫向）、或是螢幕大小改變時，自動重新計算位置並對齊圖示。 ══ */
window.addEventListener('resize', () => { if (S.tab) updateNavIndicator(S.tab); });

/* ══ 系統啟動主流程 ══ */
async function init() {
  if (isAppInitialized) return;

  // 🌟 清除上一次因閃退或關閉瀏覽器殘留的登入鎖定標記，防止畫面卡死
  localStorage.removeItem('auth_flow_active');
  window.__authFlowLocked = false;

  try {
    await loadAll(); 
  } catch (err) {
    console.error("【啟動錯誤】資料載入失敗:", err);
    if (!S.records) S.records = [];
    if (!S.platforms) S.platforms = DEFAULT_PLATFORMS;
  } finally {
    isAppInitialized = true; 
  }

  applyBackground();
  fetchSystemSettings(); 
  initReminderCheck();

  if (window.__userWantsToSkip) {
    window.onSplashFinished();
  } else {
    setTimeout(() => {
      window.onSplashFinished();
    }, 1000);
  }
}

/* ══ 修正 Splash 與頁面恢復邏輯 (直載當前分頁，絕不亂跳首頁) ══ */
window.onSplashFinished = function() {
  const splash = document.getElementById('splash');
  if (!isAppInitialized) isAppInitialized = true;

  const isResume = sessionStorage.getItem('app_session_active') === 'true' || document.documentElement.getAttribute('data-resume') === 'true';
  const isAuthActive = localStorage.getItem('auth_flow_active') === 'true';
  const lastTab = localStorage.getItem('delivery_current_tab') || 'home';

  // 若為熱啟動/Reload，瞬間刪除 Splash
  if (isResume && splash) {
    splash.remove();
  } else if (splash) {
    splash.dataset.closing = 'true';
  }

  // 預設恢復上次最後留下的分頁
  let targetTab = lastTab;

  // 🚀【核心修正】：如果上次停留在登入頁 (auth) 或登入流程中，直接停在 auth 頁，絕不先切回首頁！
  if (targetTab === 'auth' || isAuthActive) {
    targetTab = 'auth';
  }

  // 冷啟動 (第一次開啟 APP) 才預設進入首頁
  if (!isResume) {
    targetTab = 'home';
    localStorage.removeItem('auth_flow_active');
    localStorage.removeItem('auth_last_active');
    sessionStorage.setItem('app_session_active', 'true');
  }

  try {
    if (targetTab === 'auth') {
      // 原地渲染登入頁，0 畫面跳轉
      renderAuthContent();
      goPage('auth', true);
    } else {
      goPage(targetTab, true);
    }
  } catch (e) {
    console.error('goPage error in onSplashFinished:', e);
    goPage('home', true);
  }

  // 冷啟動 (第一次開 APP) 的 Splash 淡出動畫
  if (!isResume && splash && splash.parentNode) {
    splash.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
    splash.style.opacity = '0';
    splash.style.transform = 'scale(1.05)';
    splash.style.pointerEvents = 'none';

    setTimeout(() => {
      if (splash.parentNode) splash.remove();
      try {
        if (typeof checkAndPromptPlatformSetup === 'function') checkAndPromptPlatformSetup(); 
        if (typeof checkAndShowAnnouncement === 'function') checkAndShowAnnouncement();
      } catch (e) {}
    }, 450);
  } else {
    try {
      if (typeof checkAndShowAnnouncement === 'function') checkAndShowAnnouncement();
    } catch (e) {}
  }
};

/* ══ APP 被滑回背景再點開時的「強制重新排版」與「狀態檢查」 ══ */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
     if (USER && USER.loggedIn) {
       // 從背景喚醒時，順便在背景檢查一次帳號是否超過 31 天未登入
       checkAccountStatus();
       
       // 🚨 終極防線：從背景喚醒時，若密碼依然過弱，再次攔截！
       if (USER.isPasswordWeak) {
         setTimeout(() => showForcePasswordChange(true), 100);
       }
     }
     
     // 當手機把 APP 從背景叫回來時，延遲 300 毫秒等畫面恢復
     setTimeout(() => {
       if (isAuthFlowBusy()) {
         appendAuthDebugLog(`略過背景喚醒重繪`, `帳號流程正在進行中`);
         return;
       }
       // 強迫系統重新計算當前分頁的所有內容高度，避免空白破圖！
       if (S.tab) {
         goPage(S.tab);
         updateNavIndicator(S.tab);
       }
     }, 300);
  }
});

/* ══ iOS Safari 安全啟動：確保 DOM 完全就緒後才執行所有初始化 ══
   defer 在 iOS 上不保證 DOMContentLoaded 已觸發，
   必須明確包在事件內才能防止白屏。 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    _bindNavEvents();
    init();
  });
} else {
  // readyState 已是 interactive 或 complete（reload / bfcache）
  _bindNavEvents();
  init();
}
/* ══ 7. 設定管理與啟動 結束 ═══════════════════════════════════ */


/* ══ 官方網站：長按引導彈窗與一鍵複製功能 ══ */
window.openOfficialWebsite = function() {
  const websiteUrl = 'https://reurl.cc/yOpv8y';
  
  document.getElementById('website-body').innerHTML = `
    <div style="padding:10px 20px; text-align:center;">
      <div style="font-size:54px; margin-bottom:10px;">🌐</div>

      <div style="padding:10px 8px; border-radius:16px; margin:4px 4px 30px 4px; border:2px solid #ea0f22;">
        <div style="font-size:20px; font-weight:850; color:var(--red); margin-bottom:8px;letter-spacing:1px;">⚠️ IOS <span style="color:#000;font-size:16px;">系統限制</span> 提醒</div>
        <div style="font-size:14px; font-weight:700; color:var(--t1); margin-bottom:5px; line-height:2.1;">
          請 <span style="color:var(--text-blue); font-size:18px; font-weight:900;">長按</span> 下方 <span style="color:var(--acc);font-size:18px;font-weight:750;">橘色網址</span>，<br>
          並選擇<span style="background:var(--sf2); padding:2px 5px; border-radius:6px; margin:0 4px; border:1.5px solid #24b3df;">分享…</span>⮕
          <span style="background:var(--sf2); padding:2px 5px; border-radius:6px; margin:0 4px; border:1.5px solid #24b3df;">檢視較多</span>⮕<span style="background:var(--sf2); padding:2px 5px; border-radius:6px; margin:0 4px; border:1.5px solid #24b3df;">在 Chrome 中開啟</span>
        </div>
      </div>

      <!-- 👇 長按區塊 (加上 -webkit-touch-callout 確保蘋果系統能跳出長按選單) -->
      <a href="${websiteUrl}" style="display:block; font-family:var(--mono); font-size:18px; font-weight:800; color:var(--acc); margin-bottom:50px; background:#fff5f0; padding:20px 16px; border-radius:12px; border:2px dashed var(--acc); text-decoration:none; word-break: break-all; -webkit-touch-callout: default;">
        ${websiteUrl}
      </a>
      
      <button onclick="copyWebsiteUrl('${websiteUrl}')" class="btn-acc" style="width:100%; padding:14px; font-size:18px; font-weight:750; border-radius:var(--rs); box-shadow:0 4px 12px rgba(255,107,53,0.3);">
        📋 一鍵複製網址
      </button>
    </div>
  `;
  
  openOverlay('website-page');
};
// 專屬網址複製功能 (不影響信箱複製)
window.copyWebsiteUrl = function(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      toast('網址「已複製」✅');
    }).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
  
  function fallbackCopy(t) {
    const ta = document.createElement("textarea");
    ta.value = t; ta.style.position = "fixed"; ta.style.top = "0"; ta.style.left = "0"; 
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand('copy'); toast('網址「已複製」✅'); } 
    catch (err) { toast('⚠️ 複製失敗，請「長按」手動複製'); }
    document.body.removeChild(ta);
  }
};
