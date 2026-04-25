export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // === 【關鍵修復】===
    // 如果請求路徑不是以 /api 開頭，代表是要讀取網頁 (index.html, css, js, 圖片等)
    // 直接將請求交還給 Cloudflare Pages 的靜態資源伺服器
    if (!path.startsWith('/api')) {
      return env.ASSETS.fetch(request);
    }

    // === 以下為 API 專屬處理邏輯 ===
    // === 安全設定：CORS 白名單過濾 ===
    // 取得呼叫 API 的來源網址
    const origin = request.headers.get('Origin');
    
    // 定義允許通行的網域白名單 (包含 HTTPS 專屬網域與 Pages 預設網域)
    const allowedOrigins = [
      'https://delivery-2ws.pages.dev',
      'https://deliveryman-records.xyz',
      'https://www.deliveryman-records.xyz', // 包含 www 的版本
      'http://localhost:8788'                // 預留給您未來在電腦本地端測試用
    ];

    // 檢查來源是否在白名單內
    const isAllowed = allowedOrigins.includes(origin);

    // 如果不在白名單內，就回傳您的主網域(讓瀏覽器判定來源不符而阻擋)
    const corsHeaders = {
      'Access-Control-Allow-Origin': isAllowed ? origin : 'https://deliveryman-records.xyz',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const jsonRes = (data, status = 200) => 
      new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    try {
      // 密碼加密函式
      const hashPassword = async (pwd, salt) => {
        const data = new TextEncoder().encode(pwd + salt);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
      };

      // === API 1: 登入與註冊 ===
      if (path === '/api/auth/login' && request.method === 'POST') {
        // 👇 接收前端傳來的 turnstileToken
        const { email, password, turnstileToken } = await request.json();
        if (!email || !password) return jsonRes({ success: false, message: '請填寫信箱與密碼' }, 400);

        // 👇 呼叫 Cloudflare 驗證這串 Token 是不是合法的真人
        if (!turnstileToken) return jsonRes({ success: false, message: '缺少人機驗證憑證' }, 403);
        
        const formData = new FormData();
        formData.append('secret', env.TURNSTILE_SECRET_KEY); // 從環境變數讀取您的 Secret Key
        formData.append('response', turnstileToken);

        const turnstileCheck = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          body: formData
        });
        const turnstileResult = await turnstileCheck.json();

        if (!turnstileResult.success) {
          return jsonRes({ success: false, message: '人機驗證失敗，請重試' }, 403);
        }
        // 👆 驗證完成，接下來才是原本的資料庫檢查邏輯

        let userStr = await env.DB.get(`user:${email}`);
        let user = userStr ? JSON.parse(userStr) : null;
        
        if (user) {
          const hashedInput = await hashPassword(password, user.salt);
          if (hashedInput !== user.password) return jsonRes({ success: false, message: '密碼錯誤' }, 401);

          if (user.verified) {
            user.sessionToken = crypto.randomUUID();
            user.lastLoginAt = new Date().toISOString();
            await env.DB.put(`user:${email}`, JSON.stringify(user));
            return jsonRes({ success: true, message: '登入成功', user, token: user.sessionToken, directLogin: true });
          }
        } else {
          const salt = crypto.randomUUID();
          const hashedPassword = await hashPassword(password, salt);
          // 若信箱與環境變數 ADMIN_EMAIL 相同則設為 admin
          const role = (email === env.ADMIN_EMAIL) ? 'admin' : 'user';
          user = { email, password: hashedPassword, salt, role, verified: false, createdAt: new Date().toISOString() };
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        user.code = code;
        user.codeExpires = Date.now() + 10 * 60000;
        await env.DB.put(`user:${email}`, JSON.stringify(user));

        // 呼叫 Resend 寄發驗證碼
        const resendReq = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Delivery App <noreply@send.deliveryman-records.xyz>', // 需確保與 Resend 設定的寄件人相符
            to: email,
            subject: '外送記錄與分析 APP - 帳號驗證碼',
            html: `<div style="padding:20px; font-family:sans-serif;"><h2>您的驗證碼為：<span style="color:#FF6B35; letter-spacing:4px;">${code}</span></h2><p>請在 10 分鐘內於 APP 輸入完成驗證。</p></div>`
          })
        });

        if (!resendReq.ok) {
           const errData = await resendReq.json();
           return jsonRes({ success: false, message: '寄信失敗，請確認 Resend 設定或信箱是否為註冊信箱' }, 500);
        }

        return jsonRes({ success: true, message: '驗證碼已寄出', directLogin: false });
      }

      // === API 2: 驗證 ===
      if (path === '/api/auth/verify' && request.method === 'POST') {
        const { email, code } = await request.json();
        let userStr = await env.DB.get(`user:${email}`);
        if (!userStr) return jsonRes({ success: false, message: '找不到帳號' }, 404);
        
        let user = JSON.parse(userStr);
        if (user.code !== code || Date.now() > user.codeExpires) {
          return jsonRes({ success: false, message: '驗證碼錯誤或已過期' }, 400);
        }

        user.verified = true;
        user.code = null;
        user.sessionToken = crypto.randomUUID();
        user.lastLoginAt = new Date().toISOString();
        await env.DB.put(`user:${email}`, JSON.stringify(user));

        return jsonRes({ success: true, message: '登入成功', user, token: user.sessionToken });
      }

      // === API 3: 檢查存活 ===
      if (path === '/api/auth/check' && request.method === 'POST') {
        const { email, token } = await request.json();
        let userStr = await env.DB.get(`user:${email}`);
        if (!userStr) return jsonRes({ active: false, reason: 'deleted' });
        
        let user = JSON.parse(userStr);
        if (!user.verified) return jsonRes({ active: false, reason: 'deleted' });
        if (user.sessionToken !== token) return jsonRes({ active: false, reason: 'kicked', kickedAt: user.lastLoginAt });
        
        return jsonRes({ active: true });
      }

      // === API 4: 系統統計 ===
      if (path === '/api/stats' && request.method === 'GET') {
        const { keys } = await env.DB.list({ prefix: 'user:' });
        let verifiedCount = 0;
        for (let key of keys) {
          let userStr = await env.DB.get(key.name);
          if (userStr) {
             let u = JSON.parse(userStr);
             if (u.verified) verifiedCount++;
          }
        }
        return jsonRes({ success: true, total: keys.length, verified: verifiedCount });
      }

      // === API 5: 管理員取得清單 ===
      if (path === '/api/admin/users' && request.method === 'POST') {
        const { adminEmail, token } = await request.json();
        
        let adminStr = await env.DB.get(`user:${adminEmail}`);
        if (!adminStr) return jsonRes({ success: false, message: '權限不足' }, 403);
        
        let admin = JSON.parse(adminStr);
        if (admin.sessionToken !== token || admin.role !== 'admin') {
          return jsonRes({ success: false, message: '權限不足' }, 403);
        }

        const { keys } = await env.DB.list({ prefix: 'user:' });
        let users = [];
        
        for (let key of keys) {
          let uStr = await env.DB.get(key.name);
          if (uStr) {
             let u = JSON.parse(uStr);
             users.push({
               email: u.email,
               role: u.role,
               verified: u.verified,
               createdAt: u.createdAt
             });
          }
        }
        
        users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return jsonRes({ success: true, users });
      }

      // === API 6: 管理員刪除帳號 ===
      if (path === '/api/admin/delete' && request.method === 'POST') {
        const { adminEmail, token, targetEmail } = await request.json();
        
        let adminStr = await env.DB.get(`user:${adminEmail}`);
        if (!adminStr) return jsonRes({ success: false, message: '權限不足' }, 403);
        
        let admin = JSON.parse(adminStr);
        if (admin.sessionToken !== token || admin.role !== 'admin') {
          return jsonRes({ success: false, message: '權限不足' }, 403);
        }

        await env.DB.delete(`user:${targetEmail}`);
        return jsonRes({ success: true, message: '帳號已刪除' });
      }

      // 如果找不到 /api/ 下的路由
      return jsonRes({ success: false, message: 'API Not Found' }, 404);

    } catch (err) {
      // 捕捉伺服器錯誤
      return jsonRes({ success: false, message: '伺服器錯誤', error: err.message }, 500);
    }
  }
};
