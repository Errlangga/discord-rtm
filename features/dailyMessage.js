const { REST, Routes, SlashCommandBuilder, MessageFlags } = require('discord.js');

async function sendDailyMessage(ctx, slot) {
  const data = ctx.dailyStore[slot];
  if (!data || (!data.content && !data.image)) return;
  try {
    const channel = await ctx.client.channels.fetch(ctx.config.DAILY_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const payload = {};
    if (data.content) payload.content = data.content;
    if (data.image) payload.files = [data.image];
    await channel.send(payload);
    console.log(`[DAILY MESSAGE] ${slot} WIB berhasil dikirim.`);
  } catch (e) { console.error('[DAILY MESSAGE ERROR]', e); }
}

function checkScheduler(ctx) {
  const now = new Date();
  const time = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false });
  const date = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  if (!['05:00','12:00','20:00'].includes(time)) return;
  if (ctx.lastSentDaily[time] === date) return;
  ctx.lastSentDaily[time] = date;
  sendDailyMessage(ctx, time);
}

async function registerSlashCommands(ctx) {
  const commands = [new SlashCommandBuilder().setName('setdailymessage').setDescription('Mengatur pesan harian otomatis (Khusus Admin)')
    .addStringOption(o => o.setName('waktu').setDescription('Pilih jam pengiriman (WIB)').setRequired(true).addChoices({name:'05:00 WIB (Pagi)',value:'05:00'},{name:'12:00 WIB (Siang)',value:'12:00'},{name:'20:00 WIB (Malam)',value:'20:00'}))
    .addStringOption(o => o.setName('pesan').setDescription('Isi pesan yang akan dikirim otomatis').setRequired(true))
    .addAttachmentOption(o => o.setName('gambar').setDescription('Lampirkan gambar jika ada (opsional)').setRequired(false))].map(c => c.toJSON());
  const rest = new REST({ version: '10' }).setToken(ctx.client.token);
  await rest.put(Routes.applicationCommands(ctx.client.user.id), { body: commands });
  for (const guildId of ctx.client.guilds.cache.map(g => g.id)) await rest.put(Routes.applicationGuildCommands(ctx.client.user.id, guildId), { body: commands });
}

module.exports = {
  register(ctx) {
    ctx.client.on('interactionCreate', async interaction => {
      if (!interaction.isChatInputCommand() || interaction.commandName !== 'setdailymessage') return;
      if (!ctx.isAdmin(interaction.member)) return interaction.reply({ content: '❌ Hanya Admin yang memiliki akses untuk mengatur pesan harian.', flags: [MessageFlags.Ephemeral] });
      const timeInput = interaction.options.getString('waktu');
      const msgContent = interaction.options.getString('pesan');
      const attachment = interaction.options.getAttachment('gambar');
      ctx.dailyStore[timeInput] = { content: msgContent, image: attachment?.url || null, setBy: interaction.user.id, updatedAt: new Date().toISOString() };
      ctx.saveDailyStore();
      await ctx.sendAdminLog(interaction.guild, 'Pengaturan Daily Message Diperbarui (Via Slash)', `Admin <@${interaction.user.id}> memperbarui pesan harian jadwal **${timeInput} WIB**.`, [], interaction.user);
      return interaction.reply({ content: `✅ **Berhasil menyimpan Daily Message!** Pesan untuk jadwal **${timeInput} WIB** telah diperbarui.`, flags: [MessageFlags.Ephemeral] });
    });
    ctx.client.on('messageCreate', async message => {
      if (message.author.bot || !message.guild || !message.content.startsWith('!setdailymessage')) return;
      if (!ctx.isAdmin(message.member)) return message.reply('❌ Hanya Admin yang memiliki akses untuk mengatur pesan harian.').catch(() => {});
      const args = message.content.slice('!setdailymessage'.length).trim(); const idx = args.search(/\s/); const time = idx === -1 ? args : args.slice(0, idx).trim(); const content = idx === -1 ? '' : args.slice(idx).trim();
      if (!['05:00','12:00','20:00'].includes(time)) return message.reply('❌ **Format waktu tidak valid!** Gunakan `05:00`, `12:00`, atau `20:00` WIB.').catch(() => {});
      const image = message.attachments.first()?.url || null;
      if (!content && !image) return message.reply('❌ Harap masukkan teks pesan atau lampirkan gambar.').catch(() => {});
      ctx.dailyStore[time] = { content, image, setBy: message.author.id, updatedAt: new Date().toISOString() }; ctx.saveDailyStore();
      await ctx.sendAdminLog(message.guild, 'Pengaturan Daily Message Diperbarui (Via Prefix)', `Admin <@${message.author.id}> memperbarui pesan harian jadwal **${time} WIB**.`, [], message.author);
      return message.reply(`✅ **Berhasil menyimpan Daily Message!** Pesan untuk jadwal **${time} WIB** telah diperbarui.`).catch(() => {});
    });
  },
  async onReady(ctx) {
    try { await registerSlashCommands(ctx); } catch (e) { console.error('[SLASH COMMANDS ERROR]', e); }
    setInterval(() => checkScheduler(ctx), 15000);
  },
  sendDailyMessage
};
