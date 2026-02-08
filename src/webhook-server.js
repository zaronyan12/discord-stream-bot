const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const https = require('https');
const parser = require('xml2js').parseStringPromise;
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();

// ==============================================
// 環境変数の検証
// ==============================================
const {
  YOUTUBE_WEBHOOK_SECRET,
  SERVER_URL = 'https://zaronyanbot.com'
} = process.env;

if (!YOUTUBE_WEBHOOK_SECRET) {
  console.error('エラー: YOUTUBE_WEBHOOK_SECRET が .env ファイルに設定されていません。');
  process.exit(1);
}

console.log('✅ Webhookサーバー起動準備完了');
console.log('サーバーURL:', SERVER_URL);

// ==============================================
// ミドルウェア設定
// ==============================================

// XMLボディを生データ（Buffer）として取得
app.use(express.raw({ 
  type: ['application/xml', 'application/atom+xml'],
  limit: '1mb'  // リクエストサイズ制限
}));

// JSONボディも処理可能（メインアプリとの互換性用）
app.use(express.json({ 
  type: 'application/json',
  limit: '1mb'
}));

// ==============================================
// ヘルスチェックエンドポイント
// ==============================================

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'webhook-server'
  });
});

// ==============================================
// YouTube Webhook エンドポイント
// ==============================================

// HEADリクエスト対応（ヘルスチェック用）
app.head('/webhook/youtube', (req, res) => {
  console.log('HEADリクエスト受信:', { 
    clientIp: req.ip,
    headers: req.headers 
  });
  res.status(200).end();
});

// GETリクエスト対応（WebSub検証）
app.get('/webhook/youtube', (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  console.log('WebSub検証リクエスト受信:', { 
    clientIp,
    query: req.query 
  });
  
  const challenge = req.query['hub.challenge'];
  if (challenge) {
    console.log('WebSubチャレンジ応答:', challenge);
    return res.status(200).send(challenge);
  }
  
  console.warn('無効なGETリクエスト:', { query: req.query });
  res.status(400).send('Invalid request: hub.challenge parameter required');
});

// POSTリクエスト（YouTube Webhook通知）
app.post('/webhook/youtube', async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  console.log('✅ YouTube Webhook受信開始');
  
  try {
    const contentType = req.headers['content-type'] || '';
    
    // Content-Typeチェック
    if (!contentType.includes('xml') && !contentType.includes('atom')) {
      console.warn('非XMLリクエストを無視:', contentType);
      return res.status(200).end(); // WebSub仕様では2xx応答
    }
    
    // リクエスト内容をログ
    const rawBody = req.body ? req.body.toString('utf8') : 'No body';
    console.log('YouTube Webhookデータ:', {
      clientIp,
      contentType,
      bodyLength: rawBody.length,
      headers: {
        'x-hub-signature': req.headers['x-hub-signature'],
        'user-agent': req.headers['user-agent']
      }
    });

    // 署名検証
    const signature = req.headers['x-hub-signature'];
    if (signature && req.body) {
      const [algo, sig] = signature.split('=');
      if (algo !== 'sha1') {
        console.warn('サポートされていない署名アルゴリズム:', { algo, signature });
        return res.status(200).end(); // WebSub仕様では2xx応答
      }
      
      const hmac = crypto.createHmac('sha1', YOUTUBE_WEBHOOK_SECRET);
      hmac.update(req.body); // Bufferとして渡す
      const computedSig = hmac.digest('hex');
      
      if (sig !== computedSig) {
        console.warn('署名検証失敗:', { 
          signature, 
          computedSig,
          clientIp 
        });
        return res.status(200).end(); // WebSub仕様では2xx応答
      }
      console.log('✅ 署名検証成功');
    } else if (signature) {
      console.warn('署名ヘッダーがあるがボディが空');
      return res.status(200).end();
    } else {
      console.log('署名ヘッダーなし、検証をスキップ');
    }

    // ボディが空の場合
    if (!req.body || req.body.length === 0) {
      console.warn('リクエストボディが空です');
      return res.status(200).end();
    }

    // XMLをパース
    let data;
    try {
      data = await parser(req.body.toString('utf8'));
      console.log('XMLパース成功');
    } catch (parseErr) {
      console.warn('XMLパースエラー:', { 
        message: parseErr.message,
        bodyPreview: rawBody.substring(0, 200) 
      });
      return res.status(200).end(); // パース失敗でも2xx応答
    }

    const entry = data.feed?.entry?.[0];
    if (!entry) {
      console.log('エントリなし、検証リクエストの可能性');
      return res.status(200).end();
    }

    // データ抽出
    const channelId = entry['yt:channelId']?.[0];
    const videoId = entry['yt:videoId']?.[0];
    const title = entry.title?.[0];
    const published = entry.published?.[0];
    
    if (!channelId || !videoId || !title) {
      console.warn('無効なデータ:', { channelId, videoId, title });
      return res.status(200).end();
    }

    console.log('抽出データ:', { 
      channelId, 
      videoId, 
      title,
      published,
      entryType: entry['yt:channelId'] ? 'channel' : '不明'
    });

    // メインアプリに通知を送信（ポート3001で動作）
    try {
      const mainAppUrl = process.env.MAIN_APP_URL || 'https://10.138.0.4:3001';
      const response = await axios.post(`${mainAppUrl}/webhook/youtube`, {
        channelId,
        videoId,
        title,
        published
      }, {
        timeout: 10000, // 10秒タイムアウト
        httpsAgent: new https.Agent({ 
          rejectUnauthorized: false // 自己署名証明書用
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': clientIp,
          'User-Agent': 'Webhook-Server/1.0'
        }
      });
      
      console.log('✅ メインアプリに通知送信成功:', {
        channelId,
        videoId,
        status: response.status,
        responseTime: response.headers['x-response-time']
      });
    } catch (axiosErr) {
      console.error('メインアプリへの送信エラー:', {
        message: axiosErr.message,
        code: axiosErr.code,
        status: axiosErr.response?.status,
        responseData: axiosErr.response?.data,
        url: axiosErr.config?.url
      });
      
      // リトライロジック（オプション）
      if (axiosErr.code === 'ECONNREFUSED') {
        console.error('メインアプリへの接続に失敗しました。アプリが起動しているか確認してください。');
      }
    }

    res.status(200).end();
    
  } catch (err) {
    console.error('❌ YouTube Webhook処理エラー:', {
      message: err.message,
      stack: err.stack,
      clientIp: req.ip,
      headers: req.headers,
      bodyLength: req.body?.length || 0
    });
    
    // クライアントには成功を返す（WebSub仕様）
    res.status(200).end();
  }
});

// ==============================================
// TwitCasting Webhook エンドポイント
// ==============================================

// GETリクエスト（ヘルスチェック用）
app.get('/webhook/twitcasting', (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  console.log('TwitCasting Webhook GETリクエスト:', { 
    clientIp,
    query: req.query 
  });
  
  res.status(200).json({ 
    status: 'ready',
    service: 'twitcasting-webhook',
    timestamp: new Date().toISOString()
  });
});

// POSTリクエスト（TwitCasting Webhook通知）
app.post('/webhook/twitcasting', async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  const startTime = Date.now();
  
  console.log('🔔 TwitCasting Webhook受信開始');
  
  try {
    // リクエスト内容をログ
    console.log('TwitCasting Webhookデータ:', {
      clientIp,
      contentType: req.headers['content-type'],
      body: req.body,
      headers: {
        'user-agent': req.headers['user-agent'],
        'x-twitcasting-webhook-id': req.headers['x-twitcasting-webhook-id']
      }
    });

    // ボディ検証
    if (!req.body || typeof req.body !== 'object') {
      console.warn('無効なリクエストボディ');
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const { 
      event, 
      user_id: webhookUserId, 
      user_name: userName, 
      movie_id: liveId, 
      title,
      created 
    } = req.body;

    // 必須パラメータチェック
    if (!event || !webhookUserId || !userName || !liveId || !title) {
      console.warn('必須パラメータ不足:', { 
        event, webhookUserId, userName, liveId, title 
      });
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // イベントタイプチェック
    if (event !== 'live_start') {
      console.log(`イベント無視: ${event}`);
      return res.status(200).json({ status: 'ignored', event });
    }

    console.log('TwitCasting Webhook詳細:', {
      event,
      webhookUserId,
      userName,
      liveId,
      title,
      created,
      clientIp
    });

    // メインアプリに転送
    try {
      const mainAppUrl = process.env.MAIN_APP_URL || 'https://10.138.0.4:3001';
      const response = await axios.post(`${mainAppUrl}/webhook/twitcasting`, {
        event,
        user_id: webhookUserId,
        user_name: userName,
        movie_id: liveId,
        title,
        created,
        received_at: new Date().toISOString()
      }, {
        timeout: 10000,
        httpsAgent: new https.Agent({ 
          rejectUnauthorized: false
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': clientIp,
          'X-Webhook-Source': 'twitcasting',
          'User-Agent': 'Webhook-Server/1.0'
        }
      });

      const responseTime = Date.now() - startTime;
      
      console.log('✅ TwitCasting Webhook転送成功:', {
        webhookUserId,
        liveId,
        status: response.status,
        responseTime: `${responseTime}ms`
      });

      // メインアプリからの応答をそのまま返す
      res.status(response.status).json({
        ...response.data,
        forwarded: true,
        response_time: responseTime
      });
      
    } catch (forwardErr) {
      console.error('❌ TwitCasting Webhook転送エラー:', {
        message: forwardErr.message,
        code: forwardErr.code,
        status: forwardErr.response?.status,
        responseData: forwardErr.response?.data,
        webhookUserId,
        liveId
      });

      const errorResponse = {
        error: 'forward_failed',
        message: forwardErr.message,
        received_at: new Date().toISOString()
      };

      // 接続エラーの場合は503を返す
      if (forwardErr.code === 'ECONNREFUSED' || forwardErr.code === 'ETIMEDOUT') {
        res.status(503).json({
          ...errorResponse,
          suggestion: 'メインアプリが起動していません'
        });
      } else {
        res.status(500).json(errorResponse);
      }
    }
    
  } catch (err) {
    console.error('❌ TwitCasting Webhook処理エラー:', {
      message: err.message,
      stack: err.stack,
      clientIp,
      body: req.body
    });
    
    res.status(500).json({ 
      error: 'internal_server_error',
      message: 'Webhook processing failed'
    });
  }
});

// ==============================================
// その他のWebhookエンドポイント（拡張用）
// ==============================================

// Twitch Webhook（将来の拡張用）
app.post('/webhook/twitch', async (req, res) => {
  console.log('Twitch Webhook受信（未実装）:', { body: req.body });
  res.status(501).json({ error: 'Not implemented' });
});

// 汎用Webhookテストエンドポイント
app.post('/webhook/test', (req, res) => {
  console.log('テストWebhook受信:', {
    body: req.body,
    headers: req.headers,
    ip: req.ip
  });
  
  res.status(200).json({ 
    status: 'received',
    timestamp: new Date().toISOString(),
    your_data: req.body
  });
});

// ==============================================
// エラーハンドリング
// ==============================================

// 404エラー
app.use((req, res) => {
  console.warn('404 Not Found:', {
    method: req.method,
    url: req.url,
    ip: req.ip
  });
  
  res.status(404).json({ 
    error: 'not_found',
    message: `Endpoint ${req.method} ${req.url} not found`
  });
});

// エラーハンドラー
app.use((err, req, res, next) => {
  console.error('❌ サーバーエラー:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });
  
  res.status(500).json({ 
    error: 'internal_server_error',
    message: 'An unexpected error occurred'
  });
});

// ==============================================
// HTTPSサーバー起動
// ==============================================

const PORT = process.env.WEBHOOK_PORT || 3000;
const HOST = process.env.WEBHOOK_HOST || '0.0.0.0';

try {
  // SSL証明書の読み込み
  const sslOptions = {
    key: fs.readFileSync('/etc/letsencrypt/live/zaronyanbot.com/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/zaronyanbot.com/fullchain.pem'),
    // 必要に応じて追加設定
    minVersion: 'TLSv1.2',
    secureOptions: require('constants').SSL_OP_NO_SSLv3 | require('constants').SSL_OP_NO_TLSv1
  };

  // HTTPSサーバー作成
  const server = https.createServer(sslOptions, app);

  server.listen(PORT, HOST, () => {
    console.log('='.repeat(50));
    console.log('✅ HTTPS Webhookサーバー起動成功');
    console.log(`📍 ポート: ${PORT}`);
    console.log(`📍 ホスト: ${HOST}`);
    console.log(`📍 環境: ${process.env.NODE_ENV || 'development'}`);
    console.log('='.repeat(50));
    console.log('利用可能なエンドポイント:');
    console.log(`  GET  /health - ヘルスチェック`);
    console.log(`  POST /webhook/youtube - YouTube Webhook`);
    console.log(`  POST /webhook/twitcasting - TwitCasting Webhook`);
    console.log(`  POST /webhook/test - テスト用`);
    console.log('='.repeat(50));
  });

  // サーバーイベントハンドラー
  server.on('error', (error) => {
    console.error('❌ サーバー起動エラー:', {
      message: error.message,
      code: error.code,
      port: PORT
    });
    
    if (error.code === 'EADDRINUSE') {
      console.error(`ポート ${PORT} は既に使用中です`);
    }
    
    process.exit(1);
  });

  server.on('clientError', (err, socket) => {
    console.warn('クライアントエラー:', err.message);
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

} catch (err) {
  console.error('❌ HTTPSサーバー起動エラー:', {
    message: err.message,
    stack: err.stack,
    port: PORT,
    host: HOST
  });
  
  // SSL証明書エラーの場合のフォールバック
  if (err.code === 'ENOENT') {
    console.error('SSL証明書ファイルが見つかりません');
    console.error('パスを確認してください: /etc/letsencrypt/live/zaronyanbot.com/');
  }
  
  process.exit(1);
}

// ==============================================
// プロセス管理
// ==============================================

// グレースフルシャットダウン
function gracefulShutdown(signal) {
  console.log(`📴 ${signal}受信、サーバーを終了します...`);
  
  // 必要に応じてクリーンアップ処理を追加
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 未キャッチ例外
process.on('uncaughtException', (err) => {
  console.error('❌ 未キャッチ例外:', {
    message: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString()
  });
  
  // 必要に応じて再起動ロジックを追加
  setTimeout(() => process.exit(1), 1000);
});

// 未処理のPromise拒否
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ 未処理のPromise拒否:', {
    reason: reason?.message || reason,
    stack: reason?.stack,
    promise
  });
});

// ==============================================
// ヘルパー関数
// ==============================================

/**
 * IPアドレスの検証（簡易版）
 */
function isValidIp(ip) {
  // IPv4, IPv6, ローカルアドレスのチェック
  const ipPatterns = [
    /^(\d{1,3}\.){3}\d{1,3}$/, // IPv4
    /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/, // IPv6（簡易）
    /^(::1|127\.0\.0\.1|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/ // ローカル
  ];
  
  return ipPatterns.some(pattern => pattern.test(ip));
}

/**
 * リクエストロガー（ミドルウェア用）
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
}

// リクエストロガーを有効化
app.use(requestLogger);
