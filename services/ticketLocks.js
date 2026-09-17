function lockKey(sourceMessageId, userId) {
  return `${sourceMessageId}:${userId}`;
}

function getChannelId(value) {
  return typeof value === 'string' ? value : value?.channelId || null;
}

function isDiscordCode(error, code) {
  return String(error?.code || error?.status || '') === String(code);
}

function hasActiveTicket(ctx, sourceMessageId, userId) {
  return Boolean(getChannelId(ctx.storeTicketLocks[lockKey(sourceMessageId, userId)]));
}

function getActiveTicket(ctx, sourceMessageId, userId) {
  return getChannelId(ctx.storeTicketLocks[lockKey(sourceMessageId, userId)]);
}

function lockTicket(ctx, sourceMessageId, userId, ticketChannelId) {
  ctx.storeTicketLocks[lockKey(sourceMessageId, userId)] = ticketChannelId;
  ctx.saveStoreTicketLocks();
}

function unlockTicket(ctx, sourceMessageId, userId) {
  const key = lockKey(sourceMessageId, userId);
  if (!ctx.storeTicketLocks[key]) return;
  delete ctx.storeTicketLocks[key];
  ctx.saveStoreTicketLocks();
}

function unlockByTicketChannel(ctx, ticketChannelId) {
  let changed = false;
  for (const [key, value] of Object.entries(ctx.storeTicketLocks)) {
    if (getChannelId(value) === ticketChannelId) {
      delete ctx.storeTicketLocks[key];
      changed = true;
    }
  }
  if (changed) ctx.saveStoreTicketLocks();
}

async function cleanupMissingTickets(ctx) {
  let changed = false;
  for (const [key, value] of Object.entries(ctx.storeTicketLocks)) {
    const channelId = getChannelId(value);
    if (!channelId) {
      delete ctx.storeTicketLocks[key];
      changed = true;
      continue;
    }

    try {
      await ctx.client.channels.fetch(channelId);
    } catch (error) {
      if (isDiscordCode(error, 10003)) {
        delete ctx.storeTicketLocks[key];
        changed = true;
      } else {
        console.error(`[TICKET LOCKS] Tidak dapat memastikan channel ${channelId}; lock dipertahankan:`, error?.message || error);
      }
    }
  }

  if (changed) ctx.saveStoreTicketLocks();
}

module.exports = {
  hasActiveTicket,
  getActiveTicket,
  lockTicket,
  unlockTicket,
  unlockByTicketChannel,
  cleanupMissingTickets
};
