// 必要なモジュールをインポート
require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
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
    ADMIN_PASSWORD,
    BOT_CREATOR_ID,
    REDIRECT_URI = 'https://zaronyanbot.com:3000/callback',
} = process.env;

// 環境変数が設定されているか確認
const requiredEnvVars = ['DISCORD_TOKEN', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'YOUTUBE_API_KEY', 'ADMIN_PASSWORD', 'BOT_CREATOR_ID'];
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
const SERVER_SETTINGS_FILE = path.join(__dirname, 'data/serverSettings.json');

// キャッシュオブジェクトを初期化
let configCache = null;
let streamersCache = null;
let youtubersCache = null;
let serverSettingsCache = null;

// 設定ファイルを読み込む
async function loadConfig(force = false) {
    if (!force && configCache) return configCache; // キャッシュ使用
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf8');
        configCache = JSON.parse(data);
        return configCache;
    } catch (err) {
        console.warn('config.jsonが見つからないか無効です。デフォルト設定を使用します。');
        configCache = { youtubeAccountLimit: 0 }; // 制限なし
        return configCache;
    }
}

// ストリーマーデータを読み込む
async function loadStreamers(force = false) {
    if (!force && streamersCache) return streamersCache; // キャッシュ使用
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
        streamersCache = streamers; // キャッシュ更新
        await fs.writeFile(STREAMERS_FILE, JSON.stringify(streamers, null, 2));
    } catch (err) {
        console.error('ストリーマーデータ保存エラー:', err.message);
        throw err;
    }
}

// YouTube配信者データを読み込む
async function loadYoutubers(force = false) {
    if (!force && youtubersCache) return youtubersCache; // キャッシュ使用
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
        youtubersCache = youtubers; // キャッシュ更新
        await fs.writeFile(YOUTUBERS_FILE, JSON.stringify(youtubers, null, 2));
    } catch (err) {
        console.error('YouTube配信者データ保存エラー:', err.message);
        throw err;
    }
}

// サーバー設定を読み込む
async function loadServerSettings(force = false) {
    if (!force && serverSettingsCache) return serverSettingsCache; // キャッシュ使用
    try {
        const data = await fs.readFile(SERVER_SETTINGS_FILE, 'utf8');
        serverSettingsCache = JSON.parse(data);
        if (!serverSettingsCache.streamStatus) serverSettingsCache.streamStatus = {};
        if (!serverSettingsCache.youtubeStatus) serverSettingsCache.youtubeStatus = {};
        return serverSettingsCache;
    } catch (err) {
        serverSettingsCache = { servers: {}, streamStatus: {}, youtubeStatus: {} };
        return serverSettingsCache;
    }
}

// サーバー設定を保存
async function saveServerSettings(settings) {
    try {
        serverSettingsCache = settings; // キャッシュ更新
        await fs.writeFile(SERVER_SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (err) {
        console.error('サーバー設定保存エラー:', err.message);
        throw err;
    }
}

// Twitch APIトークンを取得（キャッシュ活用）
let twitchTokenCache = null;
let twitchTokenExpiry = 0;
async function getTwitchToken() {
    if (twitchTokenCache && Date.now() < twitchTokenExpiry) return twitchTokenCache; // キャッシュ使用
    try {
        const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: TWITCH_CLIENT_ID,
                client_secret: TWITCH_CLIENT_SECRET,
                grant_type: 'client_credentials',
            },
        });
        twitchTokenCache = response.data.access_token;
        twitchTokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000; // 1分バッファ
        return twitchTokenCache;
    } catch (err) {
        console.error('Twitchトークン取得エラー:', err.response?.data || err.message);
        return null;
    } finally {
        response = null; // メモリ解放
    }
}

// Discord OAuthで接続情報を取得
async function getConnections(accessToken) {
    let response = null;
    try {
        response = await axios.get('https://discord.com/api/v10/users/@me/connections', {
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
    } finally {
        response = null; // メモリ解放
    }
}

// Twitchストリームの状態をチェック
async function checkTwitchStreams() {
    const streamers = await loadStreamers();
    if (!streamers.length) return; // 空の場合は早期終了

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
                currentStatus[streamer] = true;

                if (!settings.streamStatus[streamer]) {
                    const streamerInfo = streamers.find(s => s.username === streamer);
                    for (const [guildId, guildSettings] of Object.entries(settings.servers)) {
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
            response = null; // メモリ解放
        }
    }

    // 配信終了処理
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
        await saveServerSettings(settings); // 変更がある場合のみ保存
    }
}

// YouTubeライブ配信の状態をチェック（5分周期、設定ファイルの制限を適用）
async function checkYouTubeStreams() {
    let youtubers = await loadYoutubers();
    if (!youtubers.length) return; // 空の場合は早期終了

    const config = await loadConfig();
    const youtubeAccountLimit = config.youtubeAccountLimit || 0;

    // 制限が設定されている場合、youtubersを制限
    if (youtubeAccountLimit > 0) {
        youtubers = youtubers.slice(0, youtubeAccountLimit);
    }

    const settings = await loadServerSettings();
    const currentStatus = {};

    // channels.listでライブ配信中のチャンネルをチェック
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

        // ライブ配信中のチャンネルの詳細を取得
        for (const channelId of liveChannelIds) {
            let searchResponse = null;
            try {
                searchResponse = await axios.get(
                    `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${YOUTUBE_API_KEY}`
                );

                if (searchResponse.data.items.length > 0) {
                    const videoId = searchResponse.data.items[0].id.videoId;
                    const channelName = searchResponse.data.items[0].snippet.channelTitle;
                    const youtuber = youtubers.find(yt => yt.channel_id === channelId);

                    if (!settings.youtubeStatus[channelId]) {
                        for (const [guildId, guildSettings] of Object.entries(settings.servers)) {
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
                searchResponse = null; // メモリ解放
            }
        }
    } catch (err) {
        console.error('YouTubeチャンネルチェックエラー:', err.response?.data || err.message);
    } finally {
        response = null; // メモリ解放
    }

    // 配信終了の処理
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
        await saveServerSettings(settings); // 変更がある場合のみ保存
    }
}

// OAuth認証用のサーバーを設定
const app = express();

// HTTPSサーバーの設定
const httpsOptions = {
    cert: require('fs').readFileSync('/etc/letsencrypt/live/zaronyanbot.com/fullchain.pem'),
    key: require('fs').readFileSync('/etc/letsencrypt/live/zaronyanbot.com/privkey.pem'),
};

app.get('/callback', async (req, res) => {
    if (!req.query.code) return res.send('エラー: コードが提供されていません。');

    const type = req.query.state;
    if (!['twitch', 'youtube'].includes(type)) return res.send('エラー: 無効なリクエストです。');

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
                    if (channel && channel.permissionsFor(channel.guild.members.me)?.has(PermissionsBitField.Flags.SendMessages)) {
                        channel.send(`Twitchアカウントをリンクしました: ${connections.twitch_username}`);
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
                    if (channel && channel.permissionsFor(channel.guild.members.me)?.has(PermissionsBitField.Flags.SendMessages)) {
                        channel.send(`YouTubeチャンネルをリンクしました: ${connections.youtube_channel_id}`);
                    }
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
    } finally {
        response = null; // メモリ解放
    }
});

// HTTPSサーバーを起動
https.createServer(httpsOptions, app).listen(3000, () => {
    console.log('OAuthサーバーが https://zaronyanbot.com:3000 で起動しました');
    if (REDIRECT_URI.startsWith('http://') && !REDIRECT_URI.includes('localhost')) {
        console.warn('警告: 非localhost URIでHTTPを使用しています。セキュリティのためにHTTPSを推奨します。');
    }
});

// Discordクライアントを初期化（必要なインテントのみ）
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
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
        new SlashCommandBuilder()
            .setName('admin_message')
            .setDescription('ボット製作者が全サーバーの管理者にメッセージを送信します（製作者専用）'),
        new SlashCommandBuilder()
            .setName('reload_config')
            .setDescription('設定ファイルを再読み込みします（製作者専用）'),
    ];
    await client.application.commands.set(commands);

    // 定期的に配信状態をチェック（周期は変更しない）
    setInterval(checkTwitchStreams, 60 * 1000); // Twitch: 1分
    setInterval(checkYouTubeStreams, 5 * 60 * 1000); // YouTube: 5分
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
            `1. Discord サーバーのテキストチャンネル上にて**/setup_s** コマンドで、配信通知を送るチャンネルとライブロールを設定します。\n` +
            `2. サーバーのメンバーに **/link_twitch** または **/link_youtube** コマンドを使用してもらい、TwitchやYouTubeアカウントをリンクしてもらいます。\n\n` +
            `*注意*: ボットが正常に動作するためには、チャンネルの閲覧、メッセージの送信、ロールの管理権限が必要です。`
        );
    } catch (err) {
        console.error(`サーバー (${guild.id}) のオーナーへのDM送信に失敗:`, err.message);
    }
});

// スラッシュコマンドとモーダルが実行されたとき
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand() && !interaction.isModalSubmit()) return;

    if (interaction.isCommand()) {
        if (interaction.commandName === 'link_twitch') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'このコマンドを使用するには管理者権限が必要です。', ephemeral: true });
            }
            const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20connections&state=twitch`;
            await interaction.reply({ content: `Twitchアカウントをリンクするには以下のURLで認証してください:\n${endpoint}`, ephemeral: true });
        } else if (interaction.commandName === 'link_youtube') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'このコマンドを使用するには管理者権限が必要です。', ephemeral: true });
            }
            const config = await loadConfig();
            const youtubeAccountLimit = config.youtubeAccountLimit || 0;
            const youtubers = await loadYoutubers();

            if (youtubeAccountLimit > 0 && youtubers.length >= youtubeAccountLimit) {
                await interaction.reply({
                    content: `現在YouTube配信通知はAPIの関係上${youtubeAccountLimit}人の制限が設けられています。正式リリースをお待ちください。`,
                    ephemeral: true,
                });
                return;
            }

            const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20connections&state=youtube`;
            await interaction.reply({ content: `YouTubeアカウントをリンクするには以下のURLで認証してください:\n${endpoint}`, ephemeral: true });
        } else if (interaction.commandName === 'setup_s') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'このコマンドを使用するには管理者権限が必要です。', ephemeral: true });
            }
            const channel = interaction.options.getChannel('channel');
            const liveRole = interaction.options.getRole('live_role');

            if (channel.type !== 0) {
                return interaction.reply({ content: 'テキストチャンネルを選択してください。', ephemeral: true });
            }

            const settings = await loadServerSettings();
            settings.servers[interaction.guild.id] = {
                channelId: channel.id,
                liveRoleId: liveRole.id,
            };
            await saveServerSettings(settings);

            await interaction.reply({ content: `皆さんの配信通知が行えるようになりました。`, ephemeral: true });
        } else if (interaction.commandName === 'admin_message') {
            if (interaction.user.id !== process.env.BOT_CREATOR_ID) {
                return interaction.reply({ content: 'この制限はボットの制限のみが使用できます。', ephemeral: true });
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
            if (interaction.user.id !== process.env.BOT_CREATOR_ID) {
                return interaction.reply({ content: 'この度はボットの制限のみが使用できます。', ephemeral: true });
            }

            try {
                const config = await loadConfig(true); // 強制再読み込み
                await interaction.reply({
                    content: `設定を再読み込みしました。YouTube制限: ${config.youtubeAccountLimit || 'なし'}`,
                    ephemeral: true,
                });
            } catch (err) {
                console.error('設定再読み込みエラー:', err.message);
                await interaction.reply({ content: '設定の再読み込みに失敗しました。config.jsonを確認してください。', ephemeral: true });
            }
        }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'admin_message_modal') {
        if (interaction.user.id !== process.env.BOT_CREATOR_ID) {
            return interaction.reply({ content: 'この操作はボットの制限のみが実行できます。', ephemeral: true });
        }

        const password = interaction.fields.getTextInputValue('password');
        const message = interaction.fields.getTextInputValue('message');

        if (password !== process.env.ADMIN_PASSWORD) {
            return interaction.reply({ content: 'パスワードが間違っています。', ephemeral: true });
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

                await owner.send(`**管理者メッセージ**:\n${message}\n\n*送信元*: ボット製作者 (${interaction.user.tag})`);
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
});

// ボットを起動
client.login(DISCORD_TOKEN);
