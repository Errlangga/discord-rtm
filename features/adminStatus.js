const { EmbedBuilder } = require('discord.js');

async function updateAdminStatusMessage(ctx, forceResend = false) {
  try {
    const channel = await ctx.client.channels.fetch(ctx.config.ADMIN_STATUS_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const guild = channel.guild;
    await guild.members.fetch({ withPresences: true }).catch(() => {});
    const role = await guild.roles.fetch(ctx.config.ADMIN_ROLE_ID).catch(() => null);
    if (!role) return;
    const admins = guild.members.cache.filter(m => m.roles.cache.has(ctx.config.ADMIN_ROLE_ID));
    let list = '';
    let online = 0;
    let offline = 0;
    admins.forEach(member => {
      const status = member.presence?.status || 'offline';
      if (['online','idle','dnd'].includes(status)) {
        online++;
        const label = status === 'dnd' ? 'Do Not Disturb' : status === 'idle' ? 'Idle' : 'Online';
        list += `🟢 **${member.user.tag}** — *${label}*\n`;
      } else { offline++; list += `🔴 **${member.user.tag}** — *Offline*\n`; }
    });
    if (!admins.size) list = '_Tidak ada admin yang ditemukan dengan role ini._';
    const open = online > 0;
    const embed = new EmbedBuilder().setColor(open ? 0x00FF00 : 0xFF0000)
      .setTitle(`${open ? '🟢' : '🔴'} STATUS INFORMASI ADMIN STORE WARUNG ${open ? '🟢' : '🔴'}`)
      .setDescription(`Berikut adalah pembaruan status real-time dari seluruh Staff Admin Store Warung.\n\n📊 **Ringkasan Status:**\n• Total Admin: **${admins.size} Orang**\n• Admin Online: **${online} Orang**\n• Admin Offline: **${offline} Orang**\n• Kondisi Toko: **${open ? 'STORE OPEN / ADMIN ONLINE' : 'STORE CLOSED / ADMIN OFFLINE'}**\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👥 **Daftar Detail Admin:**\n${list}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
      .setTimestamp().setFooter({ text: 'Sistem Otomatis Store Warung • Diperbarui setiap 30 detik', iconURL: guild.iconURL() });
    const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    const current = messages?.find(m => m.author.id === ctx.client.user.id && m.embeds[0]?.title?.includes('STATUS INFORMASI ADMIN'));
    if (forceResend && current) { await current.delete().catch(() => {}); await channel.send({ embeds: [embed] }); }
    else if (current) await current.edit({ embeds: [embed] });
    else await channel.send({ embeds: [embed] });
  } catch (e) { console.error('[STATUS ADMIN ERROR]', e); }
}

module.exports = {
  register(ctx) {},
  async onReady(ctx) {
    await updateAdminStatusMessage(ctx);
    setInterval(() => updateAdminStatusMessage(ctx), 30000);
  },
  updateAdminStatusMessage
};
