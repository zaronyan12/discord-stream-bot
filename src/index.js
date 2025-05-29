require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  PermissionsBitField,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChannelType,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const axios = require('axios');
const express = require('express');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');

// 環境変数
const {
  DISCORD_TOKEN,
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  YOUTUBE_API_KEY,
  TWITCASTING_CLIENT_ID,
  TWITCASTING_CLIENT_SECRET,
  ADMIN_PASSWORD,
  BOT_CREATOR_ID,
  REDIRECT_URI = 'https://zaronyanbot.com:3000/callback',
} = process.env;

// 環境変数のチェック
const requiredEnvVars = [
  'DISCORD_TOKEN',
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'YOUTUBE_API_KEY',
  'TWITCASTING_CLIENT_ID',
  'TWITCASTING_CLIENT_SECRET',
  'ADMIN_PASSWORD',
  'BOT_CREATOR_ID',
];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`エラー: 環境変数 ${envVar} が設定されていません。`);
    process.exit(1);
  }
}

// ファイルパス
const CONFIG_FILE = path.join(__dirname, '../config.json');
const STREAMERS_FILE = path.join(__dirname, '../data/streamers.json');
const YOUTUBERS_FILE = path.join(__dirname, '../data/youtubers.json');
const TWITCASTERS_FILE = path.join(__dirname, '../data/twitcasters.json');
const SERVER_SETTINGS_FILE = path.join(__dirname, '../data/serverSettings.json');
const ADMINS_FILE = path.join(__dirname, '../data/admins.json');
const MAZAKARI_FILE = path.join(__dirname, '../data/mazakari.json');

// キャッシュ
let configCache = null;
let streamersCache = null;
let youtubersCache = null;
let twitcastersCache = null;
let serverSettingsCache = null;
let adminsCache = null;
let mazakariCache = null;

// 設定ファイルの読み込み
async function loadConfig(force = false) {
  if (!force && configCache) {
    console.log('configキャッシュを使用');
    return configCache;
  }
  try {
    console.log('config.jsonを読み込み中:', CONFIG_FILE);
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    configCache = JSON.parse(data);
    console.log('config.json読み込み成功');
    return configCache;
  } catch (err) {
    console.warn('config.jsonが見つからないか無効です。デフォルト設定を使用します:', err.message);
    configCache = { youtubeAccountLimit: 0, twitcastingAccountLimit: 25 };
    return configCache;
  }
}

// ストリーマーデータの読み込み
async function loadStreamers(force = false) {
  if (!force && streamersCache) {
    console.log('streamersキャッシュを使用');
    return streamersCache;
  }
  try {
    console.log('streamers.jsonを読み込み中:', STREAMERS_FILE);
    const data = await fs.readFile(STREAMERS_FILE, 'utf8');
    streamersCache = JSON.parse(data);
    console.log('streamers.json読み込み成功');
    return streamersCache;
  } catch (err) {
    console.warn('streamers.jsonが見つからないか無効です。デフォルトを使用します:', err.message);
    streamersCache = [];
    return streamersCache;
  }
}

// ストリーマーデータの保存
async function saveStreamers(streamers) {
  try {
    console.log('streamers.jsonを保存中:', STREAMERS_FILE);
    streamersCache = streamers;
    await fs.writeFile(STREAMERS_FILE, JSON.stringify(streamers, null, 2));
    console.log('streamers.json保存成功');
  } catch (err) {
    console.error('ストリーマーデータ保存エラー:', err.message);
    throw err;
  }
}

// YouTube配信者データの読み込み
async function loadYoutubers(force = false) {
  if (!force && youtubersCache) {
    console.log('youtubersキャッシュを使用');
    return youtubersCache;
  }
  try {
    console.log('youtubers.jsonを読み込み中:', YOUTUBERS_FILE);
    const data = await fs.readFile(YOUTUBERS_FILE, 'utf8');
    youtubersCache = JSON.parse(data);
    console.log('youtubers.json読み込み成功');
    return youtubersCache;
  } catch (err) {
    console.warn('youtubers.jsonが見つからないか無効です。デフォルトを使用します:', err.message);
    youtubersCache = [];
    return youtubersCache;
  }
}

// YouTube配信者データの保存
async function saveYoutubers(youtubers) {
  try {
    console.log('youtubers.jsonを保存中:', YOUTUBERS_FILE);
    youtubersCache = youtubers;
    await fs.writeFile(YOUTUBERS_FILE, JSON.stringify(youtubers, null, 2));
    console.log('youtubers.json保存成功');
  } catch (err) {
    console.error('YouTube配信者データ保存エラー:', err.message);
    throw err;
  }
}

// ツイキャス配信者データの読み込み
async function loadTwitcasters(force = false) {
  if (!force && twitcastersCache) {
    console.log('twitcastersキャッシュを使用');
    return twitcastersCache;
  }
  try {
    console.log('twitcasters.jsonを読み込み中:', TWITCASTERS_FILE);
    const data = await fs.readFile(TWITCASTERS_FILE, 'utf8');
    twitcastersCache = JSON.parse(data);
    console.log('twitcasters.json読み込み成功');
    return twitcastersCache;
  } catch (err) {
    console.warn('twitcasters.jsonが見つからないか無効です。デフォルトを使用します:', err.message);
    twitcastersCache = [];
    return twitcastersCache;
  }
}

// ツイキャス配信者データの保存
async function saveTwitcasters(twitcasters) {
  try {
    console.log('twitcasters.jsonを保存中:', TWITCASTERS_FILE);
    twitcastersCache = twitcasters;
    await fs.writeFile(TWITCASTERS_FILE, JSON.stringify(twitcasters, null, 2));
    console.log('twitcasters.json保存成功');
  } catch (err) {
    console.error('ツイキャス配信者データ保存エラー:', err.message);
    throw err;
  }
}

// サーバー設定の読み込み
async function loadServerSettings(force = false) {
  if (!force && serverSettingsCache) {
    console.log('serverSettingsキャッシュを使用');
    return serverSettingsCache;
  }
  try {
    console.log('serverSettings.jsonを読み込み中:', SERVER_SETTINGS_FILE);
    const data = await fs.readFile(SERVER_SETTINGS_FILE, 'utf8');
    serverSettingsCache = JSON.parse(data);
    serverSettingsCache.streamStatus ??= {};
    serverSettingsCache.youtubeStatus ??= {};
    serverSettingsCache.twitcastingStatus ??= {};
    serverSettingsCache.keywords ??= {};
    serverSettingsCache.notificationRoles ??= {};
    console.log('serverSettings.json読み込み成功');
    return serverSettingsCache;
  } catch (err) {
    console.warn('serverSettings.jsonが見つからないか無効です。デフォルトを使用します:', err.message);
    serverSettingsCache = {
      servers: {},
      streamStatus: {},
      youtubeStatus: {},
      twitcastingStatus: {},
      keywords: {},
      notificationRoles: {},
    };
    return serverSettingsCache;
  }
}

// サーバー設定の保存
async function saveServerSettings(settings) {
  try {
    console.log('serverSettings.jsonを保存中:', SERVER_SETTINGS_FILE);
    serverSettingsCache = settings;
    await fs.writeFile(SERVER_SETTINGS_FILE, JSON.stringify(settings, null, 2));
    console.log('serverSettings.json保存成功');
  } catch (err) {
    console.error('サーバー設定保存エラー:', err.message);
    throw err;
  }
}

// 管理者リストの読み込み
async function loadAdmins(force = false) {
  if (!force && adminsCache) {
    console.log('adminsキャッシュを使用');
    return adminsCache;
  }
  try {
    console.log('admins.jsonを読み込み中:', ADMINS_FILE);
    const data = await fs.readFile(ADMINS_FILE, 'utf8');
    adminsCache = JSON.parse(data);
    console.log('admins.json読み込み成功');
    return adminsCache;
  } catch (err) {
    console.warn('admins.jsonが見つからないか無効です。デフォルトを使用します:', err.message);
    adminsCache = { admins: [BOT_CREATOR_ID] };
    return adminsCache;
  }
}

// 管理者リストの保存
async function saveAdmins(admins) {
  try {
    console.log('admins.jsonを保存中:', ADMINS_FILE);
    adminsCache = admins;
    await fs.writeFile(ADMINS_FILE, JSON.stringify(admins, null, 2));
    console.log('admins.json保存成功');
  } catch (err) {
    console.error('管理者リスト保存エラー:', err.message);
    throw err;
  }
}

// Mazakari設定の読み込み
async function loadMazakari(force = false) {
  if (!force && mazakariCache) {
    console.log('mazakariキャッシュを使用');
    return mazakariCache;
  }
  try {
    console.log('mazakari.jsonを読み込み中:', MAZAKARI_FILE);
    const data = await fs.readFile(MAZAKARI_FILE, 'utf8');
    mazakariCache = JSON.parse(data);
    console.log('mazakari.json読み込み成功');
    return mazakariCache;
  } catch (err) {
    console.warn('mazakari.jsonが見つからないか無効です。デフォルトを使用します:', err.message);
    mazakariCache = { enabled: {}, guilds: {} };
    return mazakariCache;
  }
}

// Mazakari設定の保存
async function saveMazakari(mazakari) {
  try {
    console.log('mazakari.jsonを保存中:', MAZAKARI_FILE);
    mazakariCache = mazakari;
    await fs.writeFile(MAZAKARI_FILE, JSON.stringify(mazakari, null, 2));
    console.log('mazakari.json保存成功');
  } catch (err) {
    console.error('Mazakari設定保存エラー:', err.message);
    throw err;
  }
}

// Twitchトークンの取得
let twitchTokenCache = null;
let twitchTokenExpiry = 0;
async function getTwitchToken() {
  if (twitchTokenCache && Date.now() < twitchTokenExpiry) {
    return twitchTokenCache;
  }
  try {
    console.log('Twitchトークンを取得中');
    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
        grant_type: 'client_credentials',
      },
    });
    twitchTokenCache = response.data.access_token;
    twitchTokenExpiry = Date.now() + response.data.expires_in * 1000 - 60000;
    console.log('Twitchトークン取得成功');
    return twitchTokenCache;
  } catch (err) {
    console.error('Twitchトークン取得エラー:', err.response?.data || err.message);
    return null;
  }
}

// ツイキャストークンの取得
let twitCastingTokenCache = null;
let twitCastingTokenExpiry = 0;
async function getTwitCastingToken() {
  if (twitCastingTokenCache && Date.now() < twitCastingTokenExpiry) {
    return twitCastingTokenCache;
  }
  try {
    console.log('ツイキャストークンを取得中');
    const response = await axios.post(
      'https://apiv2.twitcasting.tv/oauth2/access_token',
      new URLSearchParams({
        client_id: TWITCASTING_CLIENT_ID,
        client_secret: TWITCASTING_CLIENT_SECRET,
        grant_type: 'client_credentials',
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );
    twitCastingTokenCache = response.data.access_token;
    twitCastingTokenExpiry = Date.now() + response.data.expires_in * 1000 - 60000;
    console.log('ツイキャストークン取得成功');
    return twitCastingTokenCache;
  } catch (err) {
    console.error('ツイキャストークン取得エラー:', err.response?.data || err.message);
    return null;
  }
}

// Discord接続情報の取得
async function getConnections(accessToken) {
  try {
    console.log('Discord接続情報を取得中');
    const response = await axios.get('https://discord.com/api/v10/users/@me/connections', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const connections = {
      twitch_username: '',
      youtube_channel_id: '',
      twitcasting_user_id: '',
    };
    for (const conn of response.data) {
      if (conn.type === 'twitch') {
        connections.twitch_username = conn.name;
      }
      if (conn.type === 'youtube') {
        connections.youtube_channel_id = conn.id;
      }
      if (conn.type === 'twitcasting') {
        connections.twitcasting_user_id = conn.id;
      }
    }
    console.log('接続情報取得成功:', connections);
    return connections;
  } catch (err) {
    console.error('接続情報取得エラー:', err.response?.data || err.message);
    return {
      twitch_username: '',
      youtube_channel_id: '',
      twitcasting_user_id: '',
    };
  }
}

// Twitchストリームのチェック
async function checkTwitchStreams() {
  const streamers = await loadStreamers();
  if (!streamers.length) {
    return;
  }

  const token = await getTwitchToken();
  if (!token) {
    return;
  }

  const settings = await loadServerSettings();
  const currentStatus = {};

  const chunkSize = 100;
  for (let i = 0; i < streamers.length; i += chunkSize) {
    const chunk = streamers.slice(i, i + chunkSize);
    const query = chunk.map(s => `user_login=${s.username}`).join('&');
    try {
      const response = await axios.get(`https://api.twitch.tv/helix/streams?${query}`, {
        headers: {
          'Client-ID': TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      });

      for (const stream of response.data.data) {
        const streamer = stream.user_login;
        const streamTitle = stream.title;
        currentStatus[streamer] = true;

        if (!settings.streamStatus[streamer]) {
          const streamerInfo = streamers.find(s => s.username === streamer);
          for (const [guildId, guildSettings] of Object.entries(settings.servers)) {
            const keywords = guildSettings.keywords || [];
            if (
              keywords.length &&
              !keywords.some(keyword =>
                streamTitle.toLowerCase().includes(keyword.toLowerCase()),
              )
            ) {
              continue;
            }

            const channel = client.channels.cache.get(guildSettings.channelId);
            if (!channel) {
              console.warn(`チャンネル ${guildSettings.channelId} が見つかりません`);
              continue;
            }

            const botMember = channel.guild.members.me;
            if (!channel.permissionsFor(botMember)?.has(PermissionsBitField.Flags.SendMessages)) {
              console.warn(`チャンネル ${channel.id} (サーバー: ${guildId}) でメッセージ送信権限がありません`);
              continue;
            }

            await channel.send(`${streamer} is live on Twitch!\nhttps://twitch.tv/${streamer}`);
            const guild = client.guilds.cache.get(guildId);
            const member = await guild.members.fetch(streamerInfo.discord_id).catch(() => null);
            if (member) {
              const role = guild.roles.cache.get(guildSettings.liveRoleId);
              if (!role || role.position >= botMember.roles.highest.position) {
                console.warn(`サーバー ${guildId} でロール ${guildSettings.liveRoleId} を管理できません`);
                continue;
              }
              await member.roles.add(guildSettings.liveRoleId);
            }
          }
          settings.streamStatus[streamer] = true;
        }
      }
    } catch (err) {
      console.error('Twitchストリームチェックエラー:', err.response?.data || err.message);
    }
  }

  for (const s of streamers) {
    if (settings.streamStatus[s.username] && !currentStatus[s.username]) {
      settings.streamStatus[s.username] = false;
      for (const [guildId, guildSettings] of Object.entries(settings.servers)) {
        const guild = client.guilds.cache.get(guildId);
        const member = await guild.members.fetch(s.discord_id).catch(() => null);
        if (member) {
          const botMember = guild.members.me;
          const role = guild.roles.cache.get(guildSettings.liveRoleId);
          if (!role || role.position >= botMember.roles.highest.position) {
            continue;
          }
          await member.roles.remove(guildSettings.liveRoleId);
        }
      }
    }
  }

  if (Object.keys(currentStatus).length || Object.keys(settings.streamStatus).length) {
    await saveServerSettings(settings);
  }
}

// YouTubeライブのチェック
async function checkYouTubeStreams() {
  let youtubers = await loadYoutubers();
  if (!youtubers.length) {
    return;
  }

  const config = await loadConfig();
  const youtubeAccountLimit = config.youtubeAccountLimit || 0;

  if (youtubeAccountLimit > 0) {
    youtubers = youtubers.slice(0, youtubeAccountLimit);
  }

  const settings = await loadServerSettings();
  const currentStatus = {};

  const channelIds = youtubers.map(yt => yt.channel_id).join(',');
  try {
    const response = await axios.get(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&id=${channelIds}&key=${YOUTUBE_API_KEY}`,
    );

    const liveChannelIds = [];
    for (const item of response.data.items) {
      const channelId = item.id;
      const liveBroadcastContent = item.snippet.liveBroadcastContent;
      if (liveBroadcastContent === 'live') {
        liveChannelIds.push(channelId);
      }
      currentStatus[channelId] = liveBroadcastContent === 'live';
    }

    for (const channelId of liveChannelIds) {
      try {
        const searchResponse = await axios.get(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${YOUTUBE_API_KEY}`,
        );

        if (searchResponse.data.items.length > 0) {
          const videoId = searchResponse.data.items[0].id.videoId;
          const channelName = searchResponse.data.items[0].snippet.channelTitle;
          const streamTitle = searchResponse.data.items[0].snippet.title;
          const youtuber = youtubers.find(yt => yt.channel_id === channelId);

          if (!settings.youtubeStatus[channelId]) {
            for (const [guildId, guildSettings] of Object.entries(settings.servers)) {
              const keywords = guildSettings.keywords || [];
              if (
                keywords.length &&
                !keywords.some(keyword =>
                  streamTitle.toLowerCase().includes(keyword.toLowerCase()),
                )
              ) {
                continue;
              }

              const channel = client.channels.cache.get(guildSettings.channelId);
              if (!channel) {
                console.warn(`チャンネル ${guildSettings.channelId} が見つかりません`);
                continue;
              }

              const botMember = channel.guild.members.me;
              if (!channel.permissionsFor(botMember)?.has(PermissionsBitField.Flags.SendMessages)) {
                console.warn(`チャンネル ${channel.id} (サーバー: ${guildId}) でメッセージ送信権限がありません`);
                continue;
              }

              await channel.send(
                `${channelName} is live on YouTube!\nhttps://youtube.com/watch?v=${videoId}`,
              );
              const guild = client.guilds.cache.get(guildId);
              const member = await guild.members.fetch(youtuber.discord_id).catch(() => null);
              if (member) {
                const role = guild.roles.cache.get(guildSettings.liveRoleId);
                if (!role || role.position >= botMember.roles.highest.position) {
                  console.warn(`サーバー ${guildId} でロール ${guildSettings.liveRoleId} を管理できません`);
                  continue;
                }
                await member.roles.add(guildSettings.liveRoleId);
              }
            }
            settings.youtubeStatus[channelId] = true;
          }
        }
      } catch (err) {
        console.error(`YouTube検索エラー (チャンネルID: ${channelId}):`, err.response?.data || err.message);
      }
    }
  } catch (err) {
    console.error('YouTubeチャンネルチェックエラー:', err.response?.data || err.message);
  }

  for (const yt of youtubers) {
    if (settings.youtubeStatus[yt.channel_id] && !currentStatus[yt.channel_id]) {
      settings.youtubeStatus[yt.channel_id] = false;
      for (const [guildId, guildSettings] of Object.entries(settings.servers)) {
        const guild = client.guilds.cache.get(guildId);
        const member = await guild.members.fetch(yt.discord_id).catch(() => null);
        if (member) {
          const botMember = guild.members.me;
          const role = guild.roles.cache.get(guildSettings.liveRoleId);
          if (!role || role.position >= botMember.roles.highest.position) {
            continue;
          }
          await member.roles.remove(guildSettings.liveRoleId);
        }
      }
    }
  }

  if (Object.keys(currentStatus).length || Object.keys(settings.youtubeStatus).length) {
    await saveServerSettings(settings);
  }
}

// ツイキャス配信のチェック
async function checkTwitCastingStreams() {
  const twitcasters = await loadTwitcasters();
  if (!twitcasters.length) {
    return;
  }

  const config = await loadConfig();
  const twitcastingAccountLimit = config.twitcastingAccountLimit || 25;
  const limitedTwitcasters = twitcasters.slice(0, twitcastingAccountLimit);

  const settings = await loadServerSettings();
  const currentStatus = {};

  const token = await getTwitCastingToken();
  if (!token) {
    return;
  }

  for (const twitcaster of limitedTwitcasters) {
    try {
      const response = await axios.get(
        `https://apiv2.twitcasting.tv/users/${twitcaster.user_id}/current_live`,
        {
          headers: {
            Accept: 'application/json',
            'X-Api-Version': '2.0',
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const isLive = response.data.movie?.is_live || false;
      currentStatus[twitcaster.user_id] = isLive;

      if (isLive && !settings.twitcastingStatus[twitcaster.user_id]) {
        const streamTitle = response.data.movie.title;

        for (const [guildId, guildSettings] of Object.entries(settings.servers)) {
          const keywords = guildSettings.keywords || [];
          if (
            keywords.length &&
            !keywords.some(keyword =>
              streamTitle.toLowerCase().includes(keyword.toLowerCase()),
            )
          ) {
            continue;
          }

          const channel = client.channels.cache.get(guildSettings.channelId);
          if (!channel) {
            console.warn(`チャンネル ${guildSettings.channelId} が見つかりません`);
            continue;
          }

          const botMember = channel.guild.members.me;
          if (!channel.permissionsFor(botMember)?.has(PermissionsBitField.Flags.SendMessages)) {
            console.warn(`チャンネル ${channel.id} (サーバー: ${guildId}) でメッセージ送信権限がありません`);
            continue;
          }

          await channel.send(
            `${twitcaster.username} is live on TwitCasting!\nhttps://twitcasting.tv/${twitcaster.username}`,
          );
          const guild = client.guilds.cache.get(guildId);
          const member = await guild.members.fetch(twitcaster.discord_id).catch(() => null);
          if (member) {
            const role = guild.roles.cache.get(guildSettings.liveRoleId);
            if (!role || role.position >= botMember.roles.highest.position) {
              console.warn(`サーバー ${guildId} でロール ${guildSettings.liveRoleId} を管理できません`);
              continue;
            }
            await member.roles.add(guildSettings.liveRoleId);
          }
        }
        settings.twitcastingStatus[twitcaster.user_id] = true;
      }
    } catch (err) {
      console.error(`ツイキャスチェックエラー (ユーザーID: ${twitcaster.user_id}):`, err.response?.data || err.message);
    }
  }

  for (const tc of limitedTwitcasters) {
    if (settings.twitcastingStatus[tc.user_id] && !currentStatus[tc.user_id]) {
      settings.twitcastingStatus[tc.user_id] = false;
      for (const [guildId, guildSettings] of Object.entries(settings.servers)) {
        const guild = client.guilds.cache.get(guildId);
        const member = await guild.members.fetch(tc.discord_id).catch(() => null);
        if (member) {
          const botMember = guild.members.me;
          const role = guild.roles.cache.get(guildSettings.liveRoleId);
          if (!role || role.position >= botMember.roles.highest.position) {
            continue;
          }
          await member.roles.remove(guildSettings.liveRoleId);
        }
      }
    }
  }

  if (Object.keys(currentStatus).length || Object.keys(settings.twitcastingStatus).length) {
    await saveServerSettings(settings);
  }
}

// OAuthサーバー設定
const app = express();
const httpsOptions = {
  cert: fs.readFileSync('/etc/letsencrypt/live/zaronyanbot.com/fullchain.pem'),
  key: fs.readFileSync('/etc/letsencrypt/live/zaronyanbot.com/privkey.pem'),
};

app.get('/callback', async (req, res) => {
  console.log('OAuthコールバック受信:', {
    code: req.query.code,
    state: req.query.state,
    error: req.query.error,
    error_description: req.query.error_description,
  });

  if (!req.query.code) {
    return res.send('エラー: コードが提供されていません。');
  }

  const type = req.query.state;
  if (!['twitch', 'youtube', 'twitcasting'].includes(type)) {
    return res.send('エラー: 無効なリクエストです。');
  }

  try {
    const response = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: req.query.code,
        redirect_uri: REDIRECT_URI,
      }),
    );

    const accessToken = response.data.access_token;
    const connections = await getConnections(accessToken);

    const userResponse = await axios.get('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const discordId = userResponse.data.id;

    const settings = await loadServerSettings();

    if (type === 'twitch' && connections.twitch_username) {
      const streamers = await loadStreamers();
      if (!streamers.some(s => s.username === connections.twitch_username)) {
        streamers.push({ username: connections.twitch_username, discord_id: discordId });
        await saveStreamers(streamers);
        for (const guildSettings of Object.values(settings.servers)) {
          const channel = client.channels.cache.get(guildSettings.channelId);
          if (
            channel &&
            channel.permissionsFor(channel.guild.members.me)?.has(PermissionsBitField.Flags.SendMessages)
          ) {
            await channel.send(`Twitchアカウントをリンクしました: ${connections.twitch_username}`);
          }
        }
        res.send('Twitchアカウントのリンクが完了しました！あなたのTwitch配信を通知できるようになりました♡');
      } else {
        res.send('このTwitchアカウントはすでにリンクされています。');
      }
    } else if (type === 'youtube' && connections.youtube_channel_id) {
      const youtubers = await loadYoutubers();
      const config = await loadConfig();
      const youtubeAccountLimit = config.youtubeAccountLimit || 0;

      if (youtubeAccountLimit > 0 && youtubers.length >= youtubeAccountLimit) {
        res.send(`現在YouTube配信通知はAPIの関係上${youtubeAccountLimit}人の制限が設けてあります。正式リリースをお待ちください。`);
        return;
      }

      if (!youtubers.some(y => y.channel_id === connections.youtube_channel_id)) {
        youtubers.push({ channel_id: connections.youtube_channel_id, discord_id: discordId });
        await saveYoutubers(youtubers);
        for (const guildSettings of Object.values(settings.servers)) {
          const channel = client.channels.cache.get(guildSettings.channelId);
          if (
            channel &&
            channel.permissionsFor(channel.guild.members.me)?.has(PermissionsBitField.Flags.SendMessages)
          ) {
            await channel.send(`YouTubeチャンネルをリンクしました: ${connections.youtube_channel_id}`);
          }
        }
        res.send('YouTubeアカウントのリンクが完了しました！あなたのYouTube配信を通知できるようになりました♡');
      } else {
        res.send('このYouTubeチャンネルはすでにリンクされています。');
      }
    } else if (type === 'twitcasting' && connections.twitcasting_user_id) {
      const twitcasters = await loadTwitcasters();
      const config = await loadConfig();
      const twitcastingAccountLimit = config.twitcastingAccountLimit || 25;

      if (twitcastingAccountLimit > 0 && twitcasters.length >= twitcastingAccountLimit) {
        res.send(`現在ツイキャス配信通知は${twitcastingAccountLimit}人の制限が設けてあります。`);
        return;
      }

      if (!twitcasters.some(tc => tc.user_id === connections.twitcasting_user_id)) {
        twitcasters.push({
          user_id: connections.twitcasting_user_id,
          username: connections.twitcasting_user_id,
          discord_id: discordId,
        });
        await saveTwitcasters(twitcasters);
        for (const guildSettings of Object.values(settings.servers)) {
          const channel = client.channels.cache.get(guildSettings.channelId);
          if (
            channel &&
            channel.permissionsFor(channel.guild.members.me)?.has(PermissionsBitField.Flags.SendMessages)
          ) {
            await channel.send(`ツイキャスアカウントをリンクしました: ${connections.twitcasting_user_id}`);
          }
        }
        res.send('ツイキャスアカウントのリンクが完了しました！あなたのツイキャス配信を通知できるようになりました♡');
      } else {
        res.send('このツイキャスアカウントはすでにリンクされています。');
      }
    } else {
      res.send(
        `エラー: ${
          type === 'twitch' ? 'Twitch' : type === 'youtube' ? 'YouTube' : 'TwitCasting'
        }アカウントが接続されていません。Discordの設定でアカウントを接続してください。`,
      );
    }
  } catch (err) {
    console.error('OAuthエラー:', err.response?.data || err.message);
    res.send('エラー: 認証に失敗しました。');
  }
});

// HTTPSサーバー起動（IPv4対応）
https.createServer(httpsOptions, app).listen(3000, '0.0.0.0', () => {
  console.log('OAuthサーバーが https://zaronyanbot.com:3000 で起動しました (IPv4/IPv6)');
  if (REDIRECT_URI.startsWith('http://') && !REDIRECT_URI.includes('localhost')) {
    console.warn('警告: 非localhost URIでHTTPを使用しています。セキュリティのためにHTTPSを推奨します。');
  }
});

// Discordクライアント初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildPresences,
  ],
});

// 新規メンバー参加時の処理
client.on('guildMemberAdd', async member => {
  const mazakari = await loadMazakari();
  if (!mazakari.enabled[member.guild.id] || !mazakari.guilds[member.guild.id]) {
    return;
  }

  const message = mazakari.guilds[member.guild.id].message;
  const buttons = [
    new ButtonBuilder()
      .setCustomId('twitch_notification')
      .setLabel('Twitch通知')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('youtube_notification')
      .setLabel('YouTube通知')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('twitcasting_notification')
      .setLabel('ツイキャス通知')
      .setStyle(ButtonStyle.Primary),
  ];
  const row = new ActionRowBuilder().addComponents(buttons);

  try {
    await member.send({ content: message, components: [row] });
  } catch (err) {
    console.error(`メンバー ${member.id} へのDM送信に失敗:`, err.message);
    try {
      const botMember = member.guild.members.me;
      if (!member.guild.channels.permissionsFor(botMember)?.has(PermissionsBitField.Flags.ManageChannels)) {
        console.warn(`サーバー ${member.guild.id} でチャンネル管理権限がありません`);
        return;
      }
      const channel = await member.guild.channels.create({
        name: `welcome-${member.user.username}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: member.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          {
            id: member.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
            ],
          },
          {
            id: client.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
            ],
          },
        ],
      });
      const sentMessage = await channel.send({
        content: `${member} ${message}`,
        components: [row],
      });
      sentMessage.channelId = channel.id;
    } catch (createErr) {
      console.error(`チャンネル作成エラー (ユーザー: ${member.id}):`, createErr.message);
    }
  }
});

// ボット起動時の処理
client.on('ready', async () => {
  console.log('✅ ボットがオンラインになりました！');
  console.log('ボットのユーザー名:', client.user.tag);
  console.log('参加しているサーバー数:', client.guilds.cache.size);
  client.guilds.cache.forEach(guild => {
    console.log(`サーバー: ${guild.name} (ID: ${guild.id})`);
    console.log('ボット権限:', guild.members.me.permissions.toArray());
  });

  // ステータスを設定
  client.user.setPresence({
    activities: [{ name: '配信を監視中', type: 'WATCHING' }],
    status: 'online',
  });
  console.log('プレゼンスを設定しました');

  // 設定ファイルの初期化確認
  try {
    await loadServerSettings(true);
    console.log('serverSettings.jsonを正常に読み込みました');
  } catch (err) {
    console.error('serverSettings.json初期化エラー:', err.message);
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('link_twitch')
      .setDescription('Twitchアカウントをリンクして配信監視を有効にします'),
    new SlashCommandBuilder()
      .setName('link_youtube')
      .setDescription('YouTubeアカウントをリンクして配信監視を有効にします'),
    new SlashCommandBuilder()
      .setName('link_twitcasting')
      .setDescription('ツイキャスアカウントをリンクして配信監視を有効にします'),
    new SlashCommandBuilder()
      .setName('setup_s')
      .setDescription('このサーバーでボットを設定します')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('配信通知を送信するチャンネル')
          .setRequired(true),
      )
      .addRoleOption(option =>
        option
          .setName('live_role')
          .setDescription('配信中に付与するロール')
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName('set_notification_roles')
      .setDescription('通知設定ボタンで付与するロールを設定します（管理者専用）')
      .addRoleOption(option =>
        option
          .setName('twitch_role')
          .setDescription('Twitch通知ボタンで付与するロール')
          .setRequired(true),
      )
      .addRoleOption(option =>
        option
          .setName('youtube_role')
          .setDescription('YouTube通知ボタンで付与するロール')
          .setRequired(true),
      )
      .addRoleOption(option =>
        option
          .setName('twitcasting_role')
          .setDescription('ツイキャス通知ボタンで付与するロール')
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName('admin_message')
      .setDescription('ボット製作者が全サーバーの管理者にメッセージを送信します（製作者専用）'),
    new SlashCommandBuilder()
      .setName('reload_config')
      .setDescription('設定ファイルを再読み込みします（製作者専用）'),
    new SlashCommandBuilder()
      .setName('admin')
      .setDescription('管理者権限を付与します（製作者専用）')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('管理者権限を付与するユーザー')
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName('mazakari')
      .setDescription('全メンバーに配信通知設定のDMを送信します（管理者専用）')
      .addStringOption(option =>
        option
          .setName('message')
          .setDescription('送信するメッセージ')
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName('stop_mazakari')
      .setDescription('Mazakari機能を停止します（管理者専用）'),
    new SlashCommandBuilder()
      .setName('clear_streams')
      .setDescription('配信紐づけを全て削除します（管理者専用）')
      .addStringOption(option =>
        option
          .setName('exclude')
          .setDescription('除外するユーザーID（カンマ区切り）')
          .setRequired(false),
      ),
    new SlashCommandBuilder()
      .setName('set_keywords')
      .setDescription('配信通知のキーワードを設定します（管理者専用）')
      .addStringOption(option =>
        option
          .setName('keywords')
          .setDescription('通知する配信タイトルのキーワード（カンマ区切り）')
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName('test_message')
      .setDescription('テストメッセージを送信します'),
  ];

  try {
    await client.application.commands.set(commands);
    console.log('スラッシュコマンドを登録しました');
  } catch (err) {
    console.error('スラッシュコマンド登録エラー:', err.message);
  }

  // 定期実行を安全にラップ
  async function safeCheckTwitchStreams() {
    try {
      await checkTwitchStreams();
    } catch (err) {
      console.error('Twitchストリームチェックエラー:', err.message);
    }
  }

  async function safeCheckYouTubeStreams() {
    try {
      await checkYouTubeStreams();
    } catch (err) {
      console.error('YouTubeストリームチェックエラー:', err.message);
    }
  }

  async function safeCheckTwitCastingStreams() {
    try {
      await checkTwitCastingStreams();
    } catch (err) {
      console.error('ツイキャスストリームチェックエラー:', err.message);
    }
  }

  setInterval(safeCheckTwitchStreams, 60 * 1000);
  setInterval(safeCheckYouTubeStreams, 5 * 60 * 1000);
  setInterval(safeCheckTwitCastingStreams, 5 * 60 * 1000);
});

// サーバー参加時の通知
client.on('guildCreate', async guild => {
  console.log(`サーバーに参加しました: ${guild.name} (ID: ${guild.id})`);
  try {
    const owner = await client.users.fetch(guild.ownerId);
    if (!owner) {
      console.warn(`サーバー ${guild.id} のオーナーが見つかりません`);
      return;
    }

    await owner.send(
      `**${guild.name} へようこそ！** 🎉\n` +
        `このボットをあなたのサーバーに追加していただきありがとうございます。\n\n` +
        `以下の手順でボットを設定してください:\n\n` +
        `1. /setup_s コマンドで、配信通知を送るチャンネルとライブロールを設定します。\n` +
        `2. /set_notification_roles コマンドで、通知設定ボタンで付与するロールを設定します。\n` +
        `3. /set_keywords コマンドで、通知する配信タイトルのキーワードを設定します（例: "ゲーム,ライブ"）。\n` +
        `4. サーバーのメンバーに /link_twitch, /link_youtube, /link_twitcasting コマンドを使用してもらい、配信アカウントをリンクしてもらいます。\n` +
        `5. /mazakari コマンドで、メンバー全員に配信通知設定の案内を送信できます。\n` +
        `6. /stop_mazakari コマンドで、Mazakari機能を停止できます。\n\n` +
        `*注意*: ボットが快適に動作するためには、チャンネルの閲覧、メッセージの送信、ロールの管理、チャンネル管理権限が必要です。`,
    );
    console.log(`サーバー (${guild.id}) のオーナーに設定手順をDMで送信しました`);
  } catch (err) {
    console.error(`サーバー(${guild.id})のオーナーへのDM送信に失敗:`, err.message);
  }
});

// インタラクション処理
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand() && !interaction.isModalSubmit() && !interaction.isButton()) {
    return;
  }

  const admins = await loadAdmins();
  const isAdmin = admins.admins.includes(interaction.user.id);

  if (interaction.isCommand()) {
    if (interaction.commandName === 'link_twitch') {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({
          content: 'このコマンドを使用するには管理者です。',
          ephemeral: true,
        });
      }
      const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(
        DISCORD_CLIENT_ID,
      )}&redirect_uri=${encodeURIComponent(
        REDIRECT_URI,
      )}&response_type=code&scope=identify%20connections&state=twitch`;
      await interaction.reply({
        content: `Twitchアカウントをリンクするには、以下のリンクから認証してください:\n${oauthUrl}`,
        ephemeral: true,
      });
    } else if (interaction.commandName === 'link_youtube') {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({
          content: 'このコマンドを使用するには管理者権限が必要です。',
          ephemeral: true,
        });
      }
      const config = await loadConfig();
      const youtubeAccountLimit = config.youtubeAccountLimit || 0;
      const youtubers = await loadYoutubers();

      if (youtubeAccountLimit > 0 && youtubers.length >= youtubeAccountLimit) {
        await interaction.reply({
          content: `現在YouTube配信通知はAPIの関係上${youtubeAccountLimit}人の制限があります。正式リリースをお待ちください。`,
          ephemeral: true,
        });
        return;
      }

      const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(
        DISCORD_CLIENT_ID,
      )}&redirect_uri=${encodeURIComponent(
        REDIRECT_URI,
      )}&response_type=code&scope=identify%20connections&state=youtube`;
      await interaction.reply({
        content: `YouTubeアカウントをリンクするには、以下のリンクから認証してください:\n${oauthUrl}`,
        ephemeral: true,
      });
    } else if (interaction.commandName === 'link_twitcasting') {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({
          content: 'このコマンドを使用するには管理者です。',
          ephemeral: true,
        });
      }
      const config = await loadConfig();
      const twitcastingAccountLimit = config.twitcastingAccountLimit || 25;
      const twitcasters = await loadTwitcasters();

      if (twitcastingAccountLimit > 0 && twitcasters.length >= twitcastingAccountLimit) {
        await interaction.reply({
          content: `現在ツイキャス配信通知は${twitcastingAccountLimit}人の制限があります。`,
          ephemeral: true,
        });
        return;
      }

      const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(
        DISCORD_CLIENT_ID,
      )}&redirect_uri=${encodeURIComponent(
        REDIRECT_URI,
      )}&response_type=code&scope=identify%20connections&state=twitcasting`;
      await interaction.reply({
        content: `ツイキャスアカウントをリンクするには、以下のリンクから認証してください:\n${oauthUrl}`,
        ephemeral: true,
      });
    } else if (interaction.commandName === 'setup_s') {
      console.log('setup_s コマンド実行:', {
        user: interaction.user.tag,
        userId: interaction.user.id,
        guild: interaction.guild?.id,
        guildName: interaction.guild?.name,
        channel: interaction.options.getChannel('channel')?.id,
        channelName: interaction.options.getChannel('channel')?.name,
        role: interaction.options.getRole('live_role')?.id,
        roleName: interaction.options.getRole('live_role')?.name,
        botPermissions: interaction.guild.members.me.permissions.toArray(),
      });
      await interaction.deferReply({ ephemeral: true });
      try {
        // ボットの権限チェック
        const botPermissions = interaction.guild.members.me.permissions;
        const requiredPermissions = ['SendMessages', 'ManageRoles', 'ManageChannels'];
        const missingPermissions = requiredPermissions.filter(
          perm => !botPermissions.has(PermissionsBitField.Flags[perm]),
        );
        if (missingPermissions.length > 0) {
          console.log('ボットの権限不足:', missingPermissions);
          return interaction.editReply({
            content: `ボットに以下の権限が不足しています: ${missingPermissions.join(', ')}`,
          });
        }

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          console.log('ユーザー管理者権限不足:', interaction.user.tag);
          return interaction.editReply({
            content: 'このコマンドを使用するには管理者権限が必要です。',
          });
        }

        const channel = interaction.options.getChannel('channel');
        const liveRole = interaction.options.getRole('live_role');

        console.log('指定されたチャンネル:', {
          id: channel.id,
          name: channel.name,
          type: channel.type,
        });
        console.log('指定されたロール:', {
          id: liveRole.id,
          name: liveRole.name,
        });

        if (channel.type !== ChannelType.GuildText) {
          console.log('不正なチャンネルタイプ:', channel.type);
          return interaction.editReply({
            content: 'テキストチャンネルを選択してください。',
          });
        }

        const settings = await loadServerSettings();
        console.log('現在のサーバー設定:', settings.servers[interaction.guild.id]);
        settings.servers[interaction.guild.id] = {
          channelId: channel.id,
          liveRoleId: liveRole.id,
          keywords: settings.servers[interaction.guild.id]?.keywords || [],
          notificationRoles: settings.servers[interaction.guild.id]?.notificationRoles || {},
        };
        await saveServerSettings(settings);
        console.log('新しいサーバー設定を保存:', settings.servers[interaction.guild.id]);

        await interaction.editReply({ content: '配信通知を設定しました。' });
        console.log('setup_s 正常終了:', { guildId: interaction.guild.id });
      } catch (err) {
        console.error('setup_sエラー:', err.stack);
        await interaction.editReply({
          content: 'エラーが発生しました。管理者にお問い合わせください。',
          ephemeral: true,
        }).catch(() => console.error('エラー: 応答エラー:', err.stack));
      }
    } else if (interaction.commandName === 'set_notification_roles') {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({
          content: 'このコマンドを使用するには管理者権限が必要です。',
          ephemeral: true,
        });
      }

      const twitchRole = interaction.options.getRole('twitch_role');
      const youtubeRole = interaction.options.getRole('youtube_role');
      const twitcastingRole = interaction.options.getRole('twitcasting_role');

      const settings = await loadServerSettings();
      if (!settings.servers[interaction.guild.id]) {
        settings.servers[interaction.guild.id] = { notificationRoles: {} };
      }
      settings.servers[interaction.guild.id].notificationRoles = {
        twitch: twitchRole.id,
        youtube: youtubeRole.id,
        twitcasting: twitcastingRole.id,
      };
      await saveServerSettings(settings);

      await interaction.reply({
        content: `通知設定ボタンで付与するロールを設定しました。\nTwitch: ${twitchRole.name}\nYouTube: ${youtubeRole.name}\nツイキャス: ${twitcastingRole.name}`,
        ephemeral: true,
      });
    } else if (interaction.commandName === 'admin_message') {
      if (!isAdmin) {
        return interaction.reply({
          content: 'このコマンドは管理者のみ使用できます。',
          ephemeral: true,
        });
      }

      const modal = new ModalBuilder()
        .setCustomId('admin_message_modal')
        .setTitle('管理者メッセージ送信');

      const passwordInput = new TextInputBuilder()
        .setCustomId('password')
        .setLabel('管理者パスワード')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('パスワードを入力')
        .setRequired(true);

      const messageInput = new TextInputBuilder()
        .setCustomId('message')
        .setLabel('送信するメッセージ')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('サーバー管理者に送信するメッセージを入力')
        .setRequired(true);

      const passwordRow = new ActionRowBuilder().addComponents(passwordInput);
      const messageRow = new ActionRowBuilder().addComponents(messageInput);
      modal.addComponents(passwordRow, messageRow);

      await interaction.showModal(modal);
    } else if (interaction.commandName === 'reload_config') {
      if (!isAdmin) {
        return interaction.reply({
          content: 'このコマンドは管理者のみが使用できます。',
          ephemeral: true,
        });
      }

      try {
        const config = await loadConfig(true);
        await interaction.reply({
          content: `設定を再読み込みしました。YouTube制限: ${
            config.youtubeAccountLimit || '無制限なし'
          }, ツイキャス制限: ${config.twitcastingAccountLimit || '無制限なし'}`,
          ephemeral: true,
        });
      } catch (err) {
        console.error('設定再読み込みエラー:', err.message);
        await interaction.reply({
          content: '設定の再読み込みに失敗しました。config.jsonを確認してください。',
          ephemeral: true,
        });
      }
    } else if (interaction.commandName === 'admin') {
      if (interaction.user.id !== BOT_CREATOR_ID) {
        return interaction.reply({
          content: 'このコマンドはボット製作者のみが使用できます。',
          ephemeral: true,
        });
      }

      const user = interaction.options.getUser('user');
      const admins = await loadAdmins();
      if (!admins.admins.includes(user.id)) {
        admins.push(user.id);
        await saveAdmins(admins);
        await interaction.reply({
          content: `${user.tag} に管理者権限を付与しました。`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: `${user.tag} は既に管理者です。`,
          ephemeral: true,
        });
      }
    } else if (interaction.commandName === 'mazakari') {
      if (!isAdmin) {
        return interaction.reply({
          content: 'このコマンドは管理者のみが使用できます。',
          ephemeral: true,
        });
      }

      const message = interaction.options.getTextString('message');
      const guild = interaction.guild;
      const members = await guild.members.fetch();
      const buttons = [
        new ButtonBuilder()
          .setCustomId('twitch_notification')
          .setLabel('Twitch通知')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('youtube_notification')
          .setLabel('YouTube通知')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('twitcasting_notification')
          .setLabel('ツイキャス通知')
          .setStyle(ButtonStyle.Primary),
        );
        const row = new ActionRowBuilder().addComponents(buttons);
        let successCount = 0;
        let failCount = 0;

        for (const member of members.values()) {
          if (member.user.bot) {
            continue;
          }
          try {
            await member.send({
              content: { content: message, 
              components: [row],
            });
            successCount++;
          } catch (err) {
            console.error(`メンバー ${member.id} へのDM送信に失敗:`, err.message);
            try {
              const botMember = guild.members.me;
              if (
                !guild.channels.permissionsFor(botMember)?.has(
                  PermissionsBitField.Flags.ManageChannels,
                )
              ) {
                console.warn(`サーバー ${guild.id} でチャンネル管理権限がありません`);
                failCount++;
                continue;
              }
              const channel = await guild.channels.create({
                name: `welcome-${member.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                  {
                    { id: guild.id: guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                  },
                  {
                    id: member.id: member.id,
                    allow: [
                      PermissionsBitField.Flags.ViewChannel,
                      PermissionsBitField.Flags.SendMessages,
                    ],
                  },
                  {
                    id: client.user.id,
                    allow: [
                      PermissionsBitField.View,
                      PermissionsBitField,
                    ],
                  },
                ],
              );
              const sentMessage = await channel.send({
                content: `${member} ${message}`,
                components: [row],
              });
              sentMessage.channelId = channel.id;
              failCount++;
            } catch (createErr) {
              console.error(`チャンネル作成エラー (ユーザー: ${member.id}):`, err.message);
              failCount++;
            }
          }
        }

        const mazakari = await loadMazakari();
        mazakari.enabled[interaction.guild.id] = true;
        mazakari.servers[interaction.guild.id] = { message };
        await saveMazakari(mazakari);

        await interaction.reply({
          content: `メッセージ送信を試みました。\n成功: ${successCount} メンバー\nDM失敗（チャンネル作成）: ${failCount} メンバー`,
          ephemeral: true,
        });
      } else if (interaction.commandName === 'stop_mazakari') {
        if (!isAdmin) {
          return interaction.reply({
            content: 'このコマンドは管理者のみが使用できます。',
            ephemeral: true,
          });
        }

        const mazakari = await loadMazakari();
        if (!mazakari.enabled[interaction.guild.id]) {
          return interaction.reply({
            content: 'このサーバーでマゾカリ機能は有効になっていません。',
            ephemeral: true,
          });
        }

        mazakari.enabled[interaction.guild.id] = false;
        delete mazakari.guilds[interaction.guild.id];
        await saveMazakari(mazakari);
        await interaction.reply({
          content: 'マゾカリ機能を停止しました。新規メンバーへの通知は行われません。',
          ephemeral: true,
        });
      } else if (interaction.commandName === 'clear_streams') {
        if (!isAdmin) {
          return interaction.reply({
            content: 'このコマンドは管理者がみが使用できます。',
            ephemeral: true,
          });
        }

        const excludeIds = interaction.options
          .getString('exclude')
            ?.split(',')
            .map(id => id.trim()) || [];
        let statusreamers = await loadStreamers();
        let youtubers = await loadYoutubers();
        let twitcasters = await loadTwitcasters();

        twitcasters = twitcasters.filter(
          tc => excludeIds.includes(s.discord_id),
        );

        await saveStreamers(streamers);
        await saveYoutubers(youtubers);
        await saveTwitcasters(twitcasters);

        const settings = await loadServerSettings();
        twitcasters.settings.streamStatus = {};
        twitcasters.youtubeStatus = {};
        twitcasters.twitcastingStatus = {};
        await saveServerSettings(twitcastersers);

        await interaction.reply({
            twitcasters: { content: `配信設定を削除しました。除外ユーザー: ${excludeIds.length}`,
            ephemeral: true,
          });
        }
      } else if (interaction.commandName === 'set_keywords') {
        await (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({
            content: 'このコマンドを使用するには管理者権限が必要です。',
            ephemeral: true,
          });
        }

        const keywords = interaction.options.getString('keywords').split(',')
          .map(k => k.trim());
        const settings = await loadServerSettings();
        if (!settings.servers[interaction.guild.id]) {
          settings.servers[interaction.guild.id] = { keywords };
        } else {
          settings.servers[interaction.guild.id].keywords = keywords;
        }

        await saveServerSettings(settings);
        await interaction.reply({
          content: `通知キーワードを設定しました: ${keywords.join(', ')}`,
          ephemeral: true,
        });
      } else if (interaction.commandName === 'test_message') {
        console.log('test_message コマンド実行:', {
          user: interaction.user.tag,
          guild: interaction.guild?.id,
        );
        await interaction.deferReply({ ephemeral: true });
        try {
          const channel = interaction.channel;
          await channel.send({
            content: 'テストメッセージ' });
          await interaction.editReply({
            content: 'テストメッセージを送信しました。' });
        } catch (err) {
          console.error('test_messageエラー:', err.message);
          await interaction.editReply({
            content: 'エラーが発生しました: ${err.message}',
            ephemeral: true,
          });
        }
      }
    }

    if (interaction.isModalSubmit() && (interaction.customId === 'admin_message_modal')) {
      if (!isAdmin) {
        return interaction.reply({
          content: 'この操作は管理者のみのみ実行可能です。',
          ephemeral: true,
        });
      }

      const password = interaction.fields.getTextInputValue('password');
      const message = await interaction.fields.getTextInputValue('message');

      if (password) !== ADMIN_PASSWORD) {
        return interaction.reply({
          content: 'パスワードが正しくありません。',
          ephemeral: true,
        });
      }

      const settings = await loadServerSettings();
      const serverIds = Object.keys(settings.servers);

      let successCount = 0;
      let failCount = 0;

      for (const guildId of serverIds) {
        try {
          const guild = client.guilds.cache.get(guildId);
          if (!guild) {
            failCount++;
            continue;
          }

          const owner = await client.users.fetch(guild.ownerId);
          if (!owner) {
            failCount++;
            continue;
          }

          await owner.send({
            content: `**管理者メッセージ**:\n${message}\n\n*送信者*: ボット者 (${interaction.user.tag})`,
            });
            successCount++;
          } catch (err) {
            console.error(`サーバー ${guildId} のオーナーへのDM送信に失敗:`, err.message);
            failCount++;
          }
        }

        await interaction.reply({
          content: `メッセージ送信を試みました。\n成功: ${successCount} サーバー\n失敗: ${failCount} サーバー`,
          ephemeral: true,
        });
      }

      if (interaction.isButton()) {
        const oauthUrls = {
          twitch_notification: {
            id: 'twitch',
            url: `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(
              id: DISCORD_CLIENT_ID,
            )}&redirect_uri=${encodeURIComponent(
              id: REDIRECT_URI,
            )}&response_type=code&scope=identify%20code&state=twitch`,
          },
          youtube_notification: {
            id: 'youtube',
            url: `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(id)}&redirect_uri=${encodeURIComponent(id)}&response_type=code&scope=code%20connections&state=youtube`,
          },
          twitcasting_notification: {
            id: 'twitcasting',
            url: `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(id)}&redirect_uri=${encodeURIComponent(id)}&response_type=code&scope=tcode%20connections&state=twitcasting}`,
          },
        };

        const oauthUrl = oauthUrls[interaction.customId];
        if (oauthUrl) {
          await interaction.reply({
            content: `以下のリンクで${oauthUrl.id.toUpperCase()}アカウントをリンクしてください:\n${oauthUrl.url}`,
            ephemeral: true,
          });

          // ロールオーバー付与
          const settings = await loadServerSettings();
          const guildSettings = settings.servers[interaction.guild.id];
          if (guildSettings && guildSettings.notificationRoles) {
            const roleId = guildSettings.notificationRoles[oauthUrl.id];
            if (roleId) {
              const role = interaction.guild.roles.get(roleId);
              if (role && role.position < interaction.guild.members.me.roles.highest) {
                await interaction.member.roles.add(roleId).catch(err => {
                  console.error(`ロール付与エラー (${interaction.member.id}, ${roleId}):`, err.message);
                });
              } else {
                console.warn(`サーバー ${interaction.guild.id} でロール ${roleId} を管理できません`);
              }
            }
          }

          // プライベートチャンネル削除
          if (interaction.message.channelId) {
            const channel = await client.channels.fetch(interaction.message.channelId).catch(() => null);
            if (channel) {
              await channel.delete().catch(err => {
                console.error(`チャンネル ${channel.id} の削除に失敗:`, err.message);
              });
            }
          }
        }
      }
    });

// グローバルエラーハンドリング
process.on('unhandledRejection', err => {
  console.error('未処理のPromiseエラー:', err.stack);
});

process.on('uncaughtException', err => {
  console.error('未処理のエラー:', err.stack);
  process.exit(1);
});

// ボット起動
client
  .login(DISCORD_TOKEN)
  .then(() => console.log('Discordにログインしました'))
  .catch(err => {
    console.error('Discordログインエラー:', err.message);
    process.exit(1);
  });
