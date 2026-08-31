const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config');

function isAdmin(member) {
  return Boolean(member?.roles?.cache.has(config.ADMIN_ROLE_ID) || member?.permissions?.has(PermissionFlagsBits.Administrator));
}

async function sendAdminLog(ctx, guild, title, description, fields = [], executor = null) {
  try {
    const channel = await ctx.client.channels.fetch(config.ADMIN_LOGS_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const embed = new EmbedBuilder().setColor(0x34495E).setTitle(`📜 [SERVER LOG] ${title}`).setDescription(description).setTimestamp();
    if (executor) {
      embed.setAuthor({ name: executor.tag, iconURL: executor.displayAvatarURL({ dynamic: true }) });
      embed.setFooter({ text: `ID Admin/User: ${executor.id}` });
    }
    if (fields.length) embed.addFields(fields);
    await channel.send({ embeds: [embed] }).catch(() => {});
  } catch (error) {
    console.error('[ADMIN LOG ERROR]', error);
  }
}

async function getOnlineAdmins(ctx, guild) {
  if (!guild) return [];
  await guild.members.fetch({ withPresences: true }).catch(() => {});
  const role = await guild.roles.fetch(config.ADMIN_ROLE_ID).catch(() => null);
  if (!role) return [];
  return guild.members.cache.filter(member => member.roles.cache.has(config.ADMIN_ROLE_ID) && ['online','idle','dnd'].includes(member.presence?.status || 'offline')).map(member => member);
}

function formatWIB(date = new Date()) {
  return date.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
}

module.exports = { isAdmin, sendAdminLog, getOnlineAdmins, formatWIB };
