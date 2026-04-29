export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // === 靜態資源請求直接交給 ASSETS ===
    if (!path.startsWith('/api')) {
      return env.ASSETS.fetch(request);
    }

    // === CORS 白名單 ===
    const origin = request.headers.get('Origin');
    const allowedOrigins = [
      'https://delivery-2ws.pages.dev',
      'https://deliveryman-records.xyz',
      'https://www.deliveryman-records.xyz',
      'http://localhost:8788'
    ];

    const isAllowed = allowedOrigins.includes(origin);

    const corsHeaders = {
      'Access-Control-Allow-Origin': isAllowed ? origin : 'https://deliveryman-records.xyz',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const jsonRes = (data, status = 200) => 
      new Response(JSON.stringify(data), { 
        status, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });

    try {
      // ==================== Argon2id 密碼雜湊函式 ====================
      let argon2 = null;

      const getArgon2 = async () => {
        if (!argon2) {
          const mod = await import('@rabbit-company/argon2id');
          argon2 = mod.argon2id;
        }
        return argon2;
      };

      /**
       * 使用 Argon2id 產生密碼雜湊
       */
      const hashPassword = async (password) => {
        const argon2id = await getArgon2();
        return await argon2id.hash(password, {
          memoryCost: 65536,   // 64MB 記憶體成本
          timeCost: 3,         // 時間成本
          parallelism: 1,      // Workers 建議保持較低
          outputLen: 32
        });
      };

      /**
       * 驗證密碼
       */
      const verifyPassword = async (password, storedHash) => {
        const argon2id = await getArgon2();
        return await argon2id.verify(storedHash, password);
      };

      // ==================== API 路由 ====================

      // === API 1: 登入與註冊 ===
      if (path === '/api/auth/login' && request.method === 'POST') {
        const { email, password, turnstileToken } = await request.json();
        if (!email || !password) return jsonRes({ success: false, message: '請填寫信箱與密碼' }, 400);

        // Turnstile 人機驗證
        if (!turnstileToken) return jsonRes({ success: false, message: '缺少人機驗證憑證' }, 403);
        
        const formData = new FormData();
        formData.append('secret', env.TURNSTILE_SECRET_KEY);
        formData.append('response', turnstileToken);

        const turnstileCheck = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          body: formData
        });
        const turnstileResult = await turnstileCheck.json();

        if (!turnstileResult.success) {
          return jsonRes({ success: false, message: '人機驗證失敗，請重試' }, 403);
        }

        let userStr = await env.DB.get(`user:${email}`);
        let user = userStr ? JSON.parse(userStr) : null;
        
        if (user && user.password) {
          // 使用 Argon2id 驗證密碼
          const isValid = await verifyPassword(password, user.password);
          if (!isValid) return jsonRes({ success: false, message: '密碼錯誤' }, 401);

          if (user.verified) {
            user.sessionToken = crypto.randomUUID();
            user.lastLoginAt = new Date().toISOString();
            await env.DB.put(`user:${email}`, JSON.stringify(user));
            return jsonRes({ success: true, message: '登入成功', user, token: user.sessionToken, directLogin: true });
          }
        } else {
          // 新註冊帳號
          const hashedPassword = await hashPassword(password);
          const role = (email === env.ADMIN_EMAIL) ? 'admin' : 'user';
          user = { 
            email, 
            password: hashedPassword, 
            role, 
            verified: false, 
            createdAt: new Date().toISOString() 
          };
        }

        // 產生驗證碼並寄信
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        user.code = code;
        user.codeExpires = Date.now() + 10 * 60000;
        await env.DB.put(`user:${email}`, JSON.stringify(user));

        const resendReq = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${env.RESEND_API_KEY}`, 
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify({
            from: 'Delivery App <noreply@send.deliveryman-records.xyz>',
            to: email,
            subject: '外送記錄與分析 APP - 帳號驗證碼',
            html: `<div style="padding:20px; font-family:sans-serif;">
                     <h2>您的驗證碼為：<span style="color:#FF6B35; letter-spacing:4px;">${code}</span></h2>
                     <p>請在 10 分鐘內於 APP 輸入完成驗證。</p>
                   </div>`
          })
        });

        if (!resendReq.ok) {
          return jsonRes({ success: false, message: '寄信失敗，請確認 Resend 設定' }, 500);
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

      return jsonRes({ success: false, message: 'API Not Found' }, 404);

    } catch (err) {
      console.error('Worker Error:', err);
      return jsonRes({ success: false, message: '伺服器錯誤', error: err.message }, 500);
    }
  }
};
