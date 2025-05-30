const { Client, GatewayIntentBits, PermissionsBitField, SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, TextInputBuilder, TextInputStyle, ModalBuilder, ChannelType } = require('discord.js');
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const FormData = require('form-data');
const https = require('https');
require('dotenv').config();

// 環境変数
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const REDIRECT_URI = process.env.REDIRECT_URI;
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const TWITCASTING_CLIENT_ID = process.env.TWITCASTING_CLIENT_ID;
const TWITCASTING_CLIENT_SECRET = process.env.TWITCASTING_CLIENT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BOT_CREATOR_ID = process.env.BOT_CREATOR_ID;

// ファイルパス
const CONFIG_FILE = path.join(__dirname, '../data/config.json');
const STREAMERS_FILE = path.join(__dirname, '../data/streamers.json');
const YOUTUBERS_FILE = path.join(__dirname, '../data/youtubers.json');
const TWITCASTERS_FILE = path.join(__dirname, '../data/twitcasters.json');
const SERVER_SETTINGS_FILE = path.join(__dirname, '../data/serverSettings.json');
const ADMINS_FILE = path.join(__dirname, '../data/admins.json');
const MAZAKARI_FILE = path.join(__dirname, '../data/mazakari.json');
const CREATORS_FILE = path.join(__dirname, '../data/creators.json');

// キャッシュ
let configCache = null;
let streamersCache = null;
let youtubersCache = null;
let twitcastersCache = null;
let serverSettingsCache = null;
let adminsCache = null;
let mazakariCache = null;
let creatorsCache = null;

// Discordクライアント
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

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
    console.warn('config.jsonが見つからないか無効です。デフォルトを使用します:', err.message);
    configCache = { youtubeAccountLimit: 0, twitcastingAccountLimit: 25 };
    return configCache;
  }
}

// 配信者リストの読み込み
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
    console.warn('streamers.jsonが見つからないか無効です。空のリストを使用します:', err.message);
    streamersCache = [];
    return streamersCache;
  }
}

// YouTube配信者リストの読み込み
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
    console.warn('youtubers.jsonが見つからないか無効です。空のリストを使用します:', err.message);
    youtubersCache = [];
    return youtubersCache;
  }
}

// ツイキャス配信者リストの読み込み
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
    console.warn('twitcasters.jsonが見つからないか無効です。空のリストを使用します:', err.message);
    twitcastersCache = [];
    return twitcastersCache;
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
    console.log('serverSettings.json読み込み成功');
    return serverSettingsCache;
  } catch (err) {
    console.warn('serverSettings.jsonが見つからないか無効です。デフォルトを使用します:', err.message);
    serverSettingsCache = { servers: {} };
    return serverSettingsCache;
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

// 製作者リストの読み込み
async function loadCreators(force = false) {
  if (!force && creatorsCache) {
    console.log('creatorsキャッシュを使用');
    return creatorsCache;
  }
  try {
    console.log('creators.jsonを読み込み中:', CREATORS_FILE);
    const data = await fs.readFile(CREATORS_FILE, 'utf8');
    const parsedData = JSON.parse(data);
    if (!parsedData.creators || !Array.isArray(parsedData.creators)) {
      console.warn('creators.jsonにcreators配列がありません。デフォルトを設定します。');
      creatorsCache = { creators: [BOT_CREATOR_ID] };
      await saveCreators(creatorsCache);
    } else {
      creatorsCache = parsedData;
    }
    console.log('creators.json読み込み成功');
    return creatorsCache;
  } catch (err) {
    console.warn('creators.jsonが見つからないか無効です。デフォルトを使用します:', err.message);
    creatorsCache = { creators: [BOT_CREATOR_ID] };
    await saveCreators(creatorsCache);
    return creatorsCache;
  }
}

// 製作者リストの保存
async function saveCreators(creators) {
  try {
    console.log('creators.jsonを保存中:', CREATORS_FILE);
    creatorsCache = creators && Array.isArray(creators.creators) ? creators : { creators: [BOT_CREATOR_ID] };
    await fs.writeFile(CREATORS_FILE, JSON.stringify(creatorsCache, null, 2));
    console.log('creators.json保存成功');
  } catch (err) {
    console.error('製作者リスト保存エラー:', err.message);
    throw err;
  }
}

// Expressサーバーの設定
const app = express();
async function startServer() {
  const options = {
    key: await fs.readFile('/etc/letsencrypt/live/zaronyanbot.com/privkey.pem'),
    cert: await fs.readFile('/etc/letsencrypt/live/zaronyanbot.com/fullchain.pem'),
  };
  https.createServer(options, app).listen(3000, () => {
    console.log('✅ HTTPSサーバーがポート3000で起動しました');
  });

  app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).send('認証コードまたは状態がありません。');
    }

    try {
      const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const accessToken = tokenResponse.data.access_token;
      const userResponse = await axios.get('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const userId = userResponse.data.id;

      if (state === 'twitch') {
        const connectionsResponse = await axios.get('https://discord.com/api/users/@me/connections', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const twitchConnection = connectionsResponse.data.find(conn => conn.type === 'twitch');
        if (!twitchConnection) {
          return res.status(400).send('Twitchアカウントが接続されていません。');
        }
        const twitchId = twitchConnection.id;
        const twitchUsername = twitchConnection.name;

        const streamers = await loadStreamers();
        if (!streamers.some(s => s.twitchId === twitchId)) {
          streamers.push({ discordId: userId, twitchId, twitchUsername });
          await fs.writeFile(STREAMERS_FILE, JSON.stringify(streamers, null, 2));
          console.log(`Twitchアカウントをリンク: ${twitchUsername} (ID: ${twitchId})`);
        }
        res.send('Twitchアカウントが正常にリンクされました！');
      } else if (state === 'youtube') {
        const config = await loadConfig();
        const youtubeAccountLimit = config.youtubeAccountLimit || 0;
        const youtubers = await loadYoutubers();

        if (youtubeAccountLimit > 0 && youtubers.length >= youtubeAccountLimit) {
          return res.status(400).send(`YouTubeアカウント登録数が上限（${youtubeAccountLimit}）に達しています。`);
        }

        const connectionsResponse = await axios.get('https://discord.com/api/users/@me/connections', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const youtubeConnection = connectionsResponse.data.find(conn => conn.type === 'youtube');
        if (!youtubeConnection) {
          return res.status(400).send('YouTubeアカウントが接続されていません。');
        }
        const youtubeId = youtubeConnection.id;
        const youtubeUsername = youtubeConnection.name;

        if (!youtubers.some(y => y.youtubeId === youtubeId)) {
          youtubers.push({ discordId: userId, youtubeId, youtubeUsername });
          await fs.writeFile(YOUTUBERS_FILE, JSON.stringify(youtubers, null, 2));
          console.log(`YouTubeアカウントをリンク: ${youtubeUsername} (ID: ${youtubeId})`);
        }
        res.send('YouTubeアカウントが正常にリンクされました！');
      } else if (state === 'twitcasting') {
        const config = await loadConfig();
        const twitcastingAccountLimit = config.twitcastingAccountLimit || 25;
        const twitcasters = await loadTwitcasters();

        if (twitcastingAccountLimit > 0 && twitcasters.length >= twitcastingAccountLimit) {
          return res.status(400).send(`ツイキャスアカウント登録数が上限（${twitcastingAccountLimit}）に達しています。`);
        }

        const twitcastingResponse = await axios.get('https://api.twitcasting.tv/users/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const twitcastingId = twitcastingResponse.data.id;
        const twitcastingUsername = twitcastingResponse.data.name;

        if (!twitcasters.some(t => t.twitcastingId === twitcastingId)) {
          twitcasters.push({ discordId: userId, twitcastingId, twitcastingUsername });
          await fs.writeFile(TWITCASTERS_FILE, JSON.stringify(twitcasters, null, 2));
          console.log(`ツイキャスアカウントをリンク: ${twitcastingUsername} (ID: ${twitcastingId})`);
        }
        res.send('ツイキャスアカウントが正常にリンクされました！');
      } else {
        res.status(400).send('無効な状態パラメータです。');
      }
    } catch (err) {
      console.error('OAuthコールバックエラー:', err.message);
      res.status(500).send('認証中にエラーが発生しました。');
    }
  });
}

// ボット起動時の処理
client.once('ready', async () => {
  console.log('✅ ボットがオンラインになりました！');

  // スラッシュコマンドの登録
  const commands = [
    new SlashCommandBuilder()
      .setName('link_twitch')
      .setDescription('Twitchアカウントをリンクします'),
    new SlashCommandBuilder()
      .setName('link_youtube')
      .setDescription('YouTubeアカウントをリンクします'),
    new SlashCommandBuilder()
      .setName('link_twitcasting')
      .setDescription('ツイキャスアカウントをリンクします'),
    new SlashCommandBuilder()
      .setName('setup_s')
      .setDescription('配信通知の設定を行います')
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
      .setDescription('通知設定ボタンで付与するロールを設定します')
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
      .setDescription('全サーバーの管理者にメッセージを送信します（管理者専用）'),
    new SlashCommandBuilder()
      .setName('reload_config')
      .setDescription('設定ファイルを再読み込みします（管理者専用）'),
    new SlashCommandBuilder()
      .setName('admin')
      .setDescription('ユーザーにボット製作者権限を付与します（製作者専用）')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('管理者権限を付与するユーザー')
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName('mazakari')
      .setDescription('全メンバーに配信通知設定のDMを送信します（製作者専用）')
      .addStringOption(option =>
        option
          .setName('message')
          .setDescription('送信するメッセージ')
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName('stop_mazakari')
      .setDescription('Mazakari機能を停止します（製作者専用）'),
    new SlashCommandBuilder()
      .setName('clear_streams')
      .setDescription('すべての配信設定を削除します（管理者専用）')
      .addStringOption(option =>
        option
          .setName('exclude')
          .setDescription('除外するユーザーID（カンマ区切り）')
          .setRequired(false),
      ),
    new SlashCommandBuilder()
      .setName('set_keywords')
      .setDescription('配信通知のキーワードを設定します')
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

  // 設定ファイルの初期化確認
  try {
    await loadServerSettings(true);
    console.log('serverSettings.jsonを正常に読み込みました');
    await loadCreators(true);
    console.log('creators.jsonを正常に読み込みました');
  } catch (err) {
    console.error('設定ファイル初期化エラー:', err.message);
  }

  // HTTPSサーバーの起動
  try {
    await startServer();
  } catch (err) {
    console.error('サーバー起動エラー:', err.message);
  }
});

// インタラクション処理
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand() && !interaction.isModalSubmit() && !interaction.isButton()) {
    return;
  }

  try {
    const admins = await loadAdmins();
    const isAdmin = admins?.admins?.includes(interaction.user.id) || false;
    const creators = await loadCreators();

    if (interaction.isCommand()) {
      if (interaction.commandName === 'link_twitch') {
        const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(
          DISCORD_CLIENT_ID,
        )}&redirect_uri=${encodeURIComponent(
          REDIRECT_URI,
        )}&response_type=code&scope=identify%20connections&state=twitch`;
        await interaction.reply({
          content: `Twitchアカウントをリンクするには、以下のリンクから認証してください:\n${oauthUrl}`,
          ephemeral: false,
        });
      } else if (interaction.commandName === 'link_youtube') {
        const config = await loadConfig();
        const youtubeAccountLimit = config.youtubeAccountLimit || 0;
        const youtubers = await loadYoutubers();

        if (youtubeAccountLimit > 0 && youtubers.length >= youtubeAccountLimit) {
          await interaction.reply({
            content: `現在YouTube配信通知はAPIの関係で${youtubeAccountLimit}人の制限があります。正式リリースをお待ちください。`,
            ephemeral: false,
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
          ephemeral: false,
        });
      } else if (interaction.commandName === 'link_twitcasting') {
        const config = await loadConfig();
        const twitcastingAccountLimit = config.twitcastingAccountLimit || 25;
        const twitcasters = await loadTwitcasters();

        if (twitcastingAccountLimit > 0 && twitcasters.length >= twitcastingAccountLimit) {
          await interaction.reply({
            content: `現在ツイキャス配信通知には${twitcastingAccountLimit}人の制限があります。`,
            ephemeral: false,
          });
          return;
        }

        const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(
          DISCORD_CLIENT_ID,
        )}&redirect_uri=${encodeURIComponent(
          REDIRECT_URI,
        )}&response_type=code&scope=twitcasting&state=twitcasting`;
        await interaction.reply({
          content: `ツイキャスアカウントをリンクするには、以下のリンクから認証してください:\n${oauthUrl}`,
          ephemeral: false,
        });
      } else if (interaction.commandName === 'setup_s') {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({
            content: 'このコマンドを使用するには管理者権限が必要です。',
            ephemeral: true,
          });
        }

        const channel = interaction.options.getChannel('channel');
        const liveRole = interaction.options.getRole('live_role');
        const serverSettings = await loadServerSettings();
        serverSettings.servers[interaction.guild.id] = {
          channelId: channel.id,
          liveRoleId: liveRole.id,
          notificationRoles: serverSettings.servers[interaction.guild.id]?.notificationRoles || {},
          keywords: serverSettings.servers[interaction.guild.id]?.keywords || [],
        };
        await fs.writeFile(SERVER_SETTINGS_FILE, JSON.stringify(serverSettings, null, 2));
        await interaction.reply({
          content: `配信通知設定を保存しました。\nチャンネル: ${channel}\nライブロール: ${liveRole}`,
          ephemeral: true,
        });
      } else if (interaction.commandName === 'set_notification_roles') {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({
            content: 'このコマンドを使用するには管理者権限が必要です。',
            ephemeral: true,
          });
        }

        const twitchRole = interaction.options.getRole('twitch_role');
        const youtubeRole = interaction.options.getRole('youtube_role');
        const twitcastingRole = interaction.options.getRole('twitcasting_role');
        const serverSettings = await loadServerSettings();
        serverSettings.servers[interaction.guild.id] = {
          ...serverSettings.servers[interaction.guild.id],
          notificationRoles: {
            twitch: twitchRole.id,
            youtube: youtubeRole.id,
            twitcasting: twitcastingRole.id,
          },
        };
        await fs.writeFile(SERVER_SETTINGS_FILE, JSON.stringify(serverSettings, null, 2));
        await interaction.reply({
          content: `通知ロールを設定しました。\nTwitch: ${twitchRole}\nYouTube: ${youtubeRole}\nツイキャス: ${twitcastingRole}`,
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
        const row1 = new ActionRowBuilder().addComponents(passwordInput);
        const row2 = new ActionRowBuilder().addComponents(messageInput);
        modal.addComponents(row1, row2);
        await interaction.showModal(modal);
      } else if (interaction.commandName === 'reload_config') {
        if (!isAdmin) {
          return interaction.reply({
            content: 'このコマンドは管理者のみ使用可能です。',
            ephemeral: true,
          });
        }

        await loadConfig(true);
        await loadStreamers(true);
        await loadYoutubers(true);
        await loadTwitcasters(true);
        await loadServerSettings(true);
        await loadAdmins(true);
        await loadMazakari(true);
        await loadCreators(true);
        await interaction.reply({
          content: '設定ファイルを再読み込みしました。',
          ephemeral: true,
        });
      } else if (interaction.commandName === 'admin') {
        if (!creators.creators.includes(interaction.user.id)) {
          return interaction.reply({
            content: 'このコマンドはボット製作者のみ使用可能です。',
            ephemeral: true,
          });
        }

        const user = interaction.options.getUser('user');
        if (!creators.creators.includes(user.id)) {
          creators.creators.push(user.id);
          await saveCreators(creators);
          await interaction.reply({
            content: `${user.tag} にボット製作者権限を付与しました。`,
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: `${user.tag} はすでにボット製作者権限を持っています。`,
            ephemeral: true,
          });
        }
      } else if (interaction.commandName === 'mazakari') {
        if (!creators.creators.includes(interaction.user.id)) {
          return interaction.reply({
            content: 'このコマンドはボット製作者のみ使用可能です。',
            ephemeral: true,
          });
        }

        const message = interaction.options.getString('message');
        const guild = interaction.guild;
        const members = await guild.members.fetch();
        const buttons = [
          new ButtonBuilder()
            .setCustomId(`twitch_notification_${guild.id}`)
            .setLabel('Twitch通知')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`youtube_notification_${guild.id}`)
            .setLabel('YouTube通知')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`twitcasting_notification_${guild.id}`)
            .setLabel('TwitCasting通知')
            .setStyle(ButtonStyle.Primary),
        ];
        const row = new ActionRowBuilder().addComponents(buttons);
        let successCount = 0;
        let failCount = 0;

        for (const member of members.values()) {
          if (member.user.bot) continue;
          try {
            await member.send({ content: message, components: [row] });
            successCount++;
          } catch (err) {
            console.error(`メンバー ${member.id} へのDM失敗:`, err.message);
            try {
              const botMember = guild.members.me;
              if (!guild.channels.cache.some(channel => 
                channel.permissionsFor(botMember)?.has(PermissionsBitField.Flags.ManageChannels))) {
                failCount++;
                continue;
              }
              const channel = await guild.channels.create({
                name: `welcome-${member.user.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                  { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
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
              successCount++;
            } catch (createErr) {
              console.error(`チャンネル作成エラー (ユーザー: ${member.id}):`, createErr.message);
              failCount++;
            }
          }
        }

        const mazakari = await loadMazakari();
        mazakari.enabled[interaction.guild.id] = true;
        mazakari.guilds[interaction.guild.id] = { message };
        await fs.writeFile(MAZAKARI_FILE, JSON.stringify(mazakari, null, 2));
        await interaction.reply({
          content: `メッセージ送信を試みました。\n成功: ${successCount} メンバー\nDM失敗（チャンネル作成）: ${failCount} メンバー`,
          ephemeral: true,
        });
      } else if (interaction.commandName === 'stop_mazakari') {
        if (!creators.creators.includes(interaction.user.id)) {
          return interaction.reply({
            content: 'このコマンドはボット製作者のみ使用可能です。',
            ephemeral: true,
          });
        }

        const mazakari = await loadMazakari();
        if (!mazakari.enabled[interaction.guild.id]) {
          return interaction.reply({
            content: 'このサーバーでMazakari機能は有効になっていません。',
            ephemeral: true,
          });
        }

        mazakari.enabled[interaction.guild.id] = false;
        delete mazakari.guilds[interaction.guild.id];
        await fs.writeFile(MAZAKARI_FILE, JSON.stringify(mazakari, null, 2));
        await interaction.reply({
          content: 'Mazakari機能を停止しました。新規メンバーへの通知は行われません。',
          ephemeral: true,
        });
      } else if (interaction.commandName === 'clear_streams') {
        if (!isAdmin) {
          return interaction.reply({
            content: 'このコマンドは管理者のみ使用できます。',
            ephemeral: true,
          });
        }

        const exclude = interaction.options.getString('exclude')?.split(',').map(id => id.trim()) || [];
        let streamers = await loadStreamers();
        let youtubers = await loadYoutubers();
        let twitcasters = await loadTwitcasters();

        streamers = streamers.filter(s => exclude.includes(s.discordId));
        youtubers = youtubers.filter(y => exclude.includes(y.discordId));
        twitcasters = twitcasters.filter(t => exclude.includes(t.discordId));

        await fs.writeFile(STREAMERS_FILE, JSON.stringify(streamers, null, 2));
        await fs.writeFile(YOUTUBERS_FILE, JSON.stringify(youtubers, null, 2));
        await fs.writeFile(TWITCASTERS_FILE, JSON.stringify(twitcasters, null, 2));
        await interaction.reply({
          content: `配信設定を削除しました。除外ユーザー: ${exclude.length > 0 ? exclude.join(', ') : 'なし'}`,
          ephemeral: true,
        });
      } else if (interaction.commandName === 'set_keywords') {
        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({
            content: 'このコマンドを使用するには管理者権限が必要です。',
            ephemeral: true,
          });
        }

        const keywords = interaction.options.getString('keywords').split(',').map(k => k.trim());
        const serverSettings = await loadServerSettings();
        serverSettings.servers[interaction.guild.id] = {
          ...serverSettings.servers[interaction.guild.id],
          keywords,
        };
        await fs.writeFile(SERVER_SETTINGS_FILE, JSON.stringify(serverSettings, null, 2));
        await interaction.reply({
          content: `キーワードを設定しました: ${keywords.join(', ')}`,
          ephemeral: true,
        });
      } else if (interaction.commandName === 'test_message') {
        await interaction.reply({
          content: 'テストメッセージ',
          ephemeral: false,
        });
      }
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId === 'admin_message_modal') {
        if (!isAdmin) {
          return interaction.reply({
            content: 'このコマンドは管理者のみ使用できます。',
            ephemeral: true,
          });
        }

        const password = interaction.fields.getTextInputValue('password');
        const message = interaction.fields.getTextInputValue('message');

        if (password !== ADMIN_PASSWORD) {
          return interaction.reply({
            content: 'パスワードが正しくありません。',
            ephemeral: true,
          });
        }

        const guilds = client.guilds.cache;
        let successCount = 0;
        let failCount = 0;

        for (const guild of guilds.values()) {
          const owner = await guild.fetchOwner();
          try {
            await owner.send(`[管理者メッセージ]\n${message}`);
            successCount++;
          } catch (err) {
            console.error(`サーバー ${guild.id} のオーナーへの送信失敗:`, err.message);
            failCount++;
          }
        }

        await interaction.reply({
          content: `メッセージ送信を試みました。\n成功: ${successCount} サーバー\n失敗: ${failCount} サーバー`,
          ephemeral: true,
        });
      }
    
    } else if (interaction.isButton()) {
      const [type, guildId] = interaction.customId.split('_notification_');
      const oauthUrls = {
        twitch: `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(DISCORD_CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20connections&state=twitch`,
        youtube: `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(DISCORD_CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20connections&state=youtube`,
        twitcasting: `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(DISCORD_CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20connections&state=twitcasting`,
      };
      const oauthUrl = oauthUrls[type];
      if (!oauthUrl) return;
      await interaction.reply({ content: `以下のリンクで${type.toUpperCase()}アカウントをリンクしてください:\n${oauthUrl}`, ephemeral: true });
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return;
      const settings = await loadServerSettings();
      const guildSettings = settings.servers[guildId];
      const roleId = guildSettings?.notificationRoles?.[type];
      if (!roleId) return;
      const member = await guild.members.fetch(interaction.user.id).catch(() => null);
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (role && member && role.position < guild.members.me.roles.highest.position) {
        await member.roles.add(roleId).catch(err => console.error(`ロール付与エラー (${member.id}, ${roleId}):`, err.message));
      }
     else if (interaction.isButton()) {
      const oauthUrls = {
        twitch_notification: {
          id: 'twitch',
          url: `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(
            DISCORD_CLIENT_ID
          )}&redirect_uri=${encodeURIComponent(
            REDIRECT_URI
          )}&response_type=code&scope=identify%20connections&state=twitch`,
        },
        youtube_notification: {
          id: 'youtube',
          url: `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(
            DISCORD_CLIENT_ID
          )}&redirect_uri=${encodeURIComponent(
            REDIRECT_URI
          )}&response_type=code&scope=identify%20connections&state=youtube`,
        },
        twitcasting_notification: {
          id: 'twitcasting',
          url: `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(
            DISCORD_CLIENT_ID,
          )}&redirect_uri=${encodeURIComponent(
            REDIRECT_URI,
          )}&response_type=code&scope=identify%20connections&state=twitcasting`,
        },
      };

      const oauth = oauthUrls[interaction.customId];
      if (oauth) {
        await interaction.reply({
          content: `以下のリンクで${oauth.id.toUpperCase()}アカウントをリンクしてください:\n${oauth.url}`,
          ephemeral: false,
        });

        // ロール付与
        const settings = await loadServerSettings();
        const guildSettings = settings.servers[interaction.guild.id];
        if (guildSettings && guildSettings.notificationRoles) {
          const roleId = guildSettings.notificationRoles[oauth.id];
          if (roleId) {
            const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
            if (role && role.position < interaction.guild.members.me.roles.highest.position) {
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
  } catch (err) {
    console.error('インタラクション処理エラー:', {
      command: interaction.commandName || interaction.customId,
      user: interaction.user.tag,
      userId: interaction.user.id,
      error: err.message,
      stack: err.stack,
    });
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: 'エラーが発生しました。後ほど再試行してください。', ephemeral: false }).catch(() => {});
    } else {
      await interaction.reply({ content: 'エラーが発生しました。後ほど再試行してください。', ephemeral: false }).catch(() => {});
    }
  }
});

// ボットログイン
client.login(DISCORD_TOKEN).catch(err => {
  console.error('ボットログインエラー:', err.message);
});
