require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const {
    DISCORD_TOKEN,
    TWITCH_CLIENT_ID,
    TWITCH_CLIENT_SECRET,
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    YOUTUBE_API_KEY,
    REDIRECT_URI = 'http://localhost:3000/callback',
} = process.env;

// 環境変数のバリデーション
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
        console.error(`Error: Environment variable ${envVar} is not set.`);
        process.exit(1);
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const STREAMERS_FILE = path.join(__dirname, '../data/streamers.json');
const YOUTUBERS_FILE = path.join(__dirname, '../data/youtubers.json');
const SERVER_SETTINGS_FILE = path.join(__dirname, '../data/serverSettings.json');

async function loadStreamers() {
    try {
        const data = await fs.readFile(STREAMERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}

async function saveStreamers(streamers) {
    try {
        await fs.writeFile(STREAMERS_FILE, JSON.stringify(streamers, null, 2));
    } catch (err) {
        console.error('Error saving streamers:', err.message);
        throw err;
    }
}

async function loadYoutubers() {
    try {
        const data = await fs.readFile(YOUTUBERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}

async function saveYoutubers(youtubers) {
    try {
        await fs.writeFile(YOUTUBERS_FILE, JSON.stringify(youtubers, null, 2));
    } catch (err) {
        console.error('Error saving youtubers:', err.message);
        throw err;
    }
}

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

async function saveServerSettings(settings) {
    try {
        await fs.writeFile(SERVER_SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (err) {
        console.error('Error saving server settings:', err.message);
        throw err;
    }
}

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
        console.error('Twitch Token Error:', err.response?.data || err.message);
        return null;
    }
}

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
        console.error('Connections Error:', err.response?.data || err.message);
        return { twitch_username: '', youtube_channel_id: '' };
    }
}

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
                            console.warn(`No permission to send messages in channel ${channel.id} (guild: ${guildId})`);
                            continue;
                        }

                        channel.send(`${streamer} is live on Twitch!\nhttps://twitch.tv/${streamer}`);

                        const guild = client.guilds.cache.get(guildId);
                        const member = await guild.members.fetch(streamerInfo.discord_id).catch(() => null);
                        if (member) {
                            const role = guild.roles.cache.get(guildSettings.liveRoleId);
                            if (!role || role.position >= botMember.roles.highest.position) {
                                console.warn(`Cannot manage role ${guildSettings.liveRoleId} in guild ${guildId}`);
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
            console.error('Twitch Stream Check Error:', err.response?.data || err.message);
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
                        console.warn(`No permission to send messages in channel ${channel.id} (guild: ${guildId})`);
                        continue;
                    }

                    channel.send(`${channelName} is live on YouTube!\nhttps://youtube.com/watch?v=${videoId}`);

                    const guild = client.guilds.cache.get(guildId);
                    const member = await guild.members.fetch(yt.discord_id).catch(() => null);
                    if (member) {
                        const role = guild.roles.cache.get(guildSettings.liveRoleId);
                        if (!role || role.position >= botMember.roles.highest.position) {
                            console.warn(`Cannot manage role ${guildSettings.liveRoleId} in guild ${guildId}`);
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
            console.error('YouTube Stream Check Error:', err.response?.data || err.message);
        }
    }
}

const app = express();
app.get('/callback', async (req, res) => {
    if (!req.query.code) return res.send('Error: No code provided.');

    try {
        const response = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: req.query.code,
            redirect_uri: REDIRECT_URI,
        }));

        const accessToken = response.data.access_token;
        const connections = await getConnections(accessToken);

        const userResponse = await axios.get('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const discordId = userResponse.data.id;

        const settings = await loadServerSettings();
        if (connections.twitch_username) {
            const streamers = await loadStreamers();
            if (!streamers.some(s => s.username === connections.twitch_username)) {
                streamers.push({ username: connections.twitch_username, discord_id: discordId });
                await saveStreamers(streamers);
                for (const guildSettings of Object.values(settings.servers)) {
                    const channel = client.channels.cache.get(guildSettings.channelId);
                    if (channel) channel.send(`Linked Twitch account: ${connections.twitch_username}`);
                }
            }
        }

        if (connections.youtube_channel_id) {
            const youtubers = await loadYoutubers();
            if (!youtubers.some(y => y.channel_id === connections.youtube_channel_id)) {
                youtubers.push({ channel_id: connections.youtube_channel_id, discord_id: discordId });
                await saveYoutubers(youtubers);
                for (const guildSettings of Object.values(settings.servers)) {
                    const channel = client.channels.cache.get(guildSettings.channelId);
                    if (channel) channel.send(`Linked YouTube channel: ${connections.youtube_channel_id}`);
                }
            }
        }

        res.send('Account linked successfully! You can close this page.');
    } catch (err) {
        console.error('OAuth Error:', err.response?.data || err.message);
        res.send('Error: Failed to authenticate.');
    }
});

app.listen(3000, () => {
    console.log('OAuth server running on http://localhost:3000');
    if (REDIRECT_URI.startsWith('http://') && !REDIRECT_URI.includes('localhost')) {
        console.warn('WARNING: Using HTTP on a non-localhost URI. HTTPS is recommended for security.');
    }
});

client.on('ready', async () => {
    console.log('Bot is online!');

    const commands = [
        new SlashCommandBuilder()
            .setName('link')
            .setDescription('Link your Twitch/YouTube accounts for stream monitoring'),
        new SlashCommandBuilder()
            .setName('setup')
            .setDescription('Set up the bot for this server')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('The channel to send stream notifications')
                    .setRequired(true))
            .addRoleOption(option =>
                option.setName('live_role')
                    .setDescription('The role to assign to live streamers')
                    .setRequired(true)),
    ];
    await client.application.commands.set(commands);

    setInterval(checkTwitchStreams, 60 * 1000);
    setInterval(checkYouTubeStreams, 15 * 60 * 1000);
});

client.on('guildCreate', async guild => {
    try {
        const owner = await guild.fetchOwner();
        await owner.send(`Thank you for adding me to your server (${guild.name})! Please use the /setup command to configure the bot by specifying a notification channel and live role.`);
    } catch (err) {
        console.error(`Failed to send DM to guild owner (guild: ${guild.id}):`, err.message);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'link') {
        const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20connections`;
        await interaction.reply(`Please authenticate to link your Twitch/YouTube accounts:\n${oauthUrl}`);
    } else if (interaction.commandName === 'setup') {
        if (!interaction.member.permissions.has('ADMINISTRATOR')) {
            return interaction.reply('You need Administrator permissions to use this command.');
        }

        const channel = interaction.options.getChannel('channel');
        const liveRole = interaction.options.getRole('live_role');

        if (channel.type !== 'GUILD_TEXT') {
            return interaction.reply('Please select a text channel.');
        }

        const settings = await loadServerSettings();
        settings.servers[interaction.guild.id] = {
            channelId: channel.id,
            liveRoleId: liveRole.id,
        };
        await saveServerSettings(settings);

        await interaction.reply(`Setup completed! Notifications will be sent to ${channel.name}, and the live role ${liveRole.name} will be used.`);
    }
});

client.login(DISCORD_TOKEN);
