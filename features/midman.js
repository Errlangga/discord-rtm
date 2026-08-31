const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags
} = require('discord.js');

const ticketLocks = require('../services/ticketLocks');
const ticketInactivity = require('./ticketInactivity');

function buildMidmanModal(customId = 'modal_midman_create') {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle('Form Order Midman')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('m_nama').setLabel('Nama Tiket').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('m_produk').setLabel('Nama Produk').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('m_harga').setLabel('Harga Produk').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('m_opsi').setLabel('Opsi (Ex/Inc)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30)
      )
    );
}

function safeTicketName(value, fallbackId) {
  const base = String(value || '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
  return (`ticket-${base || fallbackId.slice(-6)}`).slice(0, 90);
}

async function createDirectMidmanTicket(ctx, interaction, values) {
  const [ticketName, product, price, fee] = values;
  const onlineAdmins = await ctx.getOnlineAdmins(interaction.guild);
  const adminTags = onlineAdmins.map(member => `<@${member.id}>`).join(' ');
  const adminNotice = adminTags || 'Tidak ada Admin yang sedang online. Admin akan menangani tiket saat tersedia.';

  const channel = await interaction.guild.channels.create({
    name: safeTicketName(ticketName, interaction.user.id),
    type: ChannelType.GuildText,
    parent: ctx.config.MIDMAN_CATEGORY_ID,
    topic: `JASHER_TICKET:1|CreatorID:${interaction.user.id}|Type:MIDMAN`,
    permissionOverwrites: [
      { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: ctx.config.ADMIN_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
    ]
  });

  ticketInactivity.markMidmanTicket(ctx, channel, Date.now());

  const embed = new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle('🎫 TIKET TRANSAKSI MIDMAN')
    .setDescription(
      `Halo <@${interaction.user.id}>, tiket transaksi Midman berhasil dibuat.\n\n` +
      `📦 **Informasi Transaksi:**\n` +
      `> **Nama Tiket:** ${ticketName}\n` +
      `> **Produk:** ${product}\n` +
      `> **Harga:** ${price}\n` +
      `> **Opsi Fee:** ${fee}\n\n` +
      `👥 **Status Admin:** ${adminTags ? 'Ada Admin online.' : 'Belum ada Admin online.'}\n` +
      `⏱️ Jika tidak ada **aktivitas Admin** selama **${ctx.config.MIDMAN_INACTIVITY_HOURS || 7} jam**, tiket akan tertutup otomatis.\n` +
      `✅ Setiap pesan dari Admin akan mereset timer tersebut.`
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_ticket_close').setLabel('Close Tiket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('btn_ticket_add_member').setLabel('Add Member').setEmoji('👥').setStyle(ButtonStyle.Secondary)
  );

  await channel.send({
    content: `**Notifikasi Midman:** <@${interaction.user.id}> | ${adminNotice}`,
    allowedMentions: { users: [interaction.user.id, ...onlineAdmins.map(member => member.id)] },
    embeds: [embed],
    components: [row]
  });

  await ctx.sendAdminLog(
    interaction.guild,
    'Tiket Midman Baru',
    `Pengguna <@${interaction.user.id}> membuat tiket transaksi Midman: <#${channel.id}>.`,
    [
      { name: 'Produk', value: product, inline: true },
      { name: 'Harga', value: price, inline: true },
      { name: 'Opsi Fee', value: fee, inline: true },
      { name: 'Admin Online Saat Dibuat', value: onlineAdmins.length ? `${onlineAdmins.length} orang` : 'Tidak ada', inline: true }
    ],
    interaction.user
  );

  return channel;
}

module.exports = {
  register(ctx) {
    ctx.client.on('interactionCreate', async interaction => {
      try {
        const admin = ctx.isAdmin(interaction.member);

        if (interaction.isButton() && interaction.customId === 'btn_midman_order') {
          // Ticket Midman sekarang boleh dibuat walaupun tidak ada Admin online.
          return interaction.showModal(buildMidmanModal());
        }

        if (interaction.isButton() && interaction.customId === 'btn_ticket_close') {
          const topic = interaction.channel?.topic || '';
          const creator = topic.match(/CreatorID:(\d+)/)?.[1] || null;
          if (!topic.includes('JASHER_TICKET:1')) {
            return interaction.reply({ content: '❌ Channel ini bukan tiket Jasher yang valid.', flags: [MessageFlags.Ephemeral] });
          }
          if (interaction.user.id !== creator && !admin) {
            return interaction.reply({ content: '❌ Anda tidak memiliki hak untuk menutup tiket ini.', flags: [MessageFlags.Ephemeral] });
          }

          const source = topic.match(/SourceMessageID:(\d+)/)?.[1] || null;
          const clicker = topic.match(/StoreClickerID:(\d+)/)?.[1] || null;
          if (source && clicker) ticketLocks.unlockTicket(ctx, source, clicker);

          await ctx.sendAdminLog(
            interaction.guild,
            'Penutupan Tiket',
            `Channel tiket \`${interaction.channel.name}\` ditutup oleh <@${interaction.user.id}>.`,
            [],
            interaction.user
          );

          await interaction.reply({ content: '🔒 **Tiket sedang ditutup.** Channel ini akan dihapus secara otomatis dalam 5 detik.' });
          setTimeout(() => interaction.channel?.delete().catch(() => {}), 5000);
          return;
        }

        if (interaction.isButton() && interaction.customId === 'btn_ticket_add_member') {
          if (!admin) return interaction.reply({ content: '❌ Hanya Admin yang dapat menambahkan member lain ke dalam tiket ini.', flags: [MessageFlags.Ephemeral] });
          return interaction.showModal(
            new ModalBuilder()
              .setCustomId('modal_ticket_add_member')
              .setTitle('Tambah Member Ke Tiket')
              .addComponents(
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder().setCustomId('u_id').setLabel('User ID Member').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30)
                )
              )
          );
        }

        if (interaction.isModalSubmit() && interaction.customId === 'modal_midman_create') {
          const values = ['m_nama', 'm_produk', 'm_harga', 'm_opsi'].map(key => interaction.fields.getTextInputValue(key).trim());
          await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
          try {
            const channel = await createDirectMidmanTicket(ctx, interaction, values);
            return interaction.editReply(`✅ Tiket Midman berhasil dibuat: <#${channel.id}>`);
          } catch (error) {
            console.error('[MIDMAN CREATE ERROR]', error);
            return interaction.editReply('❌ Terjadi kesalahan saat membuat tiket Midman.');
          }
        }

        if (interaction.isModalSubmit() && interaction.customId === 'modal_ticket_add_member') {
          const id = interaction.fields.getTextInputValue('u_id').trim();
          try {
            await ctx.client.users.fetch(id);
            await interaction.channel.permissionOverwrites.create(id, {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true
            });
            return interaction.reply({ content: `✅ Pengguna <@${id}> berhasil ditambahkan ke tiket.` });
          } catch (error) {
            return interaction.reply({ content: '❌ ID pengguna tidak valid atau tidak ditemukan.', flags: [MessageFlags.Ephemeral] });
          }
        }
      } catch (error) {
        console.error('[MIDMAN INTERACTION ERROR]', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '⚠️ Terjadi kesalahan saat memproses tiket Midman.', flags: [MessageFlags.Ephemeral] }).catch(() => {});
        }
      }
    });
  },

  async onReady(ctx) {
    const channel = await ctx.client.channels.fetch(ctx.config.MIDMAN_BASE_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const recent = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    const existing = recent?.find(
      message => message.author.id === ctx.client.user.id && message.embeds[0]?.title?.includes('PUSAT LAYANAN MIDMAN')
    );

    const embed = new EmbedBuilder()
      .setColor(0x2B2D31)
      .setTitle('🛡️ PUSAT LAYANAN MIDMAN & BANTUAN ADMIN 🛡️')
      .setDescription(
        'Selamat datang di Pusat Layanan Store!\n\n' +
        '🤝 **Order Midman**\n' +
        '> Buat tiket transaksi aman meskipun Admin sedang offline.\n' +
        '> Jika belum ada aktivitas Admin selama **7 jam**, tiket akan tertutup otomatis.\n\n' +
        '❓ **Tanya Admin**\n' +
        '> Kirim pertanyaan atau keluhan ke tim Admin.'
      )
      .setFooter({ text: 'Sistem Tiket & Bantuan Otomatis' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('btn_midman_order').setLabel('Order Midman').setEmoji('🤝').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('btn_tanya_admin').setLabel('Tanya Admin').setEmoji('❓').setStyle(ButtonStyle.Primary)
    );

    if (existing) await existing.edit({ embeds: [embed], components: [row] });
    else await channel.send({ embeds: [embed], components: [row] });
  }
};
