const { EmbedBuilder } = require('discord.js');
const locks = require('../services/ticketLocks');

const GENERAL_INACTIVITY_MS = 2 * 24 * 60 * 60 * 1000;
const MIDMAN_INACTIVITY_MS = 7 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;
const closingTickets = new Set();

function isTrackedTicket(ctx, channel) {
  if (!channel?.isTextBased?.()) return false;
  const topic = String(channel.topic || '');
  const isTicketCategory = [ctx.config.STORE_TICKET_CATEGORY_ID, ctx.config.MIDMAN_CATEGORY_ID].includes(channel.parentId);
  return isTicketCategory && topic.includes('JASHER_TICKET:1');
}

function isMidmanTicket(channel) {
  return /(?:^|\|)Type:MIDMAN(?:\||$)/.test(String(channel?.topic || ''));
}

function parseTopic(topic = '') {
  return {
    source: topic.match(/SourceMessageID:(\d+)/)?.[1] || null,
    clicker: topic.match(/StoreClickerID:(\d+)/)?.[1] || null,
    owner: topic.match(/StoreOwnerID:(\d+)/)?.[1] || null,
    creator: topic.match(/CreatorID:(\d+)/)?.[1] || null,
    type: topic.match(/(?:^|\|)Type:([^|]+)/)?.[1] || null
  };
}

function ensureRecord(ctx, channel, options = {}) {
  const previous = ctx.ticketActivity[channel.id] || {};
  const midman = options.midman ?? isMidmanTicket(channel);
  const now = Number(options.now) || Date.now();

  const record = {
    ...previous,
    guildId: channel.guildId,
    categoryId: channel.parentId,
    type: midman ? 'MIDMAN' : (previous.type || 'GENERAL'),
    createdAt: previous.createdAt || channel.createdTimestamp || now,
    lastActivityAt: Number(options.lastActivityAt) || previous.lastActivityAt || channel.createdTimestamp || now,
    lastAdminActivityAt: midman
      ? (Number(options.lastAdminActivityAt) || previous.lastAdminActivityAt || channel.createdTimestamp || now)
      : previous.lastAdminActivityAt,
    closing: false
  };

  ctx.ticketActivity[channel.id] = record;
  return record;
}

function markMidmanTicket(ctx, channel, timestamp = Date.now()) {
  if (!channel?.id) return;
  ensureRecord(ctx, channel, {
    midman: true,
    now: timestamp,
    lastActivityAt: timestamp,
    lastAdminActivityAt: timestamp
  });
  ctx.saveTicketActivity();
}

function touchAdminActivity(ctx, channel, timestamp = Date.now()) {
  if (!isTrackedTicket(ctx, channel) || !isMidmanTicket(channel)) return;
  const record = ensureRecord(ctx, channel, { midman: true });
  record.lastAdminActivityAt = Number(timestamp) || Date.now();
  ctx.ticketActivity[channel.id] = record;
  ctx.saveTicketActivity();
}

async function getLatestHumanMessage(channel, sinceTimestamp = 0) {
  let before;
  let latest = null;

  for (let page = 0; page < 20; page++) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;

    for (const message of batch.values()) {
      if (message.author.bot) continue;
      if (message.createdTimestamp <= sinceTimestamp && latest) return latest;
      if (!latest || message.createdTimestamp > latest.createdTimestamp) latest = message;
    }

    const oldest = batch.last();
    if (!oldest || oldest.createdTimestamp <= sinceTimestamp || batch.size < 100) break;
    before = oldest.id;
  }

  return latest;
}

async function getLatestAdminMessage(ctx, channel, sinceTimestamp = 0) {
  let before;
  let latest = null;

  for (let page = 0; page < 20; page++) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;

    for (const message of batch.values()) {
      if (message.author.bot || !message.guild) continue;
      if (!ctx.isAdmin(message.member)) continue;
      if (message.createdTimestamp <= sinceTimestamp && latest) return latest;
      if (!latest || message.createdTimestamp > latest.createdTimestamp) latest = message;
    }

    const oldest = batch.last();
    if (!oldest || oldest.createdTimestamp <= sinceTimestamp || batch.size < 100) break;
    before = oldest.id;
  }

  return latest;
}

async function syncTicketActivity(ctx, channel) {
  if (!isTrackedTicket(ctx, channel)) return false;
  const record = ensureRecord(ctx, channel);
  let changed = false;

  if (isMidmanTicket(channel)) {
    const latestAdmin = await getLatestAdminMessage(ctx, channel, Number(record.lastAdminActivityAt) || 0);
    if (latestAdmin && latestAdmin.createdTimestamp > (Number(record.lastAdminActivityAt) || 0)) {
      record.lastAdminActivityAt = latestAdmin.createdTimestamp;
      changed = true;
    }
  } else {
    const latestHuman = await getLatestHumanMessage(channel, Number(record.lastActivityAt) || 0);
    if (latestHuman && latestHuman.createdTimestamp > (Number(record.lastActivityAt) || 0)) {
      record.lastActivityAt = latestHuman.createdTimestamp;
      changed = true;
    }
  }

  return changed;
}

async function closeInactiveTicket(ctx, channel, activity, midman) {
  if (closingTickets.has(channel.id) || activity.closing) return;
  closingTickets.add(channel.id);
  activity.closing = true;
  ctx.saveTicketActivity();

  const topic = parseTopic(channel.topic || '');
  if (topic.source && topic.clicker) locks.unlockTicket(ctx, topic.source, topic.clicker);

  const limitHours = midman ? 7 : 48;
  const lastActivity = midman ? Number(activity.lastAdminActivityAt) : Number(activity.lastActivityAt);
  const reason = midman
    ? 'tidak ada aktivitas Admin selama **7 jam**'
    : 'tidak ada aktivitas manusia selama **2 hari**';

  await ctx.sendAdminLog(
    channel.guild,
    'Tiket Otomatis Ditutup',
    `Tiket <#${channel.id}> otomatis ditutup karena ${reason}.`,
    [
      { name: 'Aktivitas Terakhir', value: lastActivity ? `<t:${Math.floor(lastActivity / 1000)}:F>` : '-', inline: true },
      { name: 'Batas Inaktivitas', value: midman ? '7 jam (aktivitas Admin)' : '2 hari (aktivitas member)', inline: true }
    ]
  );

  const embed = new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle('🔒 TIKET DITUTUP OTOMATIS')
    .setDescription(
      midman
        ? 'Tiket Midman ini otomatis ditutup karena tidak ada **aktivitas Admin selama 7 jam**.\n\n' +
          `Aktivitas Admin terakhir: ${lastActivity ? `<t:${Math.floor(lastActivity / 1000)}:F>` : 'Tidak tersedia'}\n` +
          'Silakan membuat tiket baru jika masih membutuhkan layanan Midman.'
        : 'Tiket ini otomatis ditutup karena tidak ada aktivitas manusia selama **2 hari**.\n\n' +
          `Aktivitas terakhir: ${lastActivity ? `<t:${Math.floor(lastActivity / 1000)}:F>` : 'Tidak tersedia'}\n` +
          'Silakan membuat tiket baru apabila masih membutuhkan bantuan atau transaksi.'
    )
    .setFooter({ text: `Auto Close: ${limitHours === 7 ? '7 jam tanpa aktivitas Admin' : '2 hari tanpa aktivitas member'}` })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});

  setTimeout(async () => {
    try {
      await channel.delete();
    } catch (error) {
      console.error(`[TICKET AUTO CLOSE ERROR] Gagal menghapus ${channel.id}:`, error);
      activity.closing = false;
      ctx.saveTicketActivity();
    } finally {
      closingTickets.delete(channel.id);
    }
  }, 5000);
}

async function checkTickets(ctx) {
  const now = Date.now();
  let changed = false;

  for (const [channelId, stored] of Object.entries(ctx.ticketActivity)) {
    const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !isTrackedTicket(ctx, channel)) {
      delete ctx.ticketActivity[channelId];
      changed = true;
      continue;
    }

    const current = ctx.ticketActivity[channelId];
    if (current.closing) continue;

    const midman = isMidmanTicket(channel);
    const limit = midman ? MIDMAN_INACTIVITY_MS : GENERAL_INACTIVITY_MS;
    const last = midman ? Number(current.lastAdminActivityAt) : Number(current.lastActivityAt);

    if (!last || now - last >= limit - 10 * 60 * 1000) {
      changed = (await syncTicketActivity(ctx, channel)) || changed;
    }

    const refreshed = ctx.ticketActivity[channelId];
    const refreshedLast = midman ? Number(refreshed.lastAdminActivityAt) : Number(refreshed.lastActivityAt);
    if (refreshedLast && now - refreshedLast >= limit) {
      await closeInactiveTicket(ctx, channel, refreshed, midman);
    }
  }

  if (changed) ctx.saveTicketActivity();
}

module.exports = {
  register(ctx) {
    ctx.client.on('channelCreate', async channel => {
      if (!isTrackedTicket(ctx, channel)) return;
      ensureRecord(ctx, channel);
      ctx.saveTicketActivity();
    });

    ctx.client.on('messageCreate', message => {
      if (message.author.bot || !message.guild || !isTrackedTicket(ctx, message.channel)) return;
      if (isMidmanTicket(message.channel)) {
        if (ctx.isAdmin(message.member)) {
          touchAdminActivity(ctx, message.channel, message.createdTimestamp);
        }
        return;
      }

      const record = ensureRecord(ctx, message.channel, { lastActivityAt: message.createdTimestamp });
      record.lastActivityAt = message.createdTimestamp;
      ctx.ticketActivity[message.channel.id] = record;
      ctx.saveTicketActivity();
    });

    ctx.client.on('channelDelete', channel => {
      if (ctx.ticketActivity?.[channel.id]) {
        delete ctx.ticketActivity[channel.id];
        ctx.saveTicketActivity();
      }
      closingTickets.delete(channel.id);
    });
  },

  async onReady(ctx) {
    await locks.cleanupMissingTickets(ctx);

    for (const guild of ctx.client.guilds.cache.values()) {
      const channels = await guild.channels.fetch().catch(() => null);
      if (!channels) continue;
      for (const channel of channels.values()) {
        if (isTrackedTicket(ctx, channel)) {
          await syncTicketActivity(ctx, channel);
        }
      }
    }

    ctx.saveTicketActivity();
    await checkTickets(ctx);
    setInterval(() => {
      checkTickets(ctx).catch(error => console.error('[TICKET INACTIVITY ERROR]', error));
    }, CHECK_INTERVAL_MS);
  },

  markMidmanTicket,
  touchAdminActivity,
  isMidmanTicket,
  GENERAL_INACTIVITY_MS,
  MIDMAN_INACTIVITY_MS
};
