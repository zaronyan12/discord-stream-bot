const { Client, GatewayIntentBits, PermissionsBitField, SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, TextInputBuilder, TextInputStyle, ModalBuilder, ChannelType, AttachmentBuilder } = require('discord.js');
  const express = require('express');
  const axios = require('axios');
  const iconv = require('iconv-lite');
  const path = require('path');
  const fs = require('fs');
  const fsPromises = require('fs').promises;
  const https = require('https');
  const crypto = require('crypto');
  require('dotenv').config({ path: path.join(__dirname, '../.env') });　
  
  // 環境変数
  const {
    DISCORD_TOKEN,
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    REDIRECT_URI,
    TWITCH_CLIENT_ID,
    TWITCH_CLIENT_SECRET,
    YOUTUBE_API_KEY,
    YOUTUBE_WEBHOOK_SECRET,
    TWITCASTING_CLIENT_ID,
    TWITCASTING_CLIENT_SECRET,
    ADMIN_PASSWORD,
    BOT_CREATOR_ID
  } = process.env;
  
  // ファイルパス
  const DATA_DIR = path.join(__dirname, '../data');
  const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
  const STREAMERS_FILE = path.join(DATA_DIR, 'tbs.json');
  const YOUTUBERS_FILE = path.join(DATA_DIR, 'youtubers.json');
  const TWITCASTERS_FILE = path.join(DATA_DIR, 'twitcasters.json');
  const SERVER_SETTINGS_FILE = path.join(DATA_DIR, 'serverSettings.json');
  const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');
  const MAZAKARI_FILE = path.join(DATA_DIR, 'mazakari.json');
  const CREATORS_FILE = path.join(DATA_DIR, 'creators.json');
  
  // キャッシュ
  const cache = {
    config: null,
    streamers: null,
    youtubers: null,
    twitcasters: null,
    serverSettings: null,
    admins: null,
    mazakari: null,
    creators: null
  };
  
  // 配信中の状態を追跡するキャッシュ
  const activeStreams = {
    twitch: new Map(),
    youtube: new Map(),
    twitcasting: new Map()
  };
  
  // /mazakariのファイル待ち状態
  const pendingMazakari = new Map();
  const welcomeChannels = new Map();
  
  // Discordクライアント
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent
    ]
  });
  
  // Expressアプリ
  const app = express();
  app.use(express.json());
  
  // ==============================================
  // 共通ユーティリティ関数
  // ==============================================
  
  /**
   * 設定ファイルを読み込む共通関数
   * @param {string} filePath ファイルパス
   * @param {any} defaultValue デフォルト値
   * @param {boolean} force キャッシュを無視して再読み込みするか
   * @returns {Promise<any>} 読み込んだデータ
   */
  async function loadConfigFile(filePath, defaultValue = null, force = false) {
    const cacheKey = path.basename(filePath, '.json');
    if (!force && cache[cacheKey]) {
      console.log(`${cacheKey}キャッシュを使用`);
      return cache[cacheKey];
    }
  
    try {
      console.log(`${cacheKey}を読み込み中:`, filePath);
      const data = await fsPromises.readFile(filePath, 'utf8');
      cache[cacheKey] = JSON.parse(data);
      console.log(`${cacheKey}読み込み成功`);
      return cache[cacheKey];
    } catch (err) {
      console.warn(`${cacheKey}が見つからないか無効です。デフォルトを使用します:`, err.message);
      cache[cacheKey] = defaultValue;
      return cache[cacheKey];
    }
  }
  
  /**
   * 設定ファイルを保存する共通関数
   * @param {string} filePath ファイルパス
   * @param {any} data 保存するデータ
   * @returns {Promise<void>}
   */
  async function saveConfigFile(filePath, data) {
    const cacheKey = path.basename(filePath, '.json');
    try {
      console.log(`${cacheKey}を保存中:`, filePath);
      cache[cacheKey] = data;
      await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2));
      console.log(`${cacheKey}保存成功`);
    } catch (err) {
      console.error(`${cacheKey}保存エラー:`, err.message);
      throw err;
    }
  }
  
  async function clearAllCommands(guildId = null) {
    const target = guildId ? client.guilds.cache.get(guildId) : client.application;
    if (!target) {
      console.error(`コマンドクリア対象が見つかりません: ${guildId || 'グローバル'}`);
      return false;
    }
  
    try {
      await target.commands.set([]);
      console.log(`スラッシュコマンドをクリアしました (対象: ${guildId || 'グローバル'})`);
      return true;
    } catch (err) {
      console.error(`スラッシュコマンドクリア失敗 (対象: ${guildId || 'グローバル'}):`, {
        message: err.message,
        stack: err.stack
      });
      return false;
    }
  }
  
  /**
   * 配信チャンネルURLを解析
   * @param {string} url 入力されたURL
   * @returns {{ platform: string, id: string }|null} プラットフォームとID、または無効ならnull
   */
  function parseStreamUrl(url) {
    // YouTube: チャンネルID形式
    const youtubeChannelIdRegex = /youtube\.com\/channel\/(UC[0-9A-Za-z_-]{21}[AQgw])/;
    // YouTube: ハンドル形式 (@xxxx)
    const youtubeHandleRegex = /youtube\.com\/(?:channel\/|c\/|user\/|)?@([a-zA-Z0-9_-]+)/;
    const twitchRegex = /twitch\.tv\/([a-zA-Z0-9_]+)/;
    const twitcastingRegex = /twitcasting\.tv\/(g:[0-9a-zA-Z_-]+|[a-zA-Z0-9_\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]+)/u;
  
    if (youtubeChannelIdRegex.test(url)) {
      const match = url.match(youtubeChannelIdRegex);
      return { platform: 'youtube', id: match[1], type: 'channelId' };
    } else if (youtubeHandleRegex.test(url)) {
      const match = url.match(youtubeHandleRegex);
      return { platform: 'youtube', id: `@${match[1]}`, type: 'handle' };
    } else if (twitchRegex.test(url)) {
      const match = url.match(twitchRegex);
      return { platform: 'twitch', id: match[1], type: 'username' };
    } else if (twitcastingRegex.test(url)) {
      const match = url.match(twitcastingRegex);
      return { platform: 'twitcasting', id: match[1], type: 'username' };
    }
    return null;
  }
  
  // ==============================================
  // 設定ファイルの読み込み/保存関数
  // ==============================================
  
  async function loadConfig(force = false) {
    return loadConfigFile(CONFIG_FILE, { youtubeAccountLimit: 0, twitcastingAccountLimit: 25 }, force);
  }
  
  async function loadStreamers(force = false) {
    return loadConfigFile(STREAMERS_FILE, [], force);
  }
  
  async function loadYoutubers(force = false) {
    const youtubers = await loadConfigFile(YOUTUBERS_FILE, [], force);
    return youtubers.map(y => ({ ...y, guildIds: y.guildIds || [] }));
  }
  
  async function loadTwitcasters(force = false) {
    return loadConfigFile(TWITCASTERS_FILE, [], force);
  }
  
  async function loadServerSettings(force = false) {
    return loadConfigFile(SERVER_SETTINGS_FILE, { servers: {} }, force);
  }
  
  async function loadAdmins(force = false) {
    return loadConfigFile(ADMINS_FILE, { admins: [BOT_CREATOR_ID] }, force);
  }
  
  async function loadMazakari(force = false) {
    return loadConfigFile(MAZAKARI_FILE, { enabled: {}, guilds: {} }, force);
  }
  
  async function loadCreators(force = false) {
    const creators = await loadConfigFile(CREATORS_FILE, { creators: [BOT_CREATOR_ID] }, force);
    if (!creators.creators || !Array.isArray(creators.creators)) {
      console.warn('creators.jsonにcreators配列がありません。デフォルトを設定します。');
      const defaultCreators = { creators: [BOT_CREATOR_ID] };
      await saveConfigFile(CREATORS_FILE, defaultCreators);
      return defaultCreators;
    }
    return creators;
  }
  
  async function saveCreators(creators) {
    const validCreators = creators && Array.isArray(creators.creators) ? creators : { creators: [BOT_CREATOR_ID] };
    return saveConfigFile(CREATORS_FILE, validCreators);
  }
  
  // ==============================================
  // API関連関数
  // ==============================================
  
  /**
   * Twitchアクセストークンを取得
   * @returns {Promise<string>} アクセストークン
   */
  async function getTwitchAccessToken() {
    try {
      const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
        params: {
          client_id: TWITCH_CLIENT_ID,
          client_secret: TWITCH_CLIENT_SECRET,
          grant_type: 'client_credentials'
        }
      });
      return response.data.access_token;
    } catch (err) {
      console.error('Twitchアクセストークン取得エラー:', err.message);
      throw err;
    }
  }
  
  /**
   * YouTube動画情報を取得
   * @param {string} videoId 動画ID
   * @returns {Promise<Object|null>} 動画情報
   */
  async function getYouTubeVideoInfo(videoId) {
    try {
      const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: { 
          part: 'liveStreamingDetails,snippet', 
          id: videoId, 
          key: YOUTUBE_API_KEY 
        },
        timeout: 5000
      });
      return response.data.items?.[0] || null;
    } catch (err) {
      console.error('YouTube APIエラー:', {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
        videoId
      });
      return null;
    }
  }
  
  // ==============================================
  // 配信通知関連関数
  // ==============================================
  async function sendStreamNotification({ platform, username, title, url, guildId, channelId, roleId, discordUsername = username, discordId, thumbnailUrl }) {
  const platformEmoji = {
    twitch: '🔴',
    youtube: '🎥',
    twitcasting: '📡'
  };

  const platformName = {
    twitch: 'Twitch',
    youtube: 'YouTube',
    twitcasting: 'ツイキャス'
  };

  const channel = client.channels.cache.get(channelId);
  if (!channel) {
    console.warn(`チャンネルが見つかりません: channelId=${channelId}`);
    return;
  }

  // 権限チェック
  if (!channel.permissionsFor(channel.guild.members.me).has([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles])) {
    console.error(`権限不足: channelId=${channelId}, 必要な権限: SEND_MESSAGES, ATTACH_FILES`);
    return;
  }

  // ディスコードの表示名を取得
  let displayName = discordUsername;
  try {
    if (discordId) {
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const member = await guild.members.fetch(discordId).catch(() => null);
        if (member) displayName = member.displayName || member.user.username;
      }
    }
  } catch (err) {
    console.error(`表示名取得エラー: discordId=${discordId}`, err.message);
  }

  // メッセージ部分
  const message = `${platformEmoji[platform]} **${displayName}** が${platformName[platform]}でライブ配信中！\n**タイトル:** ${title}\n**チャンネル:** ${username}\n${url}`;

  try {
    // デバッグ: 送信内容を確認
    console.log(`送信メッセージ: ${message}, 添付ファイル: ${thumbnailUrl ? 'あり' : 'なし'}`);

    // 自動Embedを無効化し、プレーンテキストと添付ファイルのみ送信
    if (thumbnailUrl) {
      const attachment = new AttachmentBuilder(thumbnailUrl.replace('{width}', '1280').replace('{height}', '720'), { name: 'thumbnail.jpg' });
      await channel.send({
        content: message,
        files: [attachment],
        allowedMentions: { parse: [] },
        disableMentions: 'everyone'
      });
    } else {
      await channel.send({
        content: message,
        allowedMentions: { parse: [] },
        disableMentions: 'everyone'
      });
    }
    console.log(`${platformName[platform]}通知送信成功: Twitchチャンネル=${username}, 表示名=${displayName}, guildId=${guildId}, channelId=${channelId}`);
  } catch (err) {
    console.error(`通知送信エラー: guildId=${guildId}, channelId=${channelId}`, {
      message: err.message,
      stack: err.stack
    });
  }
}

    /**
   * キーワードチェック
   * @param {string} title 配信タイトル
   * @param {string[]} keywords キーワード配列
   * @returns {boolean} キーワードに一致するか
   */
  function checkKeywords(title, keywords) {
    if (!keywords || keywords.length === 0) return true;
    return keywords.some(keyword => title.toLowerCase().includes(keyword.toLowerCase()));
  }
  // ==============================================
  // Webhookハンドラー
  // ==============================================
  app.post('/webhook/youtube', async (req, res) => {
    try {
      const clientIp = req.ip || req.connection.remoteAddress;
      console.log('YouTube Webhook受信 (POST):', { clientIp, body: req.body });
      
      if (clientIp !== '::1' && clientIp !== '127.0.0.1' && clientIp !== '10.138.0.4') {
        console.warn('不正な送信元IP:', clientIp);
        return res.status(403).send('不正な送信元IPです');
      }
  
      const { channelId, videoId, title } = req.body;
      if (!channelId || !videoId || !title) {
        console.warn('無効なWebhookデータ受信:', { channelId, videoId, title });
        return res.status(200).end();
      }
  
      console.log('YouTube Webhook受信:', { channelId, videoId, title });
  
      const youtubers = await loadYoutubers(true);
      const youtuber = youtubers.find(y => y.youtubeId === channelId);
      if (!youtuber) {
        console.log(`チャンネル未登録: ${channelId}`);
        return res.status(200).end();
      }
  
      console.log(`[webhook/youtube] 通知対象: username=${youtuber.youtubeUsername}, guildIds=${youtuber.guildIds.join(', ')}`);
  
      const video = await getYouTubeVideoInfo(videoId);
      if (!video) {
        console.warn(`動画データが見つかりません: ${videoId}`);
        return res.status(200).end();
      }
  
      const serverSettings = await loadServerSettings();
      const liveDetails = video.liveStreamingDetails;
  
      if (liveDetails?.actualStartTime && !liveDetails.actualEndTime) {
        const cachedStream = activeStreams.youtube.get(channelId);
        if (cachedStream && cachedStream.videoId === videoId) {
          console.log(`重複通知をスキップ: ${youtuber.youtubeUsername}, ${videoId}`);
          return res.status(200).end();
        }
        
  const notificationPromises = [];
  for (const guildId of youtuber.guildIds || []) {  // ユーザーが参加しているサーバーのみ処理
    const settings = serverSettings.servers?.[guildId];
    if (!settings) {
      console.warn(`[webhook/youtube] ギルド設定が見つかりません: guild=${guildId}`);
      continue;
    }
    if (!settings.channelId) {
      console.warn(`[webhook/youtube] 通知チャンネル未設定: guild=${guildId}`);
      continue;
    }
    if (!settings.notificationRoles?.youtube) {
      console.warn(`[webhook/youtube] YouTube通知ロール未設定: guild=${guildId}`);
      continue;
    }
    if (!checkKeywords(title, settings.keywords)) {
      console.log(`[webhook/youtube] キーワード不一致: guild=${guildId}, title=${title}, keywords=${settings.keywords?.join(', ') || 'なし'}`);
      continue;
    }
  
    console.log(`[webhook/youtube] 通知送信準備: guild=${guildId}, channel=${settings.channelId}`);
    notificationPromises.push(
      sendStreamNotification({
        platform: 'youtube',
        username: youtuber.youtubeUsername,
        title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        guildId,
        channelId: settings.channelId,
        roleId: settings.notificationRoles.youtube
      })
    );
  }
  
        await Promise.all(notificationPromises);
        activeStreams.youtube.set(channelId, { videoId, title, notifiedAt: Date.now() });
      } else if (liveDetails?.actualEndTime) {
        activeStreams.youtube.delete(channelId);
        console.log(`ライブ配信終了: ${youtuber.youtubeUsername}, ${videoId}`);
      }
  
      res.status(200).end();
    } catch (err) {
      console.error('Webhook処理エラー:', {
        message: err.message,
        stack: err.stack,
        body: req.body
      });
      res.status(500).send('サーバーエラーが発生しました');
    }
  });
  
  app.get('/webhook/youtube', (req, res) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    console.warn('無効なGETリクエスト受信:', { clientIp, query: req.query });
    res.status(405).send('GETメソッドはサポートされていません。POSTを使用してください。');
  });
  
  
  
  // 追加: TwitCasting Webhookハンドラー (開始)
// ==============================================
app.post('/webhook/twitcasting', async (req, res) => {
  try {
    const clientIp = req.ip || req.connection.remoteAddress;
    console.log('TwitCasting Webhook受信 (POST):', { clientIp, body: req.body });

    // イベントタイプチェック
    const { event, user_id: userId, user_name: userName, movie_id: liveId, title } = req.body;
    if (event !== 'live_start') {
      console.log(`イベント無視: ${event}`);
      return res.status(200).end();
    }

    // 必須パラメータチェック
    if (!userId || !userName || !liveId || !title) {
      console.warn('無効なWebhookデータ受信:', req.body);
      return res.status(200).end();
    }

    console.log('TwitCasting Webhook受信:', { userId, userName, liveId, title, event });

    const twitcasters = await loadTwitcasters(true);
    const twitcaster = twitcasters.find(t => t.twitcastingId === userId);
    if (!twitcaster) {
      console.log(`ユーザー未登録: ${userId}`);
      return res.status(200).end();
    }

    // 重複通知チェック（liveIdベース）
    if (activeStreams.twitcasting.has(liveId)) {
      console.log(`重複通知をスキップ: ${liveId}`);
      return res.status(200).end();
    }

    const serverSettings = await loadServerSettings();
    const notificationPromises = [];

    for (const guildId of twitcaster.guildIds || []) {
      const settings = serverSettings.servers?.[guildId];
      if (!settings?.channelId || !settings.notificationRoles?.twitcasting) {
        console.warn(`通知設定不備: guild=${guildId}`);
        continue;
      }

      // キーワードチェック
      if (!checkKeywords(title, settings.keywords)) {
        console.log(`キーワード不一致: guild=${guildId}, title=${title}`);
        continue;
      }

      // サムネイルURL取得
      const thumbnailUrl = `https://twitcasting.tv/${twitcaster.twitcastingId}/thumb`;

      // 表示名取得（フォールバック付き）
      let discordUsername = twitcaster.twitcastingUsername;
      if (twitcaster.discordId) {
        try {
          const guild = client.guilds.cache.get(guildId);
          if (guild) {
            const member = await guild.members.fetch(twitcaster.discordId).catch(() => null);
            if (member) discordUsername = member.displayName || member.user.username;
          }
        } catch (err) {
          console.error(`表示名取得エラー: ${twitcaster.discordId}`, err.message);
        }
      }

      notificationPromises.push(
        sendStreamNotification({
          platform: 'twitcasting',
          username: twitcaster.twitcastingUsername,
          discordUsername,
          title,
          url: `https://twitcasting.tv/${twitcaster.twitcastingId}`,
          guildId,
          channelId: settings.channelId,
          roleId: settings.notificationRoles.twitcasting,
          thumbnailUrl // サムネイル追加
        })
      );
    }

    await Promise.all(notificationPromises);
    activeStreams.twitcasting.set(liveId, { // liveIdでキャッシュ
      liveId,
      title,
      notifiedAt: Date.now()
    });

    res.status(200).end();
  } catch (err) {
    console.error('TwitCasting Webhook処理エラー:', err.message);
    res.status(500).send('サーバーエラー');
  }
});
// 追加: TwitCasting Webhookハンドラー (終了)
// ==============================================

  // ==============================================
  // 配信チェック関数
  // ==============================================
// 2重通知防止用ロック: 前回のチェックが完了する前に次のチェックが
// 走らないようにする（Twitch通知が2重に送られる主な原因だったため）
let isCheckingTwitchStreams = false;

async function checkTwitchStreams() {
  if (isCheckingTwitchStreams) {
    console.warn('[checkTwitchStreams] 前回のチェックがまだ実行中のためスキップします（2重通知防止）');
    return;
  }
  isCheckingTwitchStreams = true;

  try {
    await checkTwitchStreamsInternal();
  } finally {
    isCheckingTwitchStreams = false;
  }
}

async function checkTwitchStreamsInternal() {
  const streamers = await loadStreamers();
  const serverSettings = await loadServerSettings();

  let accessToken;
  try {
    accessToken = await getTwitchAccessToken();
  } catch (err) {
    console.error('Twitchアクセストークン取得失敗、チェックをスキップ:', err.message);
    return;
  }

  for (const streamer of streamers) {
    try {
      console.log(`Twitch配信チェック: ${streamer.twitchUsername}`);
      
      const response = await axios.get('https://api.twitch.tv/helix/streams', {
        params: { user_id: streamer.twitchId },
        headers: {
          'Client-ID': TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${accessToken}`
        }
      });

      console.log(`Twitch APIレスポンス (${streamer.twitchUsername}):`, JSON.stringify(response.data, null, 2));

      const currentStream = response.data.data[0] || null;
      const cachedStream = activeStreams.twitch.get(streamer.twitchId);

      if (currentStream) {
        const { id: streamId, title, thumbnail_url } = currentStream;
        
        if (!cachedStream || cachedStream.streamId !== streamId) {
          for (const guildId of streamer.guildIds || []) {
            const settings = serverSettings.servers?.[guildId];
            if (!settings || !settings.channelId || !settings.notificationRoles?.twitch) {
              console.warn(`通知設定が不完全: guild=${guildId}`);
              continue;
            }

            if (!checkKeywords(title, settings.keywords)) {
              console.log(`キーワード不一致: guild=${guildId}, title=${title}, keywords=${settings.keywords?.join(', ') || 'なし'}`);
              continue;
            }

            let discordUsername = streamer.twitchUsername;
            let discordId = streamer.discordId; // discordIdを別途取得
            try {
              const guild = client.guilds.cache.get(guildId);
              if (guild && discordId) {
                const member = await guild.members.fetch(discordId).catch(() => null);
                if (member) discordUsername = member.displayName || member.user.username;
                console.log(`表示名取得: discordId=${discordId} -> ${discordUsername}`);
              } else {
                console.log(`表示名未取得: discordId=${discordId}, guildId=${guildId}`);
              }
            } catch (err) {
              console.error(`Discordユーザー名取得エラー: discordId=${discordId}`, err.message);
            }

            let thumbnailUrl = thumbnail_url || null;
            if (!thumbnailUrl) {
              try {
                const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
                  params: { id: streamer.twitchId },
                  headers: {
                    'Client-ID': TWITCH_CLIENT_ID,
                    'Authorization': `Bearer ${accessToken}`
                  }
                });
                thumbnailUrl = userResponse.data.data?.[0]?.profile_image_url || null;
                console.log(`フォールバック: プロフィール画像を使用 (${streamer.twitchUsername}):`, thumbnailUrl);
              } catch (err) {
                console.error(`プロフィール画像取得エラー (${streamer.twitchUsername}):`, err.message);
              }
            }

            await sendStreamNotification({
              platform: 'twitch',
              username: streamer.twitchUsername,
              discordUsername,
              discordId, // discordIdを渡す
              title,
              url: `https://www.twitch.tv/${streamer.twitchUsername}`,
              guildId,
              channelId: settings.channelId,
              roleId: settings.notificationRoles.twitch,
              thumbnailUrl
            });
          }

          activeStreams.twitch.set(streamer.twitchId, { streamId, title, thumbnail_url, notifiedAt: Date.now() });
        }
      } else if (cachedStream) {
        activeStreams.twitch.delete(streamer.twitchId);
        console.log(`ライブ配信終了: ${streamer.twitchUsername}`);
      }
    } catch (err) {
      console.error(`Twitch APIエラー (${streamer.twitchUsername}):`, {
        message: err.message,
        stack: err.stack,
        response: err.response?.data
      });
    }
  }
}
  // ==============================================
  // 退出メンバー クリーンアップ関数
  // ==============================================

  /**
   * 配信通知BOTが導入されているサーバーに、登録済みのDiscordユーザーが
   * もういない（サーバーを抜けた等）場合、その登録を削除する。
   * - 該当ユーザーがそのサーバーにいなければ、そのサーバーへのリンク(guildIds)を削除
   * - 全てのサーバーから抜けていたら、アカウント登録自体を削除
   *
   * @param {string} triggeredBy ログ用: 実行元（'scheduled' や '手動実行(ユーザー名)' など）
   * @returns {Promise<Object>} プラットフォームごとの削除件数サマリー
   */
  async function cleanupLeftMembers(triggeredBy = 'scheduled') {
    console.log(`[cleanup] 退出メンバーのクリーンアップを開始 (トリガー: ${triggeredBy})`);

    // ギルドごとのメンバーID一覧をキャッシュし、APIコール数を抑える
    // （アカウント1件ずつ member.fetch() すると件数が多い場合にレート制限にかかりやすいため）
    const guildMemberCache = new Map();

    async function isStillGuildMember(guildId, discordId) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        // ボットがそのサーバーから既にいない（Kick/退出済み）
        return false;
      }

      if (!guildMemberCache.has(guildId)) {
        try {
          const members = await guild.members.fetch();
          guildMemberCache.set(guildId, new Set(members.keys()));
        } catch (err) {
          console.error(`[cleanup] メンバー一覧取得エラー: guild=${guildId}`, err.message);
          // 取得に失敗した場合は誤って削除しないよう「在籍している」扱いにする
          guildMemberCache.set(guildId, null);
        }
      }

      const memberIdSet = guildMemberCache.get(guildId);
      if (memberIdSet === null) return true;
      return memberIdSet.has(discordId);
    }

    const platforms = [
      { file: STREAMERS_FILE, loader: loadStreamers, label: 'Twitch' },
      { file: YOUTUBERS_FILE, loader: loadYoutubers, label: 'YouTube' },
      { file: TWITCASTERS_FILE, loader: loadTwitcasters, label: 'TwitCasting' }
    ];

    const summary = {};

    for (const { file, loader, label } of platforms) {
      const accounts = await loader(true);
      let removedGuildLinks = 0;
      let removedAccounts = 0;
      const updatedAccounts = [];

      for (const account of accounts) {
        const guildIds = account.guildIds || [];
        const remainingGuildIds = [];

        for (const guildId of guildIds) {
          const stillMember = await isStillGuildMember(guildId, account.discordId);
          if (stillMember) {
            remainingGuildIds.push(guildId);
          } else {
            removedGuildLinks++;
            console.log(`[cleanup] サーバーリンク削除: platform=${label}, discordId=${account.discordId}, guild=${guildId}`);
          }
        }

        if (remainingGuildIds.length > 0) {
          updatedAccounts.push(
            remainingGuildIds.length === guildIds.length ? account : { ...account, guildIds: remainingGuildIds }
          );
        } else {
          removedAccounts++;
          console.log(`[cleanup] アカウント削除: platform=${label}, discordId=${account.discordId} (在籍サーバーなし)`);
        }
      }

      if (removedGuildLinks > 0 || removedAccounts > 0) {
        await saveConfigFile(file, updatedAccounts);
      }

      summary[label] = {
        元の件数: accounts.length,
        削除アカウント数: removedAccounts,
        削除リンク数: removedGuildLinks,
        残存件数: updatedAccounts.length
      };
    }

    console.log('[cleanup] クリーンアップ完了:', summary);
    return summary;
  }

  /**
   * 次回のJST 0時までのミリ秒数を計算する（サーバーのタイムゾーン設定に依存しない）
   * @returns {number} 次回JST 0時までのミリ秒
   */
  function msUntilNextJstMidnight() {
    const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const now = new Date();
    const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
    const jstNextMidnightUtc = Date.UTC(
      jstNow.getUTCFullYear(),
      jstNow.getUTCMonth(),
      jstNow.getUTCDate() + 1,
      0, 0, 0, 0
    );
    const nextMidnightRealUtcMs = jstNextMidnightUtc - JST_OFFSET_MS;
    return nextMidnightRealUtcMs - now.getTime();
  }

  /**
   * 退出メンバーのクリーンアップを毎日日本時間0時に自動実行するようスケジュールする
   */
  function scheduleDailyMemberCleanup() {
    function run() {
      cleanupLeftMembers('毎日0時の自動実行').catch(err =>
        console.error('[cleanup] 定期クリーンアップエラー:', err.message)
      );
      setTimeout(run, 24 * 60 * 60 * 1000);
    }

    const delay = msUntilNextJstMidnight();
    console.log(`[cleanup] 次回自動クリーンアップまで約${Math.round(delay / 60000)}分 (毎日 日本時間0時に実行)`);
    setTimeout(run, delay);
  }

  // ==============================================
  // その他の関数
  // ==============================================

  /**
   * WebSubサブスクリプションの更新
   */
  async function renewSubscriptions() {
    const youtubers = await loadYoutubers();
    
    for (const youtuber of youtubers) {
      try {
        const requestBody = new URLSearchParams({
          'hub.mode': 'subscribe',
          'hub.topic': `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${youtuber.youtubeId}`,
          'hub.callback': 'https://zaronyanbot.com/webhook/youtube',
          'hub.verify': 'async',
          'hub.secret': YOUTUBE_WEBHOOK_SECRET
        });
  
        console.log(`YouTubeサブスクリプション更新: ${youtuber.youtubeUsername}`);
        
        await axios.post('https://pubsubhubbub.appspot.com/subscribe', requestBody, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        console.log(`サブスクリプション更新成功: ${youtuber.youtubeUsername}`);
      } catch (err) {
        console.error(`サブスクリプション更新エラー (${youtuber.youtubeUsername}):`, {
          message: err.message,
          status: err.response?.status,
          data: err.response?.data
        });
      }
    }
  }
  
  // ==============================================
  // Expressルート
  // ==============================================
  app.get('/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;
    
    if (error) {
      console.error('OAuthエラー:', { error, error_description });
      return res.status(400).send(`認証エラー: ${error_description || error}`);
    }
  
    if (!code || !state) {
      console.error('コードまたは状態が無効:', { code, state });
      return res.status(400).send('無効なリクエストパラメータです');
    }
  
    try {
      const [type, guildId] = state.split('_');
      if (!['twitch', 'youtube', 'twitcasting'].includes(type)) {
        console.error(`無効な状態タイプ: ${type}`);
        return res.status(400).send('無効な状態パラメータです');
      }
  
      if (!client.guilds.cache.has(guildId)) {
        console.error(`無効なサーバーID: ${guildId}`);
        return res.status(400).send('指定されたサーバーが見つかりません');
      }
  
      const tokenResponse = await axios.post(
        'https://discord.com/api/oauth2/token',
        new URLSearchParams({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
  
      const accessToken = tokenResponse.data.access_token;
      const userResponse = await axios.get('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const authUserId = userResponse.data.id;
  
      const connectionsResponse = await axios.get('https://discord.com/api/users/@me/connections', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
  
      const platformConnection = connectionsResponse.data.find(conn => conn.type === type);
      if (!platformConnection) {
        console.error(`${type}アカウント未接続: ${authUserId}`);
        return res.status(400).send(`${type}アカウントが接続されていません`);
      }
  
      const { id: platformId, name: platformUsername } = platformConnection;
  
      const config = await loadConfig();
      const platformConfig = {
        twitch: {
          file: STREAMERS_FILE,
          loader: loadStreamers,
          limit: 0
        },
        youtube: {
          file: YOUTUBERS_FILE,
          loader: loadYoutubers,
          limit: config.youtubeAccountLimit || 0
        },
        twitcasting: {
          file: TWITCASTERS_FILE,
          loader: loadTwitcasters,
          limit: config.twitcastingAccountLimit || 25
        }
      };
  
      const { file, loader, limit } = platformConfig[type];
      const accounts = await loader();
  
      if (limit > 0 && accounts.length >= limit) {
        console.error(`${type}アカウント上限超過: limit=${limit}`);
        return res.status(400).send(`${type}アカウント登録数が上限に達しています`);
      }
  
      if (accounts.some(acc => acc.discordId === authUserId)) {
        const account = accounts.find(acc => acc.discordId === authUserId);
        if (!account.guildIds) account.guildIds = [];
        if (!account.guildIds.includes(guildId)) {
          account.guildIds.push(guildId);
          await saveConfigFile(file, accounts);
        }
      } else if (accounts.some(acc => acc[`${type}Id`] === platformId)) {
        console.error(`${type}アカウント重複: ${platformId}`);
        return res.status(400).send('このアカウントは別のユーザーで登録済みです');
      } else {
        accounts.push({
          discordId: authUserId,
          [`${type}Id`]: platformId,
          [`${type}Username`]: platformUsername,
          guildIds: [guildId]
        });
        await saveConfigFile(file, accounts);
      }
  
      console.log(`${type}アカウントをリンク: ${platformUsername} (${platformId})`);
  
      const guild = client.guilds.cache.get(guildId);
      const settings = await loadServerSettings();
      const guildSettings = settings.servers[guildId];
      const roleId = guildSettings?.notificationRoles?.[type];
  
      if (!roleId) {
        console.warn(`通知ロール未設定: サーバー=${guildId}, タイプ=${type}`);
        return res.send(`${type}アカウントはリンクされましたが、通知ロールが設定されていません。サーバー管理者に連絡してください。`);
      }
  
      const member = await guild.members.fetch(authUserId).catch(() => null);
      if (!member) {
        console.error(`メンバー取得失敗: ユーザー=${authUserId}, サーバー=${guildId}`);
        return res.send(`${type}アカウントはリンクしましたが、メンバー情報が取得できませんでした。サーバー管理者に連絡してください。`);
      }
  
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (!role) {
        console.error(`ロール取得失敗: ロール=${roleId}, サーバー=${guildId}`);
        return res.send(`${type}アカウントはリンクしましたが、ロールが見つかりませんでした。サーバー管理者に連絡してください。`);
      }
  
      const botMember = guild.members.me;
      const botRole = guild.roles.cache.find(r => r.name === '配信通知BOT' && botMember.roles.cache.has(r.id));
      if (!botRole) {
        console.error(`ボットロールが見つかりません: guild=${guildId}, bot=${botMember.id}`);
        return res.send(`${type}アカウントはリンクしましたが、ボットのロール（配信通知BOT）が見つかりませんでした。サーバー管理者に連絡してください。`);
      }
  
      if (botRole.position <= role.position) {
        if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
          console.warn(`[callback] ロール位置調整権限なし: guild=${guildId}, bot=${botMember.id}`);
          return res.send(`${type}アカウントはリンクされましたが、ボットのロール位置を調整できませんでした。サーバー管理者に「ロールの管理」権限を付与してください。`);
        }
  
        try {
          await guild.roles.setPositions([
            { role: botRole.id, position: role.position + 1 }
          ]);
          console.log(`[callback] ロール位置調整成功: guild=${guildId}, botRole=${botRole.id}, newPosition=${role.position + 1}`);
        } catch (adjustErr) {
          console.error(`[callback] ロール位置調整エラー: guild=${guildId}, botRole=${botRole.id}`, adjustErr.message);
          return res.send(`${type}アカウントはリンクしましたが、ボットのロール位置を調整できませんでした。エラー: ${adjustErr.message}。サーバー管理者に連絡してください。`);
        }
      }
  
      await member.roles.add(roleId);
      console.log(`[callback] ロール付与成功: user=${member.id}, role=${roleId}`);
  
      const channelId = welcomeChannels.get(authUserId); 
      if (channelId) { 
        try { 
          const botMember = guild.members.me; 
          if (guild.channels.cache.some(channel => 
            channel.permissionsFor(botMember)?.has(PermissionsBitField.Flags.ManageChannels))) {
            const channel = guild.channels.cache.get(channelId); 
            if (channel && channel.name.startsWith('welcome-')) { 
              await channel.delete(); 
              welcomeChannels.delete(authUserId); 
              console.log(`[callback] /mazakari由来チャンネル削除成功: user=${authUserId}, channel=${channelId}`); 
            } else { 
              console.warn(`[callback] チャンネルが見つからないか無効: channel=${channelId}`); 
              welcomeChannels.delete(authUserId); 
            } 
          } else { 
            console.warn(`[callback] チャンネル削除権限なし: guild=${guildId}`);
          }
        } catch (deleteErr) { 
          console.error(`[callback] チャンネル削除エラー: user=${authUserId}, channel=${channelId}`, deleteErr.message);
        } 
      } 
  
      res.send(`${type}アカウントが正常にリンクされ、ロール「${role.name}」が付与されました！`);
    } catch (err) {
      console.error('[callback] OAuthコールバックエラー:', err.message);
      res.status(500).send('認証中にエラーが発生しました');
    }
  });
  
  // ==============================================
  // HTTPSサーバー起動
  // ==============================================
  
  try {
    const options = {
      key: fs.readFileSync('/etc/letsencrypt/live/zaronyanbot.com/privkey.pem'),
      cert: fs.readFileSync('/etc/letsencrypt/live/zaronyanbot.com/fullchain.pem')
    };
  
    https.createServer(options, app).listen(3001, '0.0.0.0', () => {
      console.log('✅ HTTPSサーバーがポート3001で起動しました');
    });
  } catch (err) {
    console.error('HTTPSサーバー起動エラー:', {
      message: err.message,
      stack: err.stack
    });
    process.exit(1);
  }
  
  // ==============================================
  // Discordイベントハンドラー
  // ==============================================
  
  client.once('ready', async () => {
    console.log('✅ ボットがオンラインになりました！');
  
    try {
      console.log('既存のスラッシュコマンドをクリア中...');
      await clearAllCommands();
      const allGuildIds = client.guilds.cache.map(guild => guild.id);
      for (const guildId of allGuildIds) {
        await clearAllCommands(guildId);
      }
  
      const commands = [
        new SlashCommandBuilder()
          .setName('setup_s')
          .setDescription('配信通知の設定を行います')
          .addChannelOption(option =>
            option.setName('channel')
              .setDescription('配信通知を送信するチャンネル')
              .setRequired(true)
          ),
        new SlashCommandBuilder()
          .setName('admin_message')
          .setDescription('全サーバーの管理者にメッセージを送信（管理者専用）'),
        new SlashCommandBuilder()
          .setName('reload_config')
          .setDescription('設定ファイルを再読み込み（管理者専用）'),
        new SlashCommandBuilder()
          .setName('admin')
          .setDescription('ユーザーにボット製作者権限を付与（製作者専用）')
          .addUserOption(option =>
            option.setName('user')
              .setDescription('管理者権限を付与するユーザー')
              .setRequired(true)
          ),
        new SlashCommandBuilder()
          .setName('mazakari')
          .setDescription('全メンバーに配信通知設定のDMを送信（管理者専用）'),
        new SlashCommandBuilder()
          .setName('stop_mazakari')
          .setDescription('Mazakari機能を停止（管理者専用）'),
        new SlashCommandBuilder()
          .setName('clear_streams')
          .setDescription('すべての配信設定を削除（管理者専用）')
          .addStringOption(option =>
            option.setName('exclude')
              .setDescription('除外するユーザーID（カンマ区切り）')
              .setRequired(false)
          ),
        new SlashCommandBuilder()
          .setName('set_keywords')
          .setDescription('配信通知のキーワードを設定')
          .addStringOption(option =>
            option.setName('keywords')
              .setDescription('通知する配信タイトルのキーワード（カンマ区切り）')
              .setRequired(true)
          ),
        new SlashCommandBuilder()
          .setName('test_message')
          .setDescription('テストメッセージを送信'),
        new SlashCommandBuilder()
          .setName('clear_keywords')
          .setDescription('すべての通知キーワードを削除'),
        new SlashCommandBuilder()
          .setName('remember_twitch')
          .setDescription('このサーバーに対してTwitch通知を有効化'),
        new SlashCommandBuilder()
          .setName('remember_youtube')
          .setDescription('このサーバーに対してYouTube通知を有効化'),
        new SlashCommandBuilder()
          .setName('remember_twitcasting')
          .setDescription('このサーバーに対してツイキャス通知を有効化'),
        new SlashCommandBuilder()
          .setName('link')
          .setDescription('Twitch, YouTube, ツイキャスのアカウントをリンク'),
        new SlashCommandBuilder()
          .setName('cleanup_members')
          .setDescription('サーバーを抜けたメンバーの配信通知登録を削除します（管理者専用）')
      ].map(command => command.toJSON());
      
      console.log('[ready] ギルドコマンドをクリア中...');
      const guildIds = client.guilds.cache.map(guild => guild.id);
      for (const guildId of guildIds) {
        await clearAllCommands(guildId);
      }
      
      async function registerCommands(guildId = null) {
        const target = guildId ? client.guilds.cache.get(guildId) : client.application;
        if (!target) {
          console.error('コマンド登録先が見つかりません:', guildId);
          return false;
        }
  
        try {
          await target.commands.set(commands);
          console.log(`スラッシュコマンドを登録しました (対象: ${guildId || 'グローバル'})`);
          return true;
        } catch (err) {
          console.error(`スラッシュコマンド登録失敗 (対象: ${guildId || 'グローバル'}):`, err.message);
          return false;
        }
      }
  
      for (const guildId of guildIds) {
        await registerCommands(guildId);
      }
  
      await loadServerSettings(true);
      await loadCreators(true);
  
      console.log('ライブ配信監視を開始します');
      // setIntervalではなく「前回の処理が完了してから次を予約する」方式にする。
      // setIntervalだと配信者数が多い等の理由でチェックが60秒を超えた場合に
      // 次のチェックと重複実行されてしまい、Twitch通知が2重に送られる原因になっていた。
      function scheduleNextTwitchCheck() {
        setTimeout(async () => {
          await checkTwitchStreams().catch(err => console.error('Twitchチェックエラー:', err));
          scheduleNextTwitchCheck();
        }, 60 * 1000);
      }

      await checkTwitchStreams().catch(err => console.error('初回Twitchチェックエラー:', err));
      scheduleNextTwitchCheck();

      await renewSubscriptions();
      setInterval(renewSubscriptions, 24 * 60 * 60 * 1000);

      // 退出メンバーのクリーンアップを開始（毎日0時 + /cleanup_members コマンドで実行可能）
      scheduleDailyMemberCleanup();
    } catch (err) {
      console.error('初期化エラー:', {
        message: err.message,
        stack: err.stack
      });
    }
  });
  
  client.on('guildCreate', async guild => {
    console.log(`[guildCreate] 新しいギルドに招待されました: guild=${guild.id}, name=${guild.name}, memberCount=${guild.memberCount}`);
    try {
      const slashCommands = [
        new SlashCommandBuilder()
          .setName('setup_s')
          .setDescription('配信通知の設定を行います')
          .addChannelOption(option =>
            option.setName('channel')
              .setDescription('配信通知を送信するチャンネル')
              .setRequired(true)
          ),
        new SlashCommandBuilder()
          .setName('admin_message')
          .setDescription('全サーバーの管理者にメッセージを送信（管理者専用）'),
        new SlashCommandBuilder()
          .setName('reload_config')
          .setDescription('設定ファイルを再読み込み（管理者専用）'),
        new SlashCommandBuilder()
          .setName('admin')
          .setDescription('ユーザーにボット製作者権限を付与（製作者専用）')
          .addUserOption(option =>
            option.setName('user')
              .setDescription('管理者権限を付与するユーザー')
              .setRequired(true)
          ),
        new SlashCommandBuilder()
          .setName('mazakari')
          .setDescription('全メンバーに配信通知設定のDMを送信（管理者専用）'),
        new SlashCommandBuilder()
          .setName('stop_mazakari')
          .setDescription('Mazakari機能を停止（管理者専用）'),
        new SlashCommandBuilder()
          .setName('clear_streams')
          .setDescription('すべての配信設定を削除（管理者専用）')
          .addStringOption(option =>
            option.setName('exclude')
              .setDescription('除外するユーザーID（カンマ区切り）')
              .setRequired(false)
          ),
        new SlashCommandBuilder()
          .setName('set_keywords')
          .setDescription('配信通知のキーワードを設定')
          .addStringOption(option =>
            option.setName('keywords')
              .setDescription('通知する配信タイトルのキーワード（カンマ区切り）')
              .setRequired(true)
          ),
        new SlashCommandBuilder()
          .setName('test_message')
          .setDescription('テストメッセージを送信'),
        new SlashCommandBuilder()
          .setName('clear_keywords')
          .setDescription('すべての通知キーワードを削除'),
        new SlashCommandBuilder()
          .setName('remember_twitch')
          .setDescription('このサーバーに対してTwitch通知を有効化'),
        new SlashCommandBuilder()
          .setName('remember_youtube')
          .setDescription('このサーバーに対してYouTube通知を有効化'),
        new SlashCommandBuilder()
          .setName('remember_twitcasting')
          .setDescription('このサーバーに対してツイキャス通知を有効化'),
        new SlashCommandBuilder()
          .setName('link')
          .setDescription('Twitch, YouTube, ツイキャスのアカウントをリンク'),
        new SlashCommandBuilder()
          .setName('cleanup_members')
          .setDescription('サーバーを抜けたメンバーの配信通知登録を削除します（管理者専用）')
      ].map(command => command.toJSON());
      
      await guild.commands.set(slashCommands);
      console.log(`[guildCreate] スラッシュコマンドを登録しました: guild=${guild.id}`);
  
      const serverSettings = await loadServerSettings();
      if (!serverSettings.servers[guild.id]) {
        serverSettings.servers[guild.id] = {};
        await saveConfigFile(SERVER_SETTINGS_FILE, serverSettings);
        console.log(`[guildCreate] ギルド設定を初期化: guild=${guild.id}`);
      }
    } catch (err) {
      console.error(`[guildCreate] エラー: guild=${guild.id}`, {
        message: err.message,
        stack: err.stack
      });
    }
  });
  
  client.on('messageCreate', async message => {
    if (message.author.bot || message.channel.type === ChannelType.DM) {
      console.log(`[messageCreate] 無効なメッセージ: bot=${message.author.bot}, channelType=${message.channel.type}`);
      return;
    }
    const pending = pendingMazakari.get(message.author.id);
    if (!pending || pending.channelId !== message.channel.id) {
      console.log(`[messageCreate] Mazakari未リクエスト: user=${message.author.id}, channel=${message.channel.id}`);
      return;
    }
    if (!message.attachments.size) {
      console.log(`[messageCreate] 添付ファイルなし: user=${message.author.id}`);
      await message.reply({
        content: '添付ファイルがありません。`.txt`ファイルを添付してください。',
        flags: [4096]
      });
      return;
    }
  
    const attachment = message.attachments.first();
    if (!attachment.name.endsWith('.txt')) {
      console.log(`[messageCreate] 無効なファイル形式: name=${attachment.name}`);
      await message.reply({
        content: '添付ファイルは`.txt`形式である必要があります。',
        flags: [4096]
      });
      return;
    }
    console.log(`[messageCreate] 添付ファイル処理開始: url=${attachment.url}, name=${attachment.name}`);
  
    try {
      const response = await axios.get(attachment.url, {
        responseType: 'arraybuffer',
        timeout: 15000
      });
      
      console.log(`[messageCreate] axios応答: status=${response.status}, dataLength=${response.data?.byteLength || 0}`);
  
      if (!response.data || response.data.byteLength === 0) {
        throw new Error('ファイルが空またはデータが取得できませんでした');
      }
  
      const content = iconv.decode(Buffer.from(response.data), 'utf-8').trim();
      console.log(`[messageCreate] デコード済みコンテンツ長: ${content.length}`);
      if (content.length === 0) {
        throw new Error('ファイル内容が空です');
      }
  
      if (content.length > 2000) {
        await message.reply({
          content: 'ファイルの内容が2000文字を超えています。短くしてください。',
          flags: [4096]
        });
        pendingMazakari.delete(message.author.id);
        return;
      }
  
      pendingMazakari.delete(message.author.id);
  
      const guild = client.guilds.cache.get(pending.guildId);
      if (!guild) {
        await message.reply({
          content: 'サーバーが見つかりません。管理者に連絡してください。',
          flags: [4096]
        });
        return;
      }
  
      const config = await loadConfig();
      const buttons = [
        new ButtonBuilder()
          .setCustomId(`link_youtube_${pending.guildId}_${message.author.id}`)
          .setLabel('YouTube通知')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('▶️'),
        new ButtonBuilder()
          .setCustomId(`link_twitch_${pending.guildId}_${message.author.id}`)
          .setLabel('Twitch通知')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🔴'),
        new ButtonBuilder()
          .setCustomId(`link_stream_${pending.guildId}_${message.author.id}`)
          .setLabel('連携してないorツイキャス')
          .setStyle(ButtonStyle.Success)
          .setEmoji('📡')
      ];
  
      const chunkContent = (content, maxLength = 2000) => {
        const chunks = [];
        for (let i = 0; i < content.length; i += maxLength) {
          chunks.push(content.slice(i, i + maxLength));
        }
        return chunks;
      };
  
      const members = await guild.members.fetch();
      let successCount = 0;
      let failCount = 0;
  
      for (const member of members.values()) {
        if (member.user.bot) continue;
  
        const memberRow = new ActionRowBuilder().addComponents(
          buttons.map(button =>
            ButtonBuilder.from(button).setCustomId(button.data.custom_id.replace(message.author.id, member.id))
          )
        );
  
        try {
          const chunks = chunkContent(content);
          for (let i = 0; i < chunks.length; i++) {
            await member.send({
              content: chunks[i],
              components: i === chunks.length - 1 ? [memberRow] : []
            });
          }
          successCount++;
        } catch (err) {
          console.error(`メンバー ${member.id} へのDM失敗:`, err.message);
          try {
            const botMember = message.guild.members.me;
            if (!message.guild.channels.cache.some(channel =>
              channel.permissionsFor(botMember)?.has(PermissionsBitField.Flags.ManageChannels))) {
              failCount++;
              continue;
            }
  
            const channel = await message.guild.channels.create({
              name: `welcome-${member.user.username}`,
              type: ChannelType.GuildText,
              permissionOverwrites: [
                {
                  id: message.guild.id,
                  deny: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory
                  ]
                },
                {
                  id: member.id,
                  allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory
                  ]
                },
                {
                  id: client.user.id,
                  allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory,
                    PermissionsBitField.Flags.ManageChannels
                  ]
                }
              ],
              parent: null
            });
  
            const channelChunks = chunkContent(content);
            for (let i = 0; i < channelChunks.length; i++) {
              await channel.send({
                content: i === 0 ? `${member} ${channelChunks[i]}` : channelChunks[i],
                components: i === channelChunks.length - 1 ? [memberRow] : []
              });
            }
            welcomeChannels.set(member.id, channel.id);
            console.log(`[messageCreate] チャンネル作成成功: user=${member.id}, channel=${channel.id}`);
            successCount++;
          } catch (createErr) {
            console.error(`チャンネル作成エラー (ユーザー: ${member.id}):`, createErr.message);
            failCount++;
          }
        }
      }
  
      const mazakari = await loadMazakari();
      mazakari.enabled[pending.guildId] = true;
      mazakari.guilds[pending.guildId] = { message: content };
      await saveConfigFile(MAZAKARI_FILE, mazakari);
  
      await message.reply({
        content: `メッセージ送信を試みました。\n成功: ${successCount} メンバー\n失敗: ${failCount} メンバー`,
        flags: [4096]
      });
    } catch (err) {
  console.error('ファイル処理エラー:', {
      message: err.message,
      status: err.response ? err.response.status : undefined,
      data: err.response && err.response.data 
        ? JSON.stringify(err.response.data, null, 2) 
        : null,
      stack: err.stack,
      url: attachment.url
  });
      await message.reply({
        content: `ファイル処理中にエラーが発生しました: ${err.message}\nもう一度試してください。`,
        flags: [4096]
      });
      pendingMazakari.delete(message.author.id);
    }
  });
  
  client.on('guildMemberAdd', async member => {
    if (member.user.bot) return;
  
    try {
      const mazakari = await loadMazakari();
      const guildId = member.guild.id;
  
      if (!mazakari.enabled[guildId] || !mazakari.guilds[guildId]?.message) {
        console.log(`Mazakari無効またはメッセージ未設定: サーバー=${guildId}`);
        return;
      }
  
      const messageContent = mazakari.guilds[guildId].message;
      const config = await loadConfig();
      const buttons = [
        new ButtonBuilder()
          .setCustomId(`link_twitch_${guildId}_${member.id}`)
          .setLabel('Twitch通知')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🔴')
      ];
  
      const youtubers = await loadYoutubers();
      const twitcasters = await loadTwitcasters();
  
      if (config.youtubeAccountLimit === 0 || youtubers.length < config.youtubeAccountLimit) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`link_youtube_${guildId}_${member.id}`)
            .setLabel('YouTube通知')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('▶️')
        );
      }
  
      if (config.twitcastingAccountLimit === 0 || twitcasters.length < config.twitcastingAccountLimit) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`link_stream_${guildId}_${member.id}`)
            .setLabel('連携してないorツイキャス')
            .setStyle(ButtonStyle.Success)
            .setEmoji('📡')
        );
      }
  
      const row = new ActionRowBuilder().addComponents(buttons);
      try {
        await member.send({ content: messageContent, components: [row] });
        console.log(`新規メンバー ${member.id} にDM送信成功`);
      } catch (err) {
        console.error(`[${member.id}] へのDM失敗:`, err.message);
        try {
          const botMember = member.guild.members.me;
          if (!member.guild.channels.cache.some(channel =>
            channel.permissionsFor(botMember)?.has(PermissionsBitField.Flags.ManageChannels))) {
            return;
          }
  
          const channel = await member.guild.channels.create({
            name: `welcome-${member.user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
              { id: member.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
              { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
              { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
          });
  
          await channel.send({ content: `${member} ${messageContent}`, components: [row] });
          welcomeChannels.set(member.id, channel.id);
          console.log(`[guildMemberAdd] チャンネル作成成功: user=${member.id}, channel=${channel.id}`);
        } catch (createErr) {
          console.error(`チャンネル作成エラー (ユーザー: ${member.id}):`, createErr.message);
        }
      }
    } catch (err) {
      console.error(`新規メンバーDM処理エラー (ユーザー: ${member.id}):`, err.message);
    }
  });
  
  client.on('interactionCreate', async interaction => {
    if (!interaction) {
      console.error('インタラクションが未定義');
      return;
    }
  
    console.log(`インタラクション受信: ${interaction.commandName || interaction.customId}, ユーザー: ${interaction.user.id}, ギルド: ${interaction.guild?.id || 'DM'}`);
  
    try {
      if (interaction.isCommand()) {
        await handleSlashCommand(interaction);
      } else if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction);
      } else if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
      }
    } catch (err) {
      console.error('インタラクション処理エラー:', {
        message: err.message,
        stack: err.stack,
        interaction: interaction.commandName || interaction.customId,
        userId: interaction.user.id,
        guildId: interaction.guild?.id
      });
  
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'エラーが発生しました。管理者にご連絡ください。',
          ephemeral: true
        }).catch(replyErr => console.error('エラーメッセージ送信失敗:', replyErr.message));
      }
    }
  });
  
  async function handleSlashCommand(interaction) {
    const { commandName, user, guild, options } = interaction;
    const admins = await loadAdmins();
    const isAdmin = admins?.admins?.includes(user.id) || false;
    const creators = await loadCreators();
    const isCreator = creators.creators.includes(user.id);
  
    switch (commandName) {
      case 'setup_s': {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({
            content: 'このコマンドを使用するには管理者権限が必要です。',
            ephemeral: true
          });
        }
  
        const channel = options.getChannel('channel');
        const guildId = guild.id;
  
        try {
          const serverSettings = await loadServerSettings();
          if (!serverSettings.servers[guildId]) {
            serverSettings.servers[guildId] = {};
          }
  
          const botMember = guild.members.me;
          const botRole = guild.roles.botRoleFor(client.user.id);
          if (!botRole) {
            console.error(`ボットロールが見つかりません: guild=${guildId}, bot=${botMember.id}`);
            return interaction.reply({
              content: 'ボットのロール（配信通知BOT）が見つかりませんでした。サーバー管理者に連絡してください。',
              ephemeral: true
            });
          }
  
          if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
            console.warn(`[setup_s] ロール作成権限なし: guild=${guildId}, bot=${botMember.id}`);
            return interaction.reply({
              content: 'ボットに「ロールの管理」権限がありません。サーバー管理者に権限を付与してください。',
              ephemeral: true
            });
          }
  
          const roles = {};
          const roleTypes = [
            { name: 'Twitch通知', color: '#6441A4', key: 'twitch' },
            { name: 'YouTube通知', color: '#FF0000', key: 'youtube' },
            { name: 'ツイキャス通知', color: '#1DA1F2', key: 'twitcasting' },
            { name: 'Live Streaming', color: '#00FF00', key: 'live' }
          ];
  
          for (const { name, color, key } of roleTypes) {
            let role = guild.roles.cache.find(r => r.name === name);
            if (!role) {
              try {
                role = await guild.roles.create({
                  name,
                  color,
                  mentionable: true,
                  position: botRole.position - 1
                });
                console.log(`[setup_s] ${name}ロール作成: id=${role.id}, position=${role.position}`);
              } catch (createErr) {
                console.error(`[setup_s] ${name}ロール作成エラー: guild=${guildId}`, createErr.message);
                return interaction.reply({
                  content: `${name}ロールの作成に失敗しました: ${createErr.message}。サーバー管理者に連絡してください。`,
                  ephemeral: true
                });
              }
            }
            roles[key] = role;
          }
  
          serverSettings.servers[guildId] = {
            channelId: channel.id,
            liveRoleId: roles.live.id,
            keywords: serverSettings.servers[guildId]?.keywords || [],
            notificationRoles: {
              twitch: roles.twitch.id,
              youtube: roles.youtube.id,
              twitcasting: roles.twitcasting.id
            }
          };
  
          await saveConfigFile(SERVER_SETTINGS_FILE, serverSettings);
  
          await interaction.reply({
            content: `配信通知設定を保存しました:\n` +
                    `- 通知チャンネル: ${channel}\n` +
                    `- ライブロール: ${roles.live}\n` +
                    `- Twitch通知ロール: ${roles.twitch}\n` +
                    `- YouTube通知ロール: ${roles.youtube}\n` +
                    `- ツイキャス通知ロール: ${roles.twitcasting}\n` +
                    `※ 通知ロールはボットロール（配信通知BOT）の直下に設定されました。`,
            ephemeral: false
          });
        } catch (err) {
          console.error('[setup_s] サーバー設定エラー:', err.message);
          await interaction.reply({
            content: `サーバー設定の保存中にエラーが発生しました: ${err.message}`,
            ephemeral: true
          });
        }
        break;
      }
  
      case 'admin_message': {
        if (!isAdmin) {
          return interaction.reply({
            content: 'このコマンドは管理者にしか使用できません。',
            ephemeral: true
          });
        }
  
        const modal = new ModalBuilder()
          .setCustomId('admin_message_modal')
          .setTitle('管理者メッセージ送信');
  
        const passwordInput = new TextInputBuilder()
          .setCustomId('password')
          .setLabel('パスワード')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('管理者パスワードを入力') 
          .setRequired(true);
  
        const messageInput = new TextInputBuilder()
          .setCustomId('message')
          .setLabel('送信するメッセージ')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('サーバー管理者に送信するメッセージを入力')
          .setRequired(true);
  
        modal.addComponents(
          new ActionRowBuilder().addComponents(passwordInput),
          new ActionRowBuilder().addComponents(messageInput)
        );
  
        await interaction.showModal(modal);
        break;
      }
  
      case 'reload_config': {
        if (!isAdmin) {
          return interaction.reply({
            content: 'このコマンドは管理者のみ使用可能です。',
            ephemeral: true
          });
        }
  
        await Promise.all([
          loadConfig(true),
          loadStreamers(true),
          loadYoutubers(true),
          loadTwitcasters(true),
          loadServerSettings(true),
          loadAdmins(true),
          loadMazakari(true),
          loadCreators(true)
        ]);
  
        await interaction.reply({
          content: '設定ファイルを再読み込みしました。',
          ephemeral: true
        });
        break;
      }
  
      case 'admin': {
        if (!isCreator) {
          return interaction.reply({
            content: 'このコマンドはボット製作者のみ使用可能です。',
            ephemeral: true
          });
        }
  
        const user = options.getUser('user');
        if (creators.creators.includes(user.id)) {
          return interaction.reply({
            content: `${user.tag} はすでにボット製作者権限を持っています。`,
            ephemeral: true
          });
        }
  
        creators.creators.push(user.id);
        await saveCreators(creators);
        await interaction.reply({
          content: `${user.tag} にボット製作者権限を付与しました。`,
          ephemeral: true
        });
        break;
      }
  
      case 'mazakari': {
        if (!isCreator) {
          return interaction.reply({
            content: 'このコマンドはボット製作者のみ使用可能です。',
            ephemeral: true
          });
        }
  
        await interaction.reply({
          content: '配信通知設定のメッセージを記載した`.txt`ファイルをこのチャンネルに添付してください（30秒以内に）。',
          ephemeral: true
        });
  
        pendingMazakari.set(user.id, {
          guildId: guild.id,
          channelId: interaction.channel.id,
          timestamp: Date.now()
        });
  
        setTimeout(() => {
          if (pendingMazakari.has(user.id)) {
            pendingMazakari.delete(user.id);
            interaction.followUp({
              content: 'タイムアウトしました。再度`/mazakari`を実行してください。',
              ephemeral: true
            }).catch(err => console.error('フォローアップエラー:', err.message));
          }
        }, 30000);
        break;
      }
  
      case 'stop_mazakari': {
        if (!isCreator) {
          return interaction.reply({
            content: 'このコマンドはボット製作者のみ使用可能です。',
            ephemeral: true
          });
        }
  
        const mazakari = await loadMazakari();
        if (!mazakari.enabled[guild.id]) {
          return interaction.reply({
            content: 'このサーバーではMazakariは有効になっていません。',
            ephemeral: true
          });
        }
  
        mazakari.enabled[guild.id] = false;
        delete mazakari.guilds[guild.id];
        await saveConfigFile(MAZAKARI_FILE, mazakari);
        await interaction.reply({
          content: 'Mazakari機能を停止しました。新規メンバーへの通知は行われません。',
          ephemeral: true
        });
        break;
      }
  
      case 'clear_streams': {
        if (!isAdmin) {
          return interaction.reply({
            content: 'このコマンドは管理者にしか使用できません。',
            ephemeral: true
          });
        }
  
        const exclude = options.getString('exclude')?.split(',').map(id => id.trim()) || [];
        const guildId = guild.id;
  
        const [streamers, youtubers, twitcasters] = await Promise.all([
          loadStreamers(),
          loadYoutubers(),
          loadTwitcasters()
        ]);
  
        const originalCounts = {
          streamers: streamers.length,
          youtubers: youtubers.length,
          twitcasters: twitcasters.length
        };
  
        const filteredStreamers = streamers.filter(s =>
          exclude.includes(s.discordId) || !(s.guildIds && s.guildIds.includes(guildId))
        );
        const filteredYoutubers = youtubers.filter(y =>
          exclude.includes(y.discordId) || !(y.guildIds && y.guildIds.includes(guildId))
        );
        const filteredTwitcasters = twitcasters.filter(t =>
          exclude.includes(t.discordId) || !(t.guildIds && t.guildIds.includes(guildId))
        );
  
        await Promise.all([
          saveConfigFile(STREAMERS_FILE, filteredStreamers),
          saveConfigFile(YOUTUBERS_FILE, filteredYoutubers),
          saveConfigFile(TWITCASTERS_FILE, filteredTwitcasters)
        ]);
  
        const clearedCounts = {
          streamers: originalCounts.streamers - filteredStreamers.length,
          youtubers: originalCounts.youtubers - filteredYoutubers.length,
          twitcasters: originalCounts.twitcasters - filteredTwitcasters.length
        };
  
        await interaction.reply({
          content: `このサーバーの配信設定を削除しました。\n` +
                  `- Twitch: ${clearedCounts.streamers}件削除 (${filteredStreamers.length}件残存)\n` +
                  `- YouTube: ${clearedCounts.youtubers}件削除 (${filteredYoutubers.length}件残存)\n` +
                  `- TwitCasting: ${clearedCounts.twitcasters}件削除 (${filteredTwitcasters.length}件残存)\n` +
                  `除外ユーザー: ${exclude.length > 0 ? exclude.join(', ') : 'なし'}`,
          ephemeral: true
        });
        break;
      }
  
      case 'set_keywords': {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({
            content: 'このコマンドを使用するには管理者権限が必要です。',
            ephemeral: true
          });
        }
  
        const keywords = options.getString('keywords').split(',').map(k => k.trim());
        const serverSettings = await loadServerSettings();
        serverSettings.servers[guild.id] = {
          ...serverSettings.servers[guild.id],
          keywords
        };
        await saveConfigFile(SERVER_SETTINGS_FILE, serverSettings);
        await interaction.reply({
          content: `キーワードを設定しました: ${keywords.join(', ')}`,
          ephemeral: true
        });
        break;
      }
  
      case 'test_message': {
        await interaction.reply({
          content: 'テストメッセージ',
          ephemeral: true
        });
        break;
      }
  
      case 'clear_keywords': {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({
            content: 'このコマンドを使用するには管理者権限が必要です。',
            ephemeral: true
          });
        }
  
        const serverSettings = await loadServerSettings();
        serverSettings.servers[guild.id] = {
          ...serverSettings.servers[guild.id],
          keywords: []
        };
        await saveConfigFile(SERVER_SETTINGS_FILE, serverSettings);
        await interaction.reply({
          content: 'キーワードをすべて削除しました。',
          ephemeral: true
        });
        break;
      }
  
      case 'remember_twitch':
      case 'remember_youtube':
      case 'remember_twitcasting': {
        const type = commandName.split('_')[1];
        const userId = user.id;
        const guildId = guild.id;
  
        const platformConfig = {
          twitch: { file: STREAMERS_FILE, loader: loadStreamers },
          youtube: { file: YOUTUBERS_FILE, loader: loadYoutubers },
          twitcasting: { file: TWITCASTERS_FILE, loader: loadTwitcasters }
        };
  
        const { file, loader } = platformConfig[type];
        const accounts = await loader();
        const account = accounts.find(a => a.discordId === userId);
  
        if (!account) {
          return interaction.reply({
            content: `このDiscordアカウントは${type}にリンクされていません。先に /link を使用してください。`,
            ephemeral: true
          });
        }
  
        if (!account.guildIds) account.guildIds = [];
        if (!account.guildIds.includes(guildId)) {
          account.guildIds.push(guildId);
          await saveConfigFile(file, accounts);
        }
  
        await interaction.reply({
          content: `このサーバーでの${type}通知を有効化しました。`,
          ephemeral: true
        });
        break;
      }
  
      case 'link': {
        const guildId = guild.id;
        const config = await loadConfig();
        const youtubers = await loadYoutubers();
        const twitcasters = await loadTwitcasters();
  
        const buttons = [
          new ButtonBuilder()
            .setCustomId(`link_twitch_${guildId}`)
            .setLabel('Twitchをリンク')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔴')
        ];
  
        if (config.youtubeAccountLimit === 0 || youtubers.length < config.youtubeAccountLimit) {
          buttons.push(
            new ButtonBuilder()
              .setCustomId(`link_youtube_${guildId}`)
              .setLabel('YouTubeをリンク')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('▶️')
          );
        }
  
        if (config.twitcastingAccountLimit === 0 || twitcasters.length < config.twitcastingAccountLimit) {
          buttons.push(
            new ButtonBuilder()
              .setCustomId(`link_stream_${guildId}`)
              .setLabel('連携してないorツイキャス')
              .setStyle(ButtonStyle.Success)
              .setEmoji('📡')
          );
        }
  
        const row = new ActionRowBuilder().addComponents(buttons);
  
        await interaction.reply({
          content: '以下のボタンをクリックして、Twitch, YouTube, またはツイキャスのアカウントをリンクしてください。',
          components: [row],
          ephemeral: false
        });
        break;
      }

      case 'cleanup_members': {
        if (!isAdmin) {
          return interaction.reply({
            content: 'このコマンドは管理者にしか使用できません。',
            ephemeral: true
          });
        }

        await interaction.deferReply({ ephemeral: true });
        try {
          const summary = await cleanupLeftMembers(`手動実行 (${user.tag})`);
          const lines = Object.entries(summary).map(([label, s]) =>
            `- ${label}: アカウント削除 ${s.削除アカウント数}件 / サーバーリンク削除 ${s.削除リンク数}件（残存 ${s.残存件数}件）`
          );
          await interaction.editReply({
            content: `退出メンバーのクリーンアップが完了しました。\n${lines.join('\n')}`
          });
        } catch (err) {
          console.error('[cleanup_members] エラー:', err.message);
          await interaction.editReply({
            content: `クリーンアップ中にエラーが発生しました: ${err.message}`
          });
        }
        break;
      }
    }
  }
/**
 * TwitCastingアクセストークンを取得
 * @returns {Promise<string>} アクセストークン
 */
async function getTwitCastingAccessToken() {
  try {
    const response = await axios.post(
      'https://apiv2.twitcasting.tv/oauth2/token',
      null,
      {
        params: {
          client_id: process.env.TWITCASTING_CLIENT_ID,
          client_secret: process.env.TWITCASTING_CLIENT_SECRET,
          grant_type: 'client_credentials'
        },
        timeout: 5000
      }
    );
    console.log('TwitCastingアクセストークン取得成功');
    return response.data.access_token;
  } catch (err) {
    console.error('TwitCastingアクセストークン取得エラー:', err.message);
    throw err;
  }
}
  async function handleModalSubmit(interaction) {
    
    if (interaction.customId.startsWith('stream_url_modal_')) {
      // 正しいインデックスで値を取得
      const parts = interaction.customId.split('_');
      const guildId = parts[3]; // 4番目の要素
      const userId = parts[4];  // 5番目の要素
  
      const url = interaction.fields.getTextInputValue('stream_url').trim();
  
      // サーバー取得
      const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) {
        console.error(`無効なサーバーID: ${guildId}`);
        return interaction.reply({
          content: '無効なサーバーIDです。',
          ephemeral: true
        });
      }
  
      // URL解析
      const platformData = parseStreamUrl(url);
      if (!platformData) {
        console.warn(`無効なURL: ${url}`);
        return interaction.reply({
          content: '有効なYouTube、Twitch、またはTwitCastingのURLを入力してください。',
          ephemeral: true
        });
      }
  console.log(`解析結果:`, platformData);
  
      const platformConfig = {
        youtube: { file: YOUTUBERS_FILE, loader: loadYoutubers, key: 'youtubeId', usernameKey: 'youtubeUsername' },
        twitch: { file: STREAMERS_FILE, loader: loadStreamers, key: 'twitchId', usernameKey: 'twitchUsername' },
        twitcasting: { file: TWITCASTERS_FILE, loader: loadTwitcasters, key: 'twitcastingId', usernameKey: 'twitcastingUsername' }
      };
  
      const config = await loadConfig();
      const { file, loader, key, usernameKey } = platformConfig[platformData.platform];
      const accounts = await loader();
  
      const limits = {
        youtube: config.youtubeAccountLimit || 0,
        twitcasting: config.twitcastingAccountLimit || 25
      };
  
      if (limits[platformData.platform] > 0 && accounts.length >= limits[platformData.platform]) {
        return interaction.reply({
          content: `${platformData.platform}アカウントの登録上限に達しています。`,
          ephemeral: true
        });
      }
  
      if (accounts.some(acc => acc.discordId === userId)) {
        const account = accounts.find(acc => acc.discordId === userId);
        if (!account.guildIds.includes(guildId)) {
          account.guildIds.push(guildId);
          await saveConfigFile(file, accounts);
        }
        return interaction.reply({
          content: `${platformData.platform}アカウントはすでにリンクされています。このサーバーで通知を有効化しました。`,
          ephemeral: true
        });
      }
  
      if (accounts.some(acc => acc[key] === platformData.id)) {
        return interaction.reply({
          content: `この${platformData.platform}アカウントは別のユーザーで登録済みです。`,
          ephemeral: true
        });
      }
  
      // ユーザー名を取得
      let platformUsername;
      try {
  if (platformData.platform === 'youtube') {
    const params = {
      part: 'snippet',
      key: YOUTUBE_API_KEY
    };
    if (platformData.type === 'channelId') {
      params.id = platformData.id;
    } else if (platformData.type === 'handle') {
      params.forHandle = platformData.id;
    }
    const response = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params,
      timeout: 5000
    });
    const channel = response.data.items?.[0];
    if (!channel) {
      console.error(`YouTubeチャンネルが見つかりません: ${platformData.id}`);
      platformUsername = platformData.id;
      platformId = platformData.id; // フォールバック
    } else {
      platformUsername = channel.snippet.title;
      platformId = channel.id; // チャンネルIDを保存
    }
        } else if (platformData.platform === 'twitch') {
          const accessToken = await getTwitchAccessToken();
          const response = await axios.get('https://api.twitch.tv/helix/users', {
            params: { login: platformData.id }, // ユーザー名で検索
            headers: {
              'Client-ID': TWITCH_CLIENT_ID,
              'Authorization': `Bearer ${accessToken}`
            },
            timeout: 5000
          });
          platformUsername = response.data.data?.[0]?.display_name || platformData.id;
    
} else if (platformData.platform === 'twitcasting') {
  try {
    // g:プレフィックスを削除
    const userId = platformData.id.startsWith('g:') ? platformData.id.replace('g:', '') : platformData.id;
    console.log(`TwitCasting ID修正: ${userId}`); // 例: 106990371183082129385
    const accessToken = await getTwitCastingAccessToken();
    const response = await axios.get(
      `https://apiv2.twitcasting.tv/users/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        timeout: 5000
      }
    );
    platformUsername = response.data.user?.name || userId;
    platformData.id = userId; // 正しいIDを保存
    console.log(`ユーザー名取得成功: ${platformUsername}`); // 例: zaro_game
  } catch (err) {
    console.error(`ユーザー名取得エラー (${platformData.platform}, ID: ${platformData.id}):`, {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data
    });
    return interaction.reply({
      content: `ツイキャスアカウントのユーザー名を取得できませんでした。管理者に連絡してください。`,
      ephemeral: true
    });
  }
}
      } catch (err) {
        console.error(`ユーザー名取得エラー (${platformData.platform}, ID: ${platformData.id}):`, {
          message: err.message,
          status: err.response?.status,
          data: err.response?.data
        });
        platformUsername = platformData.id; // フォールバック
      }
  
      accounts.push({
        discordId: userId,
        [key]: platformData.id,
        [usernameKey]: platformUsername, // 正しいユーザー名を保存
        guildIds: [guildId]
      });
      await saveConfigFile(file, accounts);
  
      console.log(`アカウントリンク成功: platform=${platformData.platform}, userId=${userId}, username=${platformUsername}, id=${platformData.id}`);
  
      const settings = await loadServerSettings();
      const roleId = settings.servers[guildId]?.notificationRoles?.[platformData.platform];
  
      if (roleId) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          await member.roles.add(roleId).catch(err => console.error(`ロール付与エラー: user=${userId}, role=${roleId}`, err.message));
        }
      }
  
      await interaction.reply({
        content: `${platformData.platform}アカウント (${platformUsername}) をリンクしました！`,
        ephemeral: true
      });
    } else if (interaction.customId === 'admin_message_modal') {
      const admins = await loadAdmins();
      if (!admins.admins.includes(interaction.user.id)) {
        return interaction.reply({
          content: 'このコマンドは管理者にしか使用できません。',
          ephemeral: true
        });
      }
  
      const password = interaction.fields.getTextInputValue('password');
      const message = interaction.fields.getTextInputValue('message');
  
      if (password !== ADMIN_PASSWORD) {
        return interaction.reply({
          content: 'パスワードが正しくありません。',
          ephemeral: true
        });
      }
  
      const guilds = client.guilds.cache;
      let successCount = 0;
      let failCount = 0;
  
      for (const guild of guilds.values()) {
        try {
          const owner = await guild.fetchOwner();
          await owner.send(`[管理者からのメッセージ]\n${message}`);
          successCount++;
        } catch (err) {
          console.error(`サーバー ${guild.id} のオーナーに送信失敗:`, err.message);
          failCount++;
        }
      }
  
      await interaction.reply({
        content: `メッセージ送信を試みました。\n成功: ${successCount} サーバー\n失敗: ${failCount} サーバー`,
        ephemeral: true
      });
    }
  }
  
  async function handleButtonInteraction(interaction) {
    if (interaction.customId.startsWith('link_')) {
      const [_, type, guildId, targetUserId] = interaction.customId.split('_');
      const userId = targetUserId || interaction.user.id;
  
      if (!['twitch', 'youtube', 'stream'].includes(type)) {
        console.error(`無効なボタンタイプ: ${type}`);
        return interaction.reply({
          content: '無効なボタンです。',
          ephemeral: true
        });
      }
  
      if (!client.guilds.cache.has(guildId)) {
        console.error(`無効なサーバーID: ${guildId}`);
        return interaction.reply({
          content: 'このボタンは無効なサーバーに関連しています。',
          ephemeral: true
        });
      }
  
      if (type === 'stream') {
        const modal = new ModalBuilder()
          .setCustomId(`stream_url_modal_${guildId}_${userId}`)
          .setTitle('配信チャンネルURLの入力');
  
        const urlInput = new TextInputBuilder()
          .setCustomId('stream_url')
          .setLabel('配信チャンネルのURL')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('YouTube/Twitch/ツイキャスのチャンネルURLを入力　')
          .setRequired(true);
  
        modal.addComponents(new ActionRowBuilder().addComponents(urlInput));
        await interaction.showModal(modal);
      } else {
        const dataLoaders = {
          twitch: loadStreamers,
          youtube: loadYoutubers
        };
  
        const accounts = await dataLoaders[type]();
        if (accounts.some(a => a.discordId === userId)) {
          return interaction.reply({
            content: `${type}アカウントはすでにリンクされています。`,
            ephemeral: true
          });
        }
  
        const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(
          DISCORD_CLIENT_ID
        )}&redirect_uri=${encodeURIComponent(
          REDIRECT_URI
        )}&response_type=code&scope=identify%20connections&state=${type}_${guildId}`;
  
        await interaction.reply({
          content: `以下のリンクをクリックして${type}アカウントをリンクしてください:\n${oauthUrl}`,
          ephemeral: true
        });
      }
    }
  }
  
  // ==============================================
  // ボット起動
  // ==============================================
  
  client.login(DISCORD_TOKEN).catch(err => {
    console.error('Discordボットログインエラー:', err.message);
    process.exit(1);
  });
  
  process.on('SIGINT', async () => {
    console.log('ボットを終了します...');
    await client.destroy();
    process.exit(0);
  });
  
  process.on('uncaughtException', err => {
    console.error('未キャッチ例外:', {
      message: err.message,
      stack: err.stack
    });
  });
  
  process.on('unhandledRejection', err => {
    console.error('未処理のPromise拒否:', {
      message: err.message,
      stack: err.stack
    });
  });
