const POST_TYPES = new Set(['STORE_FORWARD', 'ADMIN_SELLING']);
const CLEANUP_LOCK = new Set();

function getStoreCategoryIds(ctx) {
  return new Set([
    ctx.config.STORE_CATEGORY_ID,
    ...(Array.isArray(ctx.config.EXTRA_STORE_CATEGORY_IDS) ? ctx.config.EXTRA_STORE_CATEGORY_IDS : [])
  ].filter(Boolean));
}

function isTrackedPost(data) {
  return Boolean(data && POST_TYPES.has(data.type) && data.authorId);
}

function isSameGuild(data, guildId) {
  return !data.guildId || String(data.guildId) === String(guildId);
}

async function backfillLegacyPostLocations(ctx) {
  const legacyIds = new Set();
  for (const [messageId, data] of ctx.messageStore.entries()) {
    if (isTrackedPost(data) && (!data.guildId || !data.channelId)) legacyIds.add(messageId);
  }
  if (!legacyIds.size) return;

  const candidateChannels = new Set();
  for (const guild of ctx.client.guilds.cache.values()) {
    const channels = await guild.channels.fetch().catch(() => null);
    if (!channels) continue;
    for (const channel of channels.values()) {
      if (!channel?.isTextBased?.()) continue;
      if (channel.id === ctx.config.ADMIN_SELLING_CHANNEL_ID || getStoreCategoryIds(ctx).has(channel.parentId)) {
        candidateChannels.add(channel);
      }
    }
  }

  for (const channel of candidateChannels) {
    let before;
    while (legacyIds.size) {
      const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
      if (!batch?.size) break;

      for (const message of batch.values()) {
        if (!legacyIds.has(message.id)) continue;
        const data = ctx.messageStore.get(message.id);
        if (!data) continue;
        data.guildId = message.guildId;
        data.channelId = message.channelId;
        ctx.messageStore.set(message.id, data);
        legacyIds.delete(message.id);
      }

      if (batch.size < 100) break;
      before = batch.last().id;
    }
  }

  if (legacyIds.size) {
    console.warn(`[OWNER CLEANUP] ${legacyIds.size} posting lama belum dapat dipetakan ke channel. Posting tersebut tidak akan dihapus otomatis sampai metadata channel tersedia.`);
  }
  ctx.saveMessageStore();
}

function isDiscordCode(error, code) {
  return String(error?.code || error?.status || '') === String(code);
}

async function fetchMemberSafely(guild, userId) {
  try {
    return { member: await guild.members.fetch(userId), definitiveMissing: false, error: null };
  } catch (error) {
    return { member: null, definitiveMissing: isDiscordCode(error, 10007), error };
  }
}

async function removeUserPosts(ctx, guild, userId, reason = 'Member keluar dari server') {
  const key = `${guild.id}:${userId}`;
  if (CLEANUP_LOCK.has(key)) return 0;
  CLEANUP_LOCK.add(key);

  let removed = 0;
  let changed = false;
  try {
    for (const [messageId, data] of ctx.messageStore.entries()) {
      if (!isTrackedPost(data)) continue;
      if (String(data.authorId) !== String(userId)) continue;
      if (!isSameGuild(data, guild.id)) continue;

      if (!data.channelId) {
        // Metadata lokasi tidak tersedia: jangan menebak dan jangan menghapus.
        continue;
      }

      let channel;
      try {
        channel = await ctx.client.channels.fetch(data.channelId);
      } catch (error) {
        if (isDiscordCode(error, 10003)) {
          // Channel memang sudah dihapus, jadi record orphan aman dibersihkan.
          ctx.messageStore.delete(messageId);
          changed = true;
          removed++;
        } else {
          console.error(`[OWNER CLEANUP] Gagal fetch channel ${data.channelId} untuk posting ${messageId}:`, error?.message || error);
        }
        continue;
      }

      if (!channel?.isTextBased?.()) continue;

      let storedMessage;
      try {
        storedMessage = await channel.messages.fetch(messageId);
      } catch (error) {
        if (isDiscordCode(error, 10008)) {
          // Message memang sudah tidak ada.
          ctx.messageStore.delete(messageId);
          changed = true;
          removed++;
        } else {
          console.error(`[OWNER CLEANUP] Gagal fetch posting ${messageId}:`, error?.message || error);
        }
        continue;
      }

      try {
        await storedMessage.delete();
        ctx.messageStore.delete(messageId);
        changed = true;
        removed++;
      } catch (error) {
        // Permission/API error: record tetap dipertahankan supaya tidak hilang dari database.
        console.error(`[OWNER CLEANUP] Gagal menghapus posting ${messageId}:`, error?.message || error);
      }
    }

    if (changed) ctx.saveMessageStore();

    if (removed > 0) {
      await ctx.sendAdminLog(
        guild,
        'Posting Member Dihapus Otomatis',
        `Sebanyak **${removed} posting** milik member <@${userId}> telah dihapus karena ${reason}.`,
        [
          { name: 'Member', value: `<@${userId}>`, inline: true },
          { name: 'Total Posting Dihapus', value: String(removed), inline: true }
        ]
      );
    }

    return removed;
  } finally {
    CLEANUP_LOCK.delete(key);
  }
}

module.exports = {
  register(ctx) {
    ctx.client.on('guildMemberRemove', async member => {
      try {
        await removeUserPosts(ctx, member.guild, member.id);
      } catch (error) {
        console.error(`[OWNER CLEANUP ERROR] Gagal membersihkan posting ${member.id}:`, error);
      }
    });
  },

  async onReady(ctx) {
    // Backfill metadata untuk posting lama yang dibuat sebelum fitur ini aktif.
    await backfillLegacyPostLocations(ctx);

    // Menangani kasus member keluar ketika bot sedang offline/restart.
    for (const guild of ctx.client.guilds.cache.values()) {
      const owners = new Set();
      for (const data of ctx.messageStore.values()) {
        if (isTrackedPost(data) && isSameGuild(data, guild.id)) owners.add(String(data.authorId));
      }

      for (const ownerId of owners) {
        const result = await fetchMemberSafely(guild, ownerId);
        if (result.definitiveMissing) {
          await removeUserPosts(ctx, guild, ownerId, 'member sudah tidak berada di server saat bot kembali online');
        } else if (result.error) {
          console.error(`[OWNER CLEANUP] Tidak dapat memastikan status member ${ownerId}; cleanup dilewati:`, result.error?.message || result.error);
        }
      }
    }
  }
};
