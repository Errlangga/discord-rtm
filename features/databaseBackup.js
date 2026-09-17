const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');

const CHECK_INTERVAL_MS = 30 * 1000;
const SAFE_MAX_ATTACHMENT_BYTES = 19 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const backupInFlight = new Set();

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWriteJson(file, data) {
  const tempFile = `${file}.tmp`;
  ensureDirectory(path.dirname(file));
  try {
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempFile, file);
    return true;
  } catch (error) {
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
    console.error('[DATABASE BACKUP] Gagal menyimpan konfigurasi backup:', error);
    return false;
  }
}

function getConfigFile(ctx) {
  return path.join(ctx.baseDir, ctx.config.DATABASE_BACKUP_CONFIG_FILE || 'database_backup_config.json');
}

function loadBackupConfig(ctx) {
  const file = getConfigFile(ctx);
  try {
    if (!fs.existsSync(file)) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch (error) {
    console.error('[DATABASE BACKUP] Gagal membaca konfigurasi backup:', error);
    return {};
  }
}

function saveBackupConfig(ctx, data) {
  return atomicWriteJson(getConfigFile(ctx), data);
}

function getBackupChannelId(ctx) {
  const persisted = loadBackupConfig(ctx);
  return String(persisted.channelId || ctx.config.DATABASE_BACKUP_CHANNEL_ID || '').trim() || null;
}

function getWibParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);

  const result = {};
  for (const part of parts) {
    if (part.type !== 'literal') result[part.type] = part.value;
  }
  return result;
}

function getTodayKeyWIB(date = new Date()) {
  const p = getWibParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function getBackupFooterKey(dateKey) {
  return `DB-BACKUP:${dateKey}`;
}

function parseBackupTime(value) {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(String(value || ''));
  if (!match) return { hour: 3, minute: 0 };
  const [hour, minute] = value.split(':').map(Number);
  return { hour, minute };
}

function isScheduledTimeReached(ctx, date = new Date()) {
  const parts = getWibParts(date);
  const schedule = parseBackupTime(ctx.config.DATABASE_BACKUP_TIME_WIB);
  const nowMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const scheduledMinutes = schedule.hour * 60 + schedule.minute;
  return nowMinutes >= scheduledMinutes;
}

function listDatabaseFiles(baseDir) {
  ensureDirectory(baseDir);
  return fs.readdirSync(baseDir)
    .filter(name => name.toLowerCase().endsWith('.json'))
    .map(name => {
      const fullPath = path.join(baseDir, name);
      try {
        return { name, fullPath, stat: fs.statSync(fullPath) };
      } catch {
        return null;
      }
    })
    .filter(entry => entry?.stat?.isFile())
    .sort((a, b) => a.name.localeCompare(b.name));
}

function prepareAttachment(entry) {
  if (entry.stat.size <= SAFE_MAX_ATTACHMENT_BYTES) {
    return { attachment: entry.fullPath, name: entry.name, compressed: false };
  }

  try {
    const compressed = zlib.gzipSync(fs.readFileSync(entry.fullPath), { level: 9 });
    if (compressed.length <= SAFE_MAX_ATTACHMENT_BYTES) {
      return { attachment: compressed, name: `${entry.name}.gz`, compressed: true };
    }
  } catch (error) {
    console.error(`[DATABASE BACKUP] Gagal mengompres ${entry.name}:`, error);
  }

  return {
    skipped: true,
    name: entry.name,
    size: entry.stat.size
  };
}

async function findExistingBackupForDate(channel, clientUserId, dateKey) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return false;
  const footerKey = getBackupFooterKey(dateKey);
  return messages.some(message =>
    message.author?.id === clientUserId &&
    message.embeds?.some(embed => embed.footer?.text === footerKey)
  );
}

function buildBackupEmbed(dateKey, files, skippedFiles, part, totalParts) {
  const uploaded = files.length;
  const skipped = skippedFiles.length;
  const description = [
    `Database backup otomatis untuk tanggal **${dateKey} WIB**.`,
    uploaded ? `📦 File dikirim: **${uploaded}**.` : '⚠️ Tidak ada file database yang berhasil diunggah.',
    skipped ? `❗ File terlalu besar untuk dikirim: **${skipped}**.` : null,
    totalParts > 1 ? `📑 Bagian: **${part}/${totalParts}**.` : null
  ].filter(Boolean).join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle('💾 DATABASE BACKUP')
    .setDescription(description)
    .addFields({ name: 'Ukuran Aman Per File', value: '19 MiB', inline: true })
    .setTimestamp()
    .setFooter({ text: getBackupFooterKey(dateKey) });

  if (skipped) {
    embed.addFields({
      name: 'File yang Tidak Terkirim',
      value: skippedFiles.map(file => `• ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MiB)`).join('\n').slice(0, 1024)
    });
  }

  return embed;
}

async function performBackup(ctx, dateKey = getTodayKeyWIB()) {
  const channelId = getBackupChannelId(ctx);
  if (!channelId) {
    console.warn('[DATABASE BACKUP] Channel backup belum diset. Gunakan !setbackupchannel <channelId>.');
    return false;
  }

  const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.error(`[DATABASE BACKUP] Channel ${channelId} tidak ditemukan atau bukan text channel.`);
    return false;
  }

  if (channel.guild && ctx.client.user) {
    const permissions = channel.permissionsFor(ctx.client.user);
    if (permissions && !permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles])) {
      console.error(`[DATABASE BACKUP] Bot tidak memiliki permission yang diperlukan di channel ${channelId}.`);
      return false;
    }
  }

  if (await findExistingBackupForDate(channel, ctx.client.user.id, dateKey)) {
    console.log(`[DATABASE BACKUP] Backup ${dateKey} sudah ada, dilewati.`);
    return true;
  }

  const entries = listDatabaseFiles(ctx.baseDir);
  if (!entries.length) {
    await channel.send({ embeds: [buildBackupEmbed(dateKey, [], [], 1, 1)] });
    return true;
  }

  const prepared = entries.map(prepareAttachment);
  const attachments = prepared.filter(item => !item.skipped);
  const skippedFiles = prepared.filter(item => item.skipped);
  const totalParts = Math.max(1, Math.ceil(attachments.length / MAX_ATTACHMENTS_PER_MESSAGE));

  if (!attachments.length) {
    await channel.send({ embeds: [buildBackupEmbed(dateKey, [], skippedFiles, 1, 1)] });
    return true;
  }

  for (let index = 0; index < attachments.length; index += MAX_ATTACHMENTS_PER_MESSAGE) {
    const part = Math.floor(index / MAX_ATTACHMENTS_PER_MESSAGE) + 1;
    const chunk = attachments.slice(index, index + MAX_ATTACHMENTS_PER_MESSAGE);
    await channel.send({
      embeds: [buildBackupEmbed(dateKey, chunk, skippedFiles, part, totalParts)],
      files: chunk.map(file => ({ attachment: file.attachment, name: file.name }))
    });
  }

  console.log(`[DATABASE BACKUP] Backup ${dateKey} berhasil dikirim ke #${channel.name || channel.id}.`);
  return true;
}

async function runScheduledBackup(ctx) {
  const dateKey = getTodayKeyWIB();
  if (!isScheduledTimeReached(ctx)) return;
  if (ctx.databaseBackupLastRunDate === dateKey) return;
  if (backupInFlight.has(dateKey)) return;

  backupInFlight.add(dateKey);
  try {
    const success = await performBackup(ctx, dateKey);
    if (success) ctx.databaseBackupLastRunDate = dateKey;
  } catch (error) {
    console.error('[DATABASE BACKUP ERROR]', error);
  } finally {
    backupInFlight.delete(dateKey);
  }
}

module.exports = {
  register(ctx) {
    ctx.client.on('messageCreate', async message => {
      if (message.author.bot || !message.guild) return;
      if (!/^!setbackupchannel(?:\s|$)/i.test(message.content)) return;
      if (!ctx.isAdmin(message.member)) {
        await message.reply('❌ Hanya Admin yang dapat mengatur channel backup database.').catch(() => {});
        return;
      }

      const args = message.content.trim().split(/\s+/).slice(1);
      const input = args[0];
      if (!input) {
        await message.reply('❌ Format: `!setbackupchannel <channelId>` atau mention channel seperti `!setbackupchannel #backup`.').catch(() => {});
        return;
      }

      if (input.toLowerCase() === 'off') {
        saveBackupConfig(ctx, { channelId: null, updatedAt: new Date().toISOString(), updatedBy: message.author.id });
        await message.reply('✅ Backup database otomatis dinonaktifkan.').catch(() => {});
        return;
      }

      const mentioned = message.mentions.channels.first();
      const channelId = mentioned?.id || input.replace(/[<#>]/g, '');
      if (!/^\d{15,25}$/.test(channelId)) {
        await message.reply('❌ Channel ID tidak valid.').catch(() => {});
        return;
      }

      const channel = await message.guild.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        await message.reply('❌ Channel tidak ditemukan atau bukan text channel di server ini.').catch(() => {});
        return;
      }

      if (!saveBackupConfig(ctx, { channelId, updatedAt: new Date().toISOString(), updatedBy: message.author.id })) {
        await message.reply('❌ Gagal menyimpan konfigurasi backup ke volume.').catch(() => {});
        return;
      }

      await message.reply(`✅ Channel backup database diatur ke <#${channelId}>.`).catch(() => {});
    });

    ctx.client.on('messageCreate', async message => {
      if (message.author.bot || !message.guild || !/^!backupdb$/i.test(message.content.trim())) return;
      if (!ctx.isAdmin(message.member)) {
        await message.reply('❌ Hanya Admin yang dapat menjalankan backup database manual.').catch(() => {});
        return;
      }

      await message.reply('⏳ Menjalankan backup database sekarang...').catch(() => {});
      const success = await performBackup(ctx, getTodayKeyWIB());
      if (!success) {
        await message.reply('❌ Backup database gagal. Cek log bot dan permission channel backup.').catch(() => {});
      }
    });
  },

  async onReady(ctx) {
    console.log(`[DATABASE BACKUP] Jadwal otomatis: ${ctx.config.DATABASE_BACKUP_TIME_WIB || '03:00'} WIB.`);
    if (!getBackupChannelId(ctx)) {
      console.warn('[DATABASE BACKUP] Belum ada channel backup. Atur dengan !setbackupchannel <channelId>.');
    } else {
      await runScheduledBackup(ctx);
    }

    setInterval(() => {
      runScheduledBackup(ctx).catch(error => console.error('[DATABASE BACKUP SCHEDULER ERROR]', error));
    }, CHECK_INTERVAL_MS);
  },

  performBackup
};
