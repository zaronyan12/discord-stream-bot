const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const https = require('https');
const parser = require('xml2js').parseStringPromise;
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();

// ミドルウェア: XMLボディを生データ（Buffer）として取得
app.use(express.raw({ type: ['application/xml', 'application/atom+xml'] }));
// JSONボディも処理可能（メインアプリとの互換性用）
app.use(express.json({ type: 'application/json' }));

// 環境変数の検証
const YOUTUBE_WEBHOOK_SECRET = process.env.YOUTUBE_WEBHOOK_SECRET;
if (!YOUTUBE_WEBHOOK_SECRET) {
  console.error('エラー: YOUTUBE_WEBHOOK_SECRET が .env ファイルに設定されていません。');
  process.exit(1);
}

// HEADリクエスト対応（ヘルスチェック用）
app.head('/webhook/youtube', (req, res) => {
  console.log('HEADリクエスト受信:', { headers: req.headers });
  res.status(200).end();
});

// GETリクエスト対応（WebSub検証）
app.get('/webhook/youtube', (req, res) => {
  console.log('WebSub検証リクエスト受信:', { query: req.query });
  const challenge = req.query['hub.challenge'];
  if (challenge) {
    return res.status(200).send(challenge);
  }
  console.warn('無効なGETリクエスト:', { query: req.query });
  res.status(400).send('Invalid request');
});

// POSTリクエスト（YouTube Webhook通知）
app.post('/webhook/youtube', async (req, res) => {
  console.log('✅ /webhook/youtube にリクエストが届いた');
  console.log('req.body:', req.body);
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('xml')) {
      console.warn('非XMLリクエストを無視:', contentType);
      return res.status(200).end(); // 応答は200にする（WebSub仕様）
    }
    // リクエスト内容をログ
    console.log('YouTube Webhook受信:', {
      headers: req.headers,
      body: req.body ? req.body.toString('utf8') : 'No body',
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
        console.warn('署名検証失敗:', { signature, computedSig });
        return res.status(200).end(); // WebSub仕様では2xx応答
      }
      console.log('署名検証成功');
    } else if (signature) {
      console.warn('署名ヘッダーがあるがボディが空');
      return res.status(200).end();
    } else {
      console.log('署名ヘッダーなし、検証をスキップ');
    }

    // ボディが空の場合
    if (!req.body) {
      console.warn('リクエストボディが空です');
      return res.status(200).end();
    }

    // XMLをパース
    let data;
    try {
      data = await parser(req.body.toString('utf8'));
    } catch (parseErr) {
      console.warn('XMLパースエラー:', { message: parseErr.message });
      return res.status(200).end(); // パース失敗でも2xx応答
    }

    const entry = data.feed?.entry?.[0];
    if (!entry) {
      console.log('エントリなし、検証リクエストの可能性');
      return res.status(200).end();
    }

    const channelId = entry['yt:channelId']?.[0];
    const videoId = entry['yt:videoId']?.[0];
    const title = entry.title?.[0];
    if (!channelId || !videoId || !title) {
      console.warn('無効なデータ:', { channelId, videoId, title });
      return res.status(200).end();
    }

    // メインアプリに通知を送信（ポート3001で動作）
try {
  const response = await axios.post('https://10.138.0.4:3001/webhook/youtube', {
    channelId,
    videoId,
    title,
  }, {
    timeout: 5000,
    httpsAgent: new https.Agent({ 
    rejectUnauthorized: false // 証明書検証無効(よくわからないため、ローカル環境で送信しているため問題なし)
  })
  });
  console.log('メインアプリに通知送信成功:', {
    channelId,
    videoId,
    title,
    status: response.status,
    responseData: response.data,
  });
} catch (axiosErr) {
  console.error('メインアプリへの送信エラー:', {
    message: axiosErr.message,
    response: axiosErr.response?.data,
    status: axiosErr.response?.status,
    stack: axiosErr.stack,
  });
}

    res.status(200).end();
  } catch (err) {
    console.error('Webhook処理エラー:', {
      message: err.message,
      stack: err.stack,
      headers: req.headers,
      body: req.body ? req.body.toString('utf8') : 'No body',
    });
    res.status(500).end();
  }
});

// HTTPSサーバー起動
try {
  const options = {
    key: fs.readFileSync('/etc/letsencrypt/live/zaronyanbot.com/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/zaronyanbot.com/fullchain.pem'),
  };

  https.createServer(options, app).listen(3000, () => {
    console.log('✅ HTTPS Webhookサーバーがポート3000で起動中');
  });
} catch (err) {
  console.error('HTTPSサーバー起動エラー:', {
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
}

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log('Webhookサーバーを終了します...');
  process.exit(0);
});

process.on('uncaughtException', err => {
  console.error('未キャッチ例外:', {
    message: err.message,
    stack: err.stack,
  });
});

process.on('unhandledRejection', err => {
  console.error('未処理のPromise拒否:', {
    message: err.message,
    stack: err.stack,
  });
});

// 追加: TwitCasting Webhook転送 (開始)
// ==============================================
app.post('/webhook/twitcasting', async (req, res) => {
  console.log('✅ /webhook/twitcasting にリクエストが届いた');
  console.log('TwitCasting Webhook受信:', {
    headers: req.headers,
    body: req.body,
  });
      // ペイロードのバリデーション
    const { event, user_id, live_id } = req.body;
    if (!event || !user_id || !live_id) {
      console.warn('無効なペイロード:', req.body);
      return res.status(200).end();
    }

  try {
    // メインアプリに転送
    // メインアプリに転送
    const response = await axios.post('https://10.138.0.4:3001/webhook/twitcasting', req.body, {
      timeout: 5000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }) // 本番では証明書を設定
    });
    console.log('TwitCasting通知送信成功:', {
      event,
      user_id,
      live_id,
      status: response.status,
      responseData: response.data,
    });

    res.status(200).end();
  } catch (err) {
    console.error('TwitCasting Webhook処理エラー:', {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status,
      stack: err.stack,
    });
    res.status(500).end();
  }
});
// 追加: TwitCasting Webhook転送 (終了)
// ==============================================