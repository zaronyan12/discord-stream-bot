// 必要なモジュールをインポート
require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ChannelType, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const express = require('express');
const https = require('https');
const fs = require('fs').promises;
const path = require('path');

// 環境変数から必要な値を読み込む
const {
    DISCORD_TOKEN,
    TWITCH_CLIENT_ID,
    TWITCH_CLIENT_SECRET,
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    YOUTUBE_API_KEY,
    TWITCASTING_API_KEY,
    ADMIN_PASSWORD,
    BOT_CREATOR_ID,
    REDIRECT_URI = 'https://zaronyanbot.com:3000/callback',
} = process.env;

// 環境変数が設定されているか確認
const requiredEnvVars = ['DISCORD_TOKEN', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'YOUTUBE_API_KEY', 'TWITCASTING_API_KEY', 'ADMIN_PASSWORD', 'BOT_CREATOR_ID'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`エラー: 環境変数 ${envVar} が設定されていません。`);
        process.exit(1);
    }
}

// ファイルパスを定義
const CONFIG_FILE = path.join(__dirname, 'config.json');
const STREAMERS_FILE = path.join(__dirname, 'data/streamers.json');
const YOUTUBERS_FILE = path.join(__dirname, 'data/youtubers.json');
const TWITCASTERS_FILE = path.join(__dirname, 'data/twitcasters.json');
const SERVER_SETTINGS_FILE = path.join(__dirname, 'data/serverSettings.json');
const ADMINS_FILE = path.join(__dirname, 'data/admins.json');
const MAZAKARI_FILE = path.join(__dirname, 'data/mazakari.json');

// キャッシュオブジェクトを初期化
let configCache = null;
let streamersCache = null;
let youtubersCache = null;
let twitcastersCache = null;
let serverSettingsCache = null;
let adminsCache = null;
let mazakariCache = null;

// 設定ファイルを読み込む
async function loadConfig(force = false) {
    if (!force && configCache) return configCache;
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf8');
        configCache = JSON.parse(data);
        return configCache;
    } catch (err) {
        console.warn('config.jsonが見つからないか無効です。デフォルト設定を使用します。');
        configCache = { youtubeAccountLimit: 0, twitcastingAccountLimit: 25 };
        return configCache;
    }
}

// ストリーマーデータを読み込む
async function loadStreamers(force = false) {
    if (!force && streamersCache) return streamersCache;
    try {
        const data = await fs.readFile(STREAMERS_FILE, 'utf8');
        streamersCache = JSON.parse(data);
        return streamersCache;
    } catch (err) {
        streamersCache = [];
        return streamersCache;
    }
}

// ストリーマーデータを保存
async function saveStreamers(streamers) {
    try {
        streamersCache = streamers;
        await fs.writeFile(STREAMERS_FILE, JSON.stringify(streamers, null, 2));
    } catch (err) {
        console.error('ストリーマーデータ保存エラー:', err.message);
        throw err;
    }
}

// YouTube配信者データを読み込む
async function loadYoutubers(force = false) {
    if (!force && youtubersCache) return youtubersCache;
    try {
        const data = await fs.readFile(YOUTUBERS_FILE, 'utf8');
        youtubersCache = JSON.parse(data);
        return youtubersCache;
    } catch (_) {
        youtubersCache = [];
        return youtubersCache;
    }
}

// YouTube配信者データを保存
async function saveYoutubers(youtubers) {
    try {
        youtubersCache = youtubers;
        await fs.writeFile(YOUTUBERS_FILE, JSON.stringify(youtubers, null, 2));
    } catch (err) {
        console.error('YouTube配信者データ保存エラー:', err.message);
        throw err;
    }
}

// ツイキャス配信者データを読み込む
async function loadTwitcasters(force = false) {
    if (!force && twitcastersCache) return twitcastersCache;
    try {
        const data = await fs.readFile(TWITCASTERS_FILE, 'utf8');
        twitcastersCache = JSON.parse(data);
        return twitcastersCache;
    } catch (_) {
        twitcastersCache = [];
        return twitcastersCache;
    }
}

// ツイキャス配信者データを保存
async function saveTwitcasters(twitcasters) {
    try {
        twitcastersCache = twitcasters;
        await fs.writeFile(TWITCASTERS_FILE, JSON.stringify(twitcasters, null, 2));
    } catch (err) {
        console.error('ツイキャス配信者データ保存エラー:', err.message);
        throw err;
    }
}

// サーバー設定を読み込む
async function loadServerSettings(force = false) {
    if (!force && serverSettingsCache) return serverSettingsCache;
    try {
        const data = await fs.readFile(SERVER_SETTINGS_FILE, 'utf8');
        serverSettingsCache = JSON.parse(data);
        if (!serverSettingsCache.streamStatus) serverSettingsCache.streamStatus = {};
        if (!serverSettingsCache.youtubeStatus) serverSettingsCache.youtubeStatus = {};
        if (!serverSettingsCache.twitcastingStatus) serverSettingsCache.twitcastingStatus = {};
        if (!serverSettingsCache.keywords) serverSettingsCache.keywords = {};
        if (!serverSettingsCache.notificationRoles) serverSettingsCache.notificationRoles = {};
        return serverSettingsCache;
    } catch (err) {
        serverSettingsCache = { servers: {}, streamStatus: {}, youtubeStatus: {}, twitcastingStatus: {}, keywords: {}, notificationRoles: {} };
        return serverSettingsCache;
    }
}

// サーバー設定を保存
async function saveServerSettings(settings) {
    try {
        serverSettingsCache = settings;
        await fs.writeFile(SERVER_SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (err) {
        console.error('サーバー設定保存エラー:', err.message);
        throw err;
    }
}

// 管理者リストを読み込む
async function loadAdmins(force = false) {
    if (!force && adminsCache) return adminsCache;
    try {
        const data = await fs.readFile(ADMINS_FILE, 'utf8');
        adminsCache = JSON.parse(data);
        return adminsCache;
    } catch (err) {
        adminsCache = { admins: [BOT_CREATOR_ID] };
        return adminsCache;
    }
}

// 管理者リストを保存
async function saveAdmins(admins) {
    try {
        adminsCache = admins;
        await fs.writeFile(ADMINS_FILE, JSON.stringify(admins, null, 2));
    } catch (err) {
        console.error('管理者リスト保存エラー:', err.message);
        throw err;
    }
}

// Mazakari設定を読み込む
async function loadMazakari(force = false) {
    if (!force && mazakariCache) return mazakariCache;
    try {
        const data = await fs.readFile(MAZAKARI_FILE, 'utf8');
        mazakariCache = JSON.parse(data);
        return mazakariCache;
    } catch (err) {
        mazakariCache = { enabled: {}, guilds: {} };
        return mazakariCache;
    }
}

// Mazakari設定を保存
async function saveMazakari(mazakari) {
    try {
        mazakariCache = mazakari;
        await fs.writeFile(MAZAKARI_FILE, JSON.stringify(mazakari, null, 2));
    } catch (err) {
        console.error('Mazakari設定保存エラー:', err.message);
        throw err;
    }
}

// Twitch APIトークンを取得（キャッシュ活用）
let twitchTokenCache = null;
let twitchTokenExpiry = 0;
async function getTwitchToken() {
    if (twitchTokenCache && Date.now() < twitchTokenExpiry) return twitchTokenCache;
    try {
        const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: TWITCH_CLIENT_ID,
                client_secret: TWITCH_CLIENT_SECRET,
                grant_type: 'client_credentials',
            },
        });
        twitchTokenCache = response.data.access_token;
        twitchTokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
        return twitchTokenCache;
    } catch (err) {
        console.error('Twitchトークン取得エラー:', err.response?.data || err.message);
        return null;
    }
}

// Discord OAuthで接続情報を取得
async function getConnections(accessToken) {
    let response = null;
    try {
        response = await axios.get('https://discord.com/api/v10/users/@me/connections', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const connections = { twitch_username: '', youtube_channel_id: '', twitcasting_user_id: '' };
        for (const conn of response.data) {
            if (conn.type === 'twitch') connections.twitch_username = conn.name;
            if (conn.type === 'youtube') connections.youtube_channel_id = conn.id;
            if (conn.type === 'twitcasting') connections.twitcasting_user_id = conn.id;
        }
        return connections;
    } catch (err) {
        console.error('接続情報取得エラー:', err.response?.data || err.message);
        return { twitch_username: '', youtube_channel_id: '', twitcasting_user_id: '' };
    } finally {
        response = null;
    }
}

// Twitchストリームの状態をチェック
async function checkTwitchStreams() {
    const streamers = await loadStreamers();
    if (!streamers.length) return;

    const token = await getTwitchToken();
    if (!token) return;

    const settings = await loadServerSettings();
    const currentStatus = {};

    const chunkSize = 100;
    for (let i = 0; i < streamers.length; i += chunkSize) {
        const chunk = streamers.slice(i, i + chunkSize);
        const query = chunk.map(s => `user_login=${s.username}`).join('&');
        let response = null;
        try {
            response = await axios.get(`https://api.twitch.tv/helix/streams?${query}`, {
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
                        if (keywords.length && !keywords.some(keyword => streamTitle.toLowerCase().includes(keyword.toLowerCase()))) continue;

                        const channel = client.channels.cache.get(guildSettings.channelId);
                        if (!channel) continue;

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
        } finally {
            response = null;
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
                    if (!role || role.position >= botMember.roles.highest.position) continue;
                    await member.roles.remove(guildSettings.liveRoleId);
                }
            }
        }
    }

    if (Object.keys(currentStatus).length || Object.keys(settings.streamStatus).length) {
        await saveServerSettings(settings);
    }
}

// YouTubeライブ配信の状態をチェック
async function checkYouTubeStreams() {
    let youtubers = await loadYoutubers();
    if (!youtubers.length) return;

    const config = await loadConfig();
    const youtubeAccountLimit = config.youtubeAccountLimit || 0;

    if (youtubeAccountLimit > 0) {
        youtubers = youtubers.slice(0, youtubeAccountLimit);
    }

    const settings = await loadServerSettings();
    const currentStatus = {};

    const channelIds = youtubers.map(yt => yt.channel_id).join(',');
    let response = null;
    try {
        response = await axios.get(
            `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&id=${channelIds}&key=${YOUTUBE_API_KEY}`
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
            let searchResponse = null;
            try {
                searchResponse = await axios.get(
                    `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${YOUTUBE_API_KEY}`
                );

                if (searchResponse.data.items.length > 0) {
                    const videoId = searchResponse.data.items[0].id.videoId;
                    const channelName = searchResponse.data.items[0].snippet.channelTitle;
                    const streamTitle = searchResponse.data.items[0].snippet.title;
                    const youtuber = youtubers.find(yt => yt.channel_id === channelId);

                    if (!settings.youtubeStatus[channelId]) {
                        for (const [guildId, guildSettings] of Object.entries(settings.servers)) {
                            const keywords = guildSettings.keywords || [];
                            if (keywords.length && !keywords.some(keyword => streamTitle.toLowerCase().includes(keyword.toLowerCase()))) continue;

                            const channel = client.channels.cache.get(guildSettings.channelId);
                            if (!channel) continue;

                            const botMember = channel.guild.members.me;
                            if (!channel.permissionsFor(botMember)?.has(PermissionsBitField.Flags.SendMessages)) {
                                console.warn(`チャンネル ${channel.id} (サーバー: ${guildId}) でメッセージ送信権限がありません`);
                                continue;
                            }

                            await channel.send(`${channelName} is live on YouTube!\nhttps://youtube.com/watch?v=${videoId}`);
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
            } finally {
                searchResponse = null;
            }
        }
    } catch (err) {
        console.error('YouTubeチャンネルチェックエラー:', err.response?.data || err.message);
    } finally {
        response = null;
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
                    if (!role || role.position >= botMember.roles.highest.position) continue;
                    await member.roles.remove(guildSettings.liveRoleId);
                }
            }
        }
    }

    if (Object.keys(currentStatus).length || Object.keys(settings.youtubeStatus).length) {
        await saveServerSettings(settings);
    }
}

// ツイキャス配信の状態をチェック
async function checkTwitCastingStreams() {
    const twitcasters = await loadTwitcasters();
    if (!twitcasters.length) return;

    const config = await loadConfig();
    const twitcastingAccountLimit = config.twitcastingAccountLimit || 25;
    const limitedTwitcasters = twitcasters.slice(0, twitcastingAccountLimit);

    const settings = await loadServerSettings();
    const currentStatus = {};

    for (const twitcaster of limitedTwitcasters) {
        let response = null;
        try {
            response = await axios.get(`https://api.twitcasting.tv/api/livestatus?user_id=${twitcaster.user_id}`, {
                headers: { Authorization: `Bearer ${TWITCASTING_API_KEY}` },
            });

            const isLive = response.data.is_live;
            currentStatus[twitcaster.user_id] = isLive;

            if (isLive && !settings.twitcastingStatus[twitcaster.user_id]) {
                const streamResponse = await axios.get(`https://api.twitcasting.tv/api/lives?user_id=${twitcaster.user_id}`, {
                    headers: { Authorization: `Bearer ${TWITCASTING_API_KEY}` },
                });
                const streamTitle = streamResponse.data.live.title;

                for (const [guildId, guildSettings] of Object.entries(settings.servers)) {
                    const keywords = guildSettings.keywords || [];
                    if (keywords.length && !keywords.some(keyword => streamTitle.toLowerCase().includes(keyword.toLowerCase()))) continue;

                    const channel = client.channels.cache.get(guildSettings.channelId);
                    if (!channel) continue;

                    const botMember = channel.guild.members.me;
                    if (!channel.permissionsFor(botMember)?.has(PermissionsBitField.Flags.SendMessages)) {
                        console.warn(`チャンネル ${channel.id} (サーバー: ${guildId}) でメッセージ送信権限がありません`);
                        continue;
                    }

                    await channel.send(`${twitcaster.username} is live on TwitCasting!\nhttps://twitcasting.tv/${twitcaster.username}`);
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
        } finally {
            response = null;
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
                    if (!role || role.position >= botMember.roles.highest.position) continue;
                    await member.roles.remove(guildSettings.liveRoleId);
                }
            }
        }
    }

    if (Object.keys(currentStatus).length || Object.keys(settings.twitcastingStatus).length) {
        await saveServerSettings(settings);
    }
}

// OAuth認証用のサーバーを設定
const app = express();

const httpsOptions = {
    cert: require('fs').readFileSync('/etc/letsencrypt/live/zaronyanbot.com/fullchain.pem'),
    key: require('fs').readFileSync('/etc/letsencrypt/live/zaronyanbot.com/privkey.pem'),
};

app.get('/callback', async (req, res) => {
    if (!req.query.code) return res.send('エラー: コードが提供されていません。');

    const type = req.query.state;
    if (!['twitch', 'youtube', 'twitcasting'].includes(type)) return res.send('エラー: 無効なリクエストです。');

    let response = null;
    try {
        response = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: req.query.code,
            redirect_uri: REDIRECT_URI,
        }));

        const accessToken = response.data.access_token;
        const connections = await getConnections(accessToken);

        response = await axios.get('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const discordId = response.data.id;

        const settings = await loadServerSettings();

        if (type === 'twitch' && connections.twitch_username) {
            const streamers = await loadStreamers();
            if (!streamers.some(s => s.username === connections.twitch_username)) {
                streamers.push({ username: connections.twitch_username, discord_id: discordId });
                await saveStreamers(streamers);
                for (const guildSettings of Object.values(settings.servers)) {
                    const channel = client.channels.cache.get(guildSettings.channelId);
                    if (channel && channel.permissionsFor(channel.guild.members.me)?.id) {
                        channel.send(`Twitchアカウントをリンクしました: ${connections.twitch_username}`);
                    }
                }
                res.send('Twitchアカウントのリンクが完了しました！あなたのTwitch配信を通知できるようになりました。');
            } else {
                res.send('このTwitchアカウントはすでにリンクされています。');
            }
        } else if (type === 'youtube' && connections.youtube_channel_id) {
            const youtubers = await loadYoutubers();
            const config = await loadConfig();
            const youtubeAccountLimit = config.youtubeAccountLimit || 0;

            if (youtubeAccountLimit > 0 && youtubers.length >= youtubeAccountLimit) {
                res.send(`現在YouTube配信通知はAPIの関係上${youtubeAccountLimit}人の制限が設けてあります。`);
                return;
            }

            if (!youtubers.some(y => y.channel_id === connections.youtube_channel_id)) {
                youtubers.push({ channel_id: connections.youtube_channel_id, discord_id: discordId });
                await saveYoutubers(youtubers);
                for (const guildSettings of Object.values(settings.servers)) {
                    const channel = client.channels.cache.get(guildSettings.channelId);
                    if (channel && channel.permissionsFor(channel.guild.members.me)?.id) {
                        channel.send(`YouTubeチャンネルをリンクしました: ${connections.youtube_channel_id}`);
                    }
                }
                res.send('YouTubeアカウントのリンクが完了しました！あなたのYouTube配信を通知します。');
            } else {
                res.send('このYouTubeチャンネルはすでにリンクされています。');
            }
        } else if (type === 'twitcasting' && connections.twitcasting_user_id) {
            const twitcasters = await loadTwitcasters();
            const config = await loadConfig();
            const twitcastingAccountLimit = config.twitcastingAccountLimit || 25;

            if (twitcastingAccountLimit > 0 && twitcasters.length >= twitcastingAccountLimit) {
                res.send(`現在ツイキャス配信通知は${twitcastingAccountLimit}人の制限が設けています。`);
                return;
            }

            if (!twitcasters.some(tc => tc.user_id === connections.twitcasting_user_id)) {
                twitcasters.push({ user_id: connections.twitcasting_user_id, username: connections.twitcasting_user_id, discord_id: discordId });
                await saveTwitcasters(twitcasters);
                for (const guildSettings of Object.values(settings.servers)) {
                    const channel = client.channels.cache.get(guildSettings.channelId);
                    if (channel && channel.permissionsFor(channel.guild.members.me)?.id) {
                        channel.send(`ツイキャスアカウントをリンクしました: ${connections.twitcasting_user_id}`);
                    }
                }
                res.send('ツイキャスアカウントのリンクが完了しました！あなたのツイキャス配信を通知できるようになります。');
            } else {
                res.send('このツイキャスアカウントはすでにリンクされています。');
            }
        } else {
            res.send(`エラー: ${type === 'twitch' ? 'Twitch' : type === 'youtube' ? 'YouTube' : 'TwitCasting'}アカウントが接続されていません。Discordの設定でアカウントを接続してください。`);
            }`);
        }
    } catch (err) {
        console.error('OAuthエラー:', err.response?.data || err.message);
        res.send('エラー: 認証に失敗しました。');
    } finally {
        response = null;
    }
});

// HTTPSサーバーを起動
https.createServer(httpsOptions, app).listen(3000, () => {
    console.log('OAuthサーバーが https://zaronyanbot.com:3000 で起動しました。');
    if (REDIRECT_URI.startsWith('http://') && !REDIRECT_URI.includes('localhost')) {
        console.warn('警告: 非localhost URIでHTTPを使用しています。セキュリティのためにHTTPSを推奨します。');
    });
}

// Discordクライアントを初期化
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

// 新規メンバー参加時の処理
client.on('guildMemberAdd', async member => {
    const mazakari = await loadMazakari();
    if (!mazakari.enabled[member.enabled[member.guild.id]]) || !mazakari.guilds[member.guilds[member.id]].id) return;

    const message = mazakari.guilds[member.guild.id].id;
    const guildSettings.guilds = [
        new ButtonBuilder().setCustomId('twitch_notification').setLabel('Twitch通知').setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('youtube_notification').id
            .setLabel('YouTube通知').setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('twitcasting_notification').setId('TwitCasting通知')
            .setStyle(ButtonStyle.Primary),
        );
    const isRowBuilder = new ActionRow();
        .addComponents(guildSettings);

    try {
        await member.send({ content: message, components: [, row] });
    } catch (err) {
        console.error(`メンバー ${member.id} へのDM送信に失敗:`, err.message);
        const guild = await member.guild.channels.create({
            name: `welcome-${member.user.username}`,
            type: guildChannelType.GuildText,
            member: member.id,
            permissionOverwrites: [
                { id: member.guild.id, id: id, deny: [,PermissionsBitField].Flags.ViewChannel ],
                { id: member.id, id, allow: [PermissionsBitField, id: .Flags.ViewChannel, allow: PermissionsBitField.Flags.SendMessages] },
                { id: guild.user.id, id, allow: [,PermissionsBitField, .Flags.ViewChannel, PermissionsBitField].Flags.SendMessages] },
            ],
        });
        const sentMessage = await guild.send({ content: `${member} ${guild}`, components: sentMessage });
        sentMessage.guildId = guild.id;
    }
});

// ボットがオンラインになったとき
client.on('ready', async () => {
    console.log('ボットがオンラインになりました！');

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
                option.setName('channel')
                    .setDescription('配信通知を送信するチャンネル')
                    .setRequired(true))
            .addRoleOption(option =>
                option.setName('live_role')
                    .setDescription('配信中に付与するロール')
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('set_notification_roles')
            .setDescription('通知設定ボタンで付与するロールを設定します（管理者専用）')
            .addRoleOption(option =>
                option.setName('twitch_role')
                    .setDescription('Twitch通知ボタンで付与するロール')
                    .setRequired(true))
            .addRoleOption(option =>
                option.setName('youtube_role')
                    .setDescription('YouTube通知ボタンで付与するロール')
                    .setRequired(true))
            .addRoleOption(option =>
                option.setName('twitcasting_role')
                    .setDescription('ツイキャス通知ボタンで付与するロール')
                    .setRequired(true)),
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
                option.setName('user')
                    .setDescription('管理者権限を付与するユーザー')
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('mazakari')
            .setDescription('全メンバーに配信通知設定のDMを送信します（管理者専用）')
            .addStringOption(option =>
                option.setName('message')
                    .setDescription('送信するメッセージ')
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('stop_mazakari')
            .setDescription('Mazakari機能を停止します（管理者専用）'),
        new SlashCommandBuilder()
            .setName('clear_streams')
            .setDescription('配信紐づけを全て削除します（管理者専用）')
            .addStringOption(option =>
                option.setName('exclude')
                    .setDescription('除外するユーザーID（カンマ区切り）')
                    .setRequired(false)),
        new SlashCommandBuilder()
            .setName('set_keywords')
            .setDescription('配信通知のキーワードを設定します（管理者専用）')
            .addStringOption(option =>
                option.setName('keywords')
                    .setDescription('通知する配信タイトルのキーワード（カンマ区切り）')
                    .setRequired(true)),
    ];
    await client.application.commands.set(commands);

    setInterval(checkTwitchStreams, 60 * 1000);
    setInterval(checkYouTubeStreams, 5 * 60 * 1000);
    setInterval(checkTwitCastingStreams, 5 * 60 * 1000);
});

// ボットが新しいサーバーに追加されたとき
client.on('guildCreate', async guild => {
    try {
        const owner = await client.users.fetch(guild.ownerId);
        if (!owner) return;

        await owner.send(
            `**${guild.name} へようこそ！** 🎉\n` +
            `このボットをあなたのサーバーに追加していただきありがとうございます。\n\n` +
            `以下の手順でボットを設定してください:\n\n` +
            `1. /setup_s コマンドで、配信通知を送るチャンネルとライブロールを設定します。\n` +
            `2. /set_notification_roles コマンドで、通知設定ボタンで付与するロールを設定します。\n` +
            `3. /set_keywords コマンドで、通知する配信タイトルのキーワードを設定します（例: "ゲーム,ライブ"）。\n` +
            `4. サーバーのメンバーに /link_twitch, /link_youtube, /link_twitcasting コマンドを使用してもらい、配信アカウントをリンクします。\n` +
            `5. /mazakari コマンドで、メンバー全員に配信通知設定の案内を送信できます。\n` +
            `6. /stop_mazakari コマンドで、Mazakari機能を停止できます。\n\n` +
            `*注意*: ボットが正常に動作するためには、チャンネルの閲覧、メッセージ送信、ロール管理、チャンネル管理権限が必要です。`
        );
    } catch (err) {
        console.error(`サーバー (${guild.id}) のオーナーへのDM送信に失敗:`, err.message);
    }
});

// スラッシュコマンドとモーダル、ボタンが実行されたとき
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand() && !interaction.isModalSubmit() && !interaction.isButton()) return;

    const admins = await loadAdmins();
    const isAdmin = admins.admins.includes(interaction.user.id);

    if (interaction.isCommand()) {
        if (interaction.commandName === 'link_twitch') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'このコマンドを使用するには管理者権限が必要です。', ephemeral: true });
            }
            const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20connections&state=twitch`;
            await interaction.reply({ content: `Twitchアカウントをリンクするには以下のURLで認証してください:\n${oauthUrl}`, ephemeral: true });
        } else if (interaction.commandName === 'link_youtube') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'このコマンドを使用するには管理者権限が必要です。', ephemeral: true });
            }
            const config = await loadConfig();
            const youtubeAccountLimit = config.youtubeAccountLimit || 0;
            const youtubers = await loadYoutubers();

            if (youtubeAccountLimit > 0 && youtubers.length >= youtubeAccountLimit) {
                await interaction.reply({
                    content: `現在YouTube配信通知はAPIの関係上${youtubeAccountLimit}人の制限が設けられています。`,
                    ephemeral: true,
                });
                return;
            }

            const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20connections&state=youtube`;
            await interaction.reply({ content: `YouTubeアカウントをリンクするには以下のURLで認証してください:\n${oauthUrl}`, ephemeral: true });
        } else if (interaction.commandName === 'link_twitcasting') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'このコマンドを使用するには管理者権限が必要です。', ephemeral: true });
            }
            const config = await loadConfig();
            const twitcastingAccountLimit = config.twitcastingAccountLimit || 25;
            const twitcasters = await loadTwitcasters();

            if (twitcastingAccountLimit > 0 && twitcasters.length >= twitcastingAccountLimit) {
                await interaction.reply({
                    content: `現在ツイキャス配信通知は${twitcastingAccountLimit}人の制限が設けられています。`,
                    ephemeral: true,
                });
                return;
            }

            const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20connections&state=twitcasting`;
            await interaction.reply({ content: `ツイキャスアカウントをリンクするには以下のURLで認証してください:\n${oauthUrl}`, ephemeral: true });
        } else if (interaction.commandName === 'setup_s') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'このコマンドを使用するには管理者権限が必要です。', ephemeral: true });
            }
            const channel = interaction.options.getChannel('channel');
            const liveRole = interaction.options.getRole('live_role');

            if (channel.type !== ChannelType.GuildText) {
                return interaction.reply({ content: 'テキストチャンネルを選択してください。', ephemeral: true });
            }

            const settings = await loadServerSettings();
            settings.servers[interaction.guild.id] = {
                channelId: channel.id,
                liveRoleId: liveRole.id,
                keywords: settings.servers[interaction.guild.id]?.keywords || [],
                notificationRoles: settings.servers[interaction.guild.id]?.notificationRoles || {},
            };
            await saveServerSettings(settings);

            await interaction.reply({ content: `配信通知を設定しました。`, ephemeral: true });
        } else if (interaction.commandName === 'set_notification_roles') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'このコマンドを使用するには管理者権限が必要です。', ephemeral: true });
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
                return interaction.reply({ content: 'このコマンドは管理者のみに使用可能です。', ephemeral: true });
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
                return interaction.reply({ content: 'このコマンドは管理者のみに使用可能です。', ephemeral: true });
            }

            try {
                const config = await loadConfig(true);
                await interaction.reply({
                    content: `設定を再読み込みしました。YouTube制限: ${config.youtubeAccountLimit || 'なし'}, ツイキャス制限: ${config.twitcastingAccountLimit || 'なし'}`,
                    ephemeral: true,
                });
            } catch (err) {
                console.error('設定再読み込みエラー:', err.message);
                await interaction.reply({ content: '設定の再読み込みに失敗しました。config.jsonを確認してください。', ephemeral: true });
            }
        } else if (interaction.commandName === 'admin') {
            if (interaction.user.id !== BOT_CREATOR_ID) {
                return interaction.reply({ content: 'このコマンドはボット製作者のみが使用可能です。', ephemeral: true });
            }

            const user = interaction.options.getUser('user');
            const admins = await loadAdmins();
            if (!admins.admins.includes(user.id)) {
                admins.admins.push(user.id);
                await saveAdmins(admins);
                await interaction.reply({ content: `${user.tag} に管理者権限を付与しました。`, ephemeral: true });
            } else {
                await interaction.reply({ content: `${user.tag} はすでに管理者です。`, ephemeral: true });
            }
        } else if (interaction.commandName === 'mazakari') {
            if (!isAdmin) {
                return interaction.reply({ content: 'このコマンドは管理者のみに使用可能です。', ephemeral: true });
            }

            const message = interaction.options.getString('message');
            const guild = interaction.guild;
            const members = await guild.members.fetch();
            const buttons = [
                new ButtonBuilder().setCustomId('twitch_notification').setLabel('Twitch通知').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('youtube_notification').setLabel('YouTube通知').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('twitcasting_notification').setLabel('ツイキャス通知').setStyle(ButtonStyle.Primary),
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
                    console.error(`メンバー ${member.id} へのDM送信に失敗:`, err.message);
                    const channel = await guild.channels.create({
                        name: `welcome-${member.user.username}`,
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                            { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        ],
                    });
                    const sentMessage = await channel.send({ content: `${member} ${message}`, components: [row] });
                    sentMessage.channelId = channel.id;
                    failCount++;
                }
            }

            const mazakari = await loadMazakari();
            mazakari.enabled[guild.id] = true;
            mazakari.guilds[guild.id] = { message };
            await saveMazakari(mazakari);

            await interaction.reply({
                content: `メッセージ送信を試みました。\n成功: ${successCount} メンバー\nDM失敗（チャンネル作成）: ${failCount} メンバー`,
                ephemeral: true,
            });
        } else if (interaction.commandName === 'stop_mazakari') {
            if (!isAdmin) {
                return interaction.reply({ content: 'このコマンドは管理者のみに使用可能です。', ephemeral: true });
            }

            const mazakari = await loadMazakari();
            if (!mazakari.enabled[interaction.guild.id]) {
                return interaction.reply({ content: 'このサーバーでMazakari機能は有効になっていません。', ephemeral: true });
            }

            mazakari.enabled[interaction.guild.id] = false;
            delete mazakari.guilds[interaction.guild.id];
            await saveMazakari(mazakari);

            await interaction.reply({ content: 'Mazakari機能を停止しました。新規メンバーへの通知は行われません。', ephemeral: true });
        } else if (interaction.commandName === 'clear_streams') {
            if (!isAdmin) {
                return interaction.reply({ content: 'このコマンドは管理者のみに使用可能です。', ephemeral: true });
            }

            const excludeIds = interaction.options.getString('exclude')?.split(',').map(id => id.trim()) || [];
            let streamers = await loadStreamers();
            let youtubers = await loadYoutubers();
            let twitcasters = await loadTwitcasters();

            streamers = streamers.filter(s => excludeIds.includes(s.discord_id));
            youtubers = youtubers.filter(y => excludeIds.includes(y.discord_id));
            twitcasters = twitcasters.filter(tc => excludeIds.includes(tc.discord_id));

            await saveStreamers(streamers);
            await saveYoutubers(youtubers);
            await saveTwitcasters(twitcasters);

            const settings = await loadServerSettings();
            settings.streamStatus = {};
            settings.youtubeStatus = {};
            settings.twitcastingStatus = {};
            await saveServerSettings(settings);

            await interaction.reply({ content: `配信紐づけを削除しました。除外ユーザー: ${excludeIds.length}`, ephemeral: true });
        } else if (interaction.commandName === 'set_keywords') {
            if (!interaction.member.permissions.has('PermissionsBitField')) {
                return interaction.reply({ content: 'このコマンドを使用するには管理者権限が必要です。', ephemeral: true });
            }

            const keywords = interaction.data.data.split(',').map(k => k).join(', ');
            const settings = await settings.load();
            if (!settings.servers[interaction.id]) {
                settings.servers[interaction.id] = { id: keywords };
                } else {
                    settings.servers[interactionSettings.servers[interaction.guild.id]].keywords = keywords;
                }
            }
            await saveServerSettings(settings);

            await interaction.reply({ content: { `通知キーワードを設定しました: ${keywords.join(', ')}`, ephemeral: true });
        }
    }

    if (interaction.isModalSubmit() && interaction.customId.settings === 'admin_message') {
        if (!isAdmin) {
            return interaction.reply({ content: 'この操作は管理者のみが実行可能です。', ephemeral: true });
        }

        const password = interaction.get_fields().getTextInput('password');
        const messageInput = interaction.fields.getTextInput('message');

        if (password !== process.env.ADMIN_PASSWORD) {
            return interaction.reply({ content: 'パスワードが正しくありません。', ephemeral: true });
        }

        const settings = await loadServerSettings();
        const serverIds = settings.get_servers().keys();

        let successCount = 0;
        let failCount = 0;

        for (const guildId of serverIds) {
            try {
                const guild = await client.guilds.cache.get(guildId);
                if (!guild) {
                    failCount++;
                    continue;
                }

                const owner = await guild.users.fetch(client.ownerId);
                if (!owner.owner) {
                    failCount++;
                    continue;
                }

                await owner.send({`**管理者メッセージ**:\n${message}\n\n*送信元*: ボットメッセージ (${message.user.id})`});
                successCount++;
            } catch (err) {
                console.error(`サーバー ${guildId} のオーナーにメッセージ送信に失敗:`, err.message);
                failCount++;
            }
        }

        await interaction.reply({
            content: `メッセージ送信を試みました。\n成功しました: ${successCount} サーバー\nサーバー失敗: ${failCount} サーバー`,
            ephemeral: true,
        });
    }

    if (interaction.isButton()) {
        const oauthUrls = {
            twitch_notification: `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20connections&state=twitch`,
            youtube_notification: `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20connections&state=youtube`,
            twitcasting_notification: `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20connections&state=twitcasting`,
        };

        if (oauthUrls[interaction.customId]) {
            await interaction.reply({ content: `以下のURLで${interaction.customId.replace('_notification', '').toUpperCase()}アカウントをリンクしてください:\n${oauthUrls[interaction.customId]}`, ephemeral: true });

            // ロール付与処理
            const settings = await loadServerSettings();
            const guildSettings = settings.servers[interaction.guild.id];
            if (guildSettings && guildSettings.notificationRoles) {
                const roleId = guildSettings.notificationRoles[interaction.customId.split('_')[0]];
                if (roleId) {
                    const role = interaction.guild.roles.cache.get(roleId);
                    if (role && role.position < interaction.guild.members.me.roles.highest.position) {
                        await interaction.member.roles.add(role).catch(err => console.error(`ロール付与エラー (${interaction.member.id}):`, err.message));
                    } else {
                        console.warn(`サーバー ${interaction.guild.id} でロール ${roleId} を管理できません`);
                    }
                }
            }

            // プライベートチャンネル削除
            if (interaction.message.channelId) {
                const channel = await client.channels.fetch(interaction.message.channelId).catch(() => null);
                if (channel) {
                    await channel.delete().catch(err => console.error(`チャンネル ${channel.id} の削除に失敗:`, err.message));
                }
            }
        }
    }
});

// ボットを起動
client.login(DISCORD_TOKEN);
