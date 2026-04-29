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
      // ==================== PBKDF2 高安全密碼雜湊函式 ====================
      const hashPassword = async (password) => {
        const encoder = new TextEncoder();
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const saltHex = Array.from(salt)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');

        const keyMaterial = await crypto.subtle.importKey(
          "raw",
          encoder.encode(password),
          { name: "PBKDF2" },
          false,
          ["deriveBits"]
        );

        const hashBuffer = await crypto.subtle.deriveBits(
          {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
          },
          keyMaterial,
          256
        );

        const hashHex = Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');

        return `${saltHex}$${hashHex}`;
      };

      const verifyPassword = async (password, storedHash) => {
        if (!storedHash || !storedHash.includes('$')) return false;

        const [saltHex, expectedHash] = storedHash.split('$');
        const encoder = new TextEncoder();

        const salt = new Uint8Array(
          saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
        );

        const keyMaterial = await crypto.subtle.importKey(
          "raw",
          encoder.encode(password),
          { name: "PBKDF2" },
          false,
          ["deriveBits"]
        );

        const hashBuffer = await crypto.subtle.deriveBits(
          {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
          },
          keyMaterial,
          256
        );

        const hashHex = Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');

        return hashHex === expectedHash;
      };

      // ==================== API 路由 ====================

      if (path === '/api/auth/login' && request.method === 'POST') {
        const { email, password, turnstileToken } = await request.json();
        if (!email || !password) return jsonRes({ success: false, message: '請填寫信箱與密碼' }, 400);

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
          const isValid = await verifyPassword(password, user.password);
          if (!isValid) return jsonRes({ success: false, message: '密碼錯誤' }, 401);

          if (user.verified) {
            user.sessionToken = crypto.randomUUID();
            user.lastLoginAt = new Date().toISOString();
            await env.DB.put(`user:${email}`, JSON.stringify(user));
            return jsonRes({ success: true, message: '登入成功', user, token: user.sessionToken, directLogin: true });
          }
        } else {
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
