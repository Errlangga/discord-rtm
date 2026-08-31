require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const storage = require('./storage');
const common = require('./services/common');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember]
});

const RAILWAY_VOLUME_PATH = '/data';
const baseDir = process.env.DATA_DIR || (fs.existsSync(RAILWAY_VOLUME_PATH) ? RAILWAY_VOLUME_PATH : __dirname);
console.log(`[STORAGE] Database directory: ${baseDir}`);
const ctx = {
  client,
  baseDir,
  config,
  isAdmin: common.isAdmin,
  formatWIB: common.formatWIB,
  messageStore: storage.loadMessageStore(baseDir),
  dailyStore: storage.loadDailyStore(baseDir),
  testiStore: storage.loadTestiStore(baseDir),
  storeTicketLocks: storage.loadStoreTicketLocks(baseDir),
  ticketActivity: storage.loadTicketActivity(baseDir),
  lastSentDaily: {},
  saveMessageStore: () => storage.saveMessageStore(baseDir, ctx.messageStore),
  saveDailyStore: () => storage.saveDailyStore(baseDir, ctx.dailyStore),
  saveTestiStore: () => storage.saveTestiStore(baseDir, ctx.testiStore),
  saveStoreTicketLocks: () => storage.saveStoreTicketLocks(baseDir, ctx.storeTicketLocks),
  saveTicketActivity: () => storage.saveTicketActivity(baseDir, ctx.ticketActivity)
};
ctx.sendAdminLog = (...args) => common.sendAdminLog(ctx, ...args);
ctx.getOnlineAdmins = (guild) => common.getOnlineAdmins(ctx, guild);

const features = [
  require('./features/serverLogs'),
  require('./features/adminStatus'),
  require('./features/dailyMessage'),
  require('./features/uptime'),
  require('./features/storeMessages'),
  require('./features/storeInteractions'),
  require('./features/adminSelling'),
  require('./features/midman'),
  require('./features/qna'),
  require('./features/midmanFeedback'),
  require('./features/ticketInactivity'),
  require('./features/ownerPostCleanup')
];

for (const feature of features) feature.register(ctx);

client.once('clientReady', async () => {
  console.log(`[BOT READY] Logged in as ${client.user.tag}!`);
  console.log(`[PERSISTENT STORAGE] ${ctx.messageStore.size} posting, ${Object.keys(ctx.dailyStore).length} daily message, ${ctx.testiStore.count} testi, ${Object.keys(ctx.storeTicketLocks).length} active store ticket locks, ${Object.keys(ctx.ticketActivity).length} tracked ticket activities.`);
  for (const feature of features) {
    if (typeof feature.onReady === 'function') await feature.onReady(ctx);
  }
});

process.on('unhandledRejection', error => console.error('[UNHANDLED REJECTION]', error));
process.on('uncaughtException', error => console.error('[UNCAUGHT EXCEPTION]', error));

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('❌ DISCORD_BOT_TOKEN belum diset. Buat environment variable DISCORD_BOT_TOKEN.');
  process.exit(1);
}

client.login(token);
