// 必要なモジュールをインポート
require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');
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
    REDIRECT_URI = 'http://localhost:3000/callback',
} = process.env;

// 環境変数が設定されているか確認
const requiredEnvVars = [
    'DISCORD_TOKEN',
    'TWITCH_CLIENT_ID',
    'TWITCH_CLIENT_SECRET',
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'YOUTUBE_API_KEY',
];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`エラー: 環境変数 ${envVar} が設定されていません。`);
        process.exit(1);
    }
}

// Discordクライアントを初期化
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// ファイルパスを定義
const STREAMERS_FILE = path.join(__dirname, '../data/streamers.json');
const YOUTUBERS_FILE = path.join(__dirname, '../data/youtubers.json');
const SERVER_SETTINGS_FILE = path.join(__dirname, '../data/serverSettings.json');

// ストリーマーデータを読み込む
async function loadStreamers() {
    try {
        const data = await fs.readFile(STREAMERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}

// ストリーマーデータを保存
async function saveStreamers(streamers) {
    try {
        await fs.writeFile(STREAMERS_FILE, JSON.stringify(streamers, null, 2));
    } catch (err) {
        console.error('ストリーマーデータ保存エラー:', err.message);
        throw err;
    }
}

// YouTube配信者データを読み込む
async function loadYoutubers() {
    try {
        const data = await fs.readFile(YOUTUBERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}

// YouTube配信者データを保存
async function saveYoutubers(youtubers) {
    try {
        await fs.writeFile(YOUTUBERS_FILE, JSON.stringify(youtubers, null, 2));
    } catch (err) {
        console.error('YouTube配信者データ保存エラー:', err.message);
        throw err;
    }
}

// サーバー設定を読み込む
async function loadServerSettings() {
    try {
        const data = await fs.readFile(SERVER_SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(data);
        if (!settings.streamStatus) settings.streamStatus = {};
        if (!settings.youtubeStatus) settings.youtubeStatus = {};
        return settings;
    } catch (err) {
        return { servers: {}, streamStatus: {}, youtubeStatus: {} };
    }
}

// サーバー設定を保存
async function saveServerSettings(settings) {
    try {
        await fs.writeFile(SERVER_SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (err) {
        console.error('サーバー設定保存エラー:', err.message);
        throw err;
    }
}

// Twitch APIトークンを取得
async function getTwitchToken() {
    try {
        const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: TWITCH_CLIENT_ID,
                client_secret: TWITCH_CLIENT_SECRET,
                grant_type: 'client_credentials',
            },
        });
        return response.data.access_token;
    } catch (err) {
        console.error('Twitchトークン取得エラー:', err.response?.data || err.message);
        return null;
    }
}

// Discord OAuthで接続情報を取得
async function getConnections(accessToken) {
    try {
        const response = await axios.get('https://discord.com/api/v10/users/@me/connections', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const connections = { twitch_username: '', youtube_channel_id: '' };
        for (const conn of response.data) {
            if (conn.type === 'twitch') connections.twitch_username = conn.name;
            if (conn.type === 'youtube') connections.youtube_channel_id = conn.id;
        }
        return connections;
    } catch (err) {
        console.error('接続情報取得エラー:', err.response?.data || err.message);
        return { twitch_username: '', youtube_channel_id: '' };
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
        try {
            const response = await axios.get(`https://api.twitch.tv/helix/streams?${query}`, {
                headers: {
                    'Client-ID': TWITCH_CLIENT_ID,
                    Authorization: `Bearer ${token}`,
                },
            });

            for (const stream of response.data.data) {
                const streamer = stream.user_login;
                currentStatus[streamer] = true;

                if (!settings.streamStatus[streamer]) {
                    const streamerInfo = streamers.find(s => s.username === streamer);
                    for (const [guildId, guildSettings] of Object.entries(settings.servers)) {
                        const channel = client.channels.cache.get(guildSettings.channelId);
                        if (!channel) continue;

                        const botMember = channel.guild.members.me;
                        if (!channel.permissionsFor(botMember).has('SEND_MESSAGES')) {
                            console.warn(`チャンネル ${channel.id} (サーバー: ${guildId}) でメッセージ送信権限がありません`);
                            continue;
                        }

                        channel.send(`${streamer} is live on Twitch!\nhttps://twitch.tv/${streamer}`);

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
                    await saveServerSettings(settings);
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
                    if (!role || role.position >= botMember.roles.highest.position) continue;
                    await member.roles.remove(guildSettings.liveRoleId);
                }
            }
            await saveServerSettings(settings);
        }
    }
}

// YouTubeライブ配信の状態をチェック
async function checkYouTubeStreams() {
    const youtubers = await loadYoutubers();
    if (!youtubers.length) return;

    const settings = await loadServerSettings();
    for (const yt of youtubers) {
        try {
            const response = await axios.get(
                `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${yt.channel_id}&eventType=live&type=video&key=${YOUTUBE_API_KEY}`
            );
            const isLive = response.data.items.length > 0;
            const wasLive = settings.youtubeStatus[yt.channel_id];

            if (isLive && !wasLive) {
                const videoId = response.data.items[0].id.videoId;
                const channelName = response.data.items[0].snippet.channelTitle;

                for (const [guildId, guildSettings] of Object.entries(settings.servers)) {
                    const channel = client.channels.cache.get(guildSettings.channelId);
                    if (!channel) continue;

                    const botMember = channel.guild.members.me;
                    if (!channel.permissionsFor(botMember).has('SEND_MESSAGES')) {
                        console.warn(`チャンネル ${channel.id} (サーバー: ${guildId}) でメッセージ送信権限がありません`);
                        continue;
                    }

                    channel.send(`${channelName} is live on YouTube!\nhttps://youtube.com/watch?v=${videoId}`);

                    const guild = client.guilds.cache.get(guildId);
                    const member = await guild.members.fetch(yt.discord_id).catch(() => null);
                    if (member) {
                        const role = guild.roles.cache.get(guildSettings.liveRoleId);
                        if (!role || role.position >= botMember.roles.highest.position) {
                            console.warn(`サーバー ${guildId} でロール ${guildSettings.liveRoleId} を管理できません`);
                            continue;
                        }
                        await member.roles.add(guildSettings.liveRoleId);
                    }
                }
                settings.youtubeStatus[yt.channel_id] = true;
                await saveServerSettings(settings);
            } else if (!isLive && wasLive) {
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
                await saveServerSettings(settings);
            }
        } catch (err) {
            console.error('YouTubeストリームチェックエラー:', err.response?.data || err.message);
        }
    }
}

// OAuth認証用のサーバーを設定
const app = express();
app.get('/callback', async (req, res) => {
    if (!req.query.code) return res.send('エラー: コードが提供されていません。');

    const type = req.query.state; // twitch または youtube
    if (!['twitch', 'youtube'].includes(type)) return res.send('エラー: 無効なリクエストです。');

    try {
        // Discord OAuthでアクセストークンを取得
        const response = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: req.query.code,
            redirect_uri: REDIRECT_URI,
        }));

        const accessToken = response.data.access_token;
        const connections = await getConnections(accessToken);

        // ユーザー情報を取得（Discord IDを取得）
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
                    if (channel) channel.send(`Twitchアカウントをリンクしました: ${connections.twitch_username}`);
                }
                res.send('Twitchアカウントのリンクが完了しました！あなたのTwitch配信を通知できるようになりました♡');
            } else {
                res.send('このTwitchアカウントはすでにリンクされています。');
            }
        } else if (type === 'youtube' && connections.youtube_channel_id) {
            const youtubers = await loadYoutubers();
            if (!youtubers.some(y => y.channel_id === connections.youtube_channel_id)) {
                youtubers.push({ channel_id: connections.youtube_channel_id, discord_id: discordId });
                await saveYoutubers(youtubers);
                for (const guildSettings of Object.values(settings.servers)) {
                    const channel = client.channels.cache.get(guildSettings.channelId);
                    if (channel) channel.send(`YouTubeチャンネルをリンクしました: ${connections.youtube_channel_id}`);
                }
                res.send('YouTubeアカウントのリンクが完了しました！あなたのYouTube配信を通知できるようになりました♡');
            } else {
                res.send('このYouTubeチャンネルはすでにリンクされています。');
            }
        } else {
            res.send(`エラー: ${type === 'twitch' ? 'Twitch' : 'YouTube'}アカウントが接続されていません。Discordの設定でアカウントを接続してください。`);
        }
    } catch (err) {
        console.error('OAuthエラー:', err.response?.data || err.message);
        res.send('エラー: 認証に失敗しました。');
    }
});

// OAuthサーバーを起動
app.listen(3000, () => {
    console.log('OAuthサーバーが http://localhost:3000 で起動しました');
    if (REDIRECT_URI.startsWith('http://') && !REDIRECT_URI.includes('localhost')) {
        console.warn('警告: 非localhost URIでHTTPを使用しています。セキュリティのためにHTTPSを推奨します。');
    }
});

// ボットがオンラインになったとき
client.on('ready', async () => {
    console.log('ボットがオンラインになりました！');

    // スラッシュコマンドを登録
    const commands = [
        new SlashCommandBuilder()
            .setName('link_twitch')
            .setDescription('Twitchアカウントをリンクして配信監視を有効にします'),
        new SlashCommandBuilder()
            .setName('link_youtube')
            .setDescription('YouTubeアカウントをリンクして配信監視を有効にします'),
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
    ];
    await client.application.commands.set(commands);

    // 定期的に配信状態をチェック
    setInterval(checkTwitchStreams, 60 * 1000);
    setInterval(checkYouTubeStreams, 15 * 60 * 1000);
});

// ボットが新しいサーバーに追加されたとき
client.on('guildCreate', async guild => {
    try {
        const owner = await guild.fetchOwner();
        await owner.send(`サーバー (${guild.name}) に追加してくれてありがとう！/setup_s コマンドを使って、通知チャンネルとライブロールを設定してください。`);
    } catch (err) {
        console.error(`サーバーオーナーにDM送信失敗 (サーバー: ${guild.id}):`, err.message);
    }
});

// スラッシュコマンドが実行されたとき
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'link_twitch') {
        const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20connections&state=twitch`;
        await interaction.reply(`Twitchアカウントをリンクするには以下のURLで認証してください:\n${oauthUrl}`);
    } else if (interaction.commandName === 'link_youtube') {
        const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20connections&state=youtube`;
        await interaction.reply(`YouTubeアカウントをリンクするには以下のURLで認証してください:\n${oauthUrl}`);
    } else if (interaction.commandName === 'setup_s') {
        if (!interaction.member.permissions.has('ADMINISTRATOR')) {
            return interaction.reply('このコマンドを使用するには管理者権限が必要です。');
        }

        const channel = interaction.options.getChannel('channel');
        const liveRole = interaction.options.getRole('live_role');

        if (channel.type !== 'GUILD_TEXT') {
            return interaction.reply('テキストチャンネルを選択してください。');
        }

        const settings = await loadServerSettings();
        settings.servers[interaction.guild.id] = {
            channelId: channel.id,
            liveRoleId: liveRole.id,
        };
        await saveServerSettings(settings);

        await interaction.reply(`皆さんの配信通知が行えるようになりました。管理者様に指定されてたテキストチャンネルで/link_twitch または /link_youtube と入力して私に通知させてください！`);
    }
});

// ボットを起動
client.login(DISCORD_TOKEN);
