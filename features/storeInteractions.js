const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');
const locks = require('../services/ticketLocks');
const pendingTicketCreations = new Set();

function escapeQuote(value = '-') {
  return String(value).replace(/\n/g, '\n> ');
}

function truncateField(value, max = 900) {
  const text = String(value || '-');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function buildRelatedAdText(messageData) {
  const type = String(messageData?.titleType || 'STORE').trim();
  const content = String(messageData?.content || '').trim();
  const media = Array.isArray(messageData?.media) ? messageData.media : [];
  const caption = truncateField(content || '(Posting tidak memiliki caption teks.)');
  const mediaLines = media.length
    ? `\n> 📎 **Media:** ${media.length} file terlampir`
    : '';
  return { type, caption, mediaLines };
}

function parseTopic(topic = '') {
  return {
    owner: topic.match(/StoreOwnerID:(\d+)/)?.[1] || null,
    clicker: topic.match(/StoreClickerID:(\d+)/)?.[1] || null,
    source: topic.match(/SourceMessageID:(\d+)/)?.[1] || null,
    creator: topic.match(/CreatorID:(\d+)/)?.[1] || null,
    type: topic.match(/Type:([^|]+)/)?.[1] || null
  };
}

async function updateStoreTicketCounter(ctx, sourceMessageId, messageData) {
  const count = Number.isInteger(Number(messageData.ticketCount)) ? Number(messageData.ticketCount) : 0;
  messageData.ticketCount = count;
  const sourceMessage = await ctx.client.channels.fetch(messageData.channelId).catch(() => null);
  if (!sourceMessage || !sourceMessage.isTextBased()) return;
  const message = await sourceMessage.messages.fetch(sourceMessageId).catch(() => null);
  if (!message) return;
  const embeds = message.embeds;
  if (!embeds.length) return;
  const embed = EmbedBuilder.from(embeds[0]);
  const rows = message.components || [];
  const newComponents = rows.map(row => {
    const buttons = row.components.map(component => {
      const customId = component.customId;
      if (customId?.startsWith('store_ticket_total_')) {
        return new ButtonBuilder()
          .setCustomId(customId)
          .setLabel(`Total Tiket: ${count}`)
          .setEmoji('📊')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true);
      }
      return ButtonBuilder.from(component);
    });
    return new ActionRowBuilder().addComponents(buttons);
  });
  await message.edit({ embeds: [embed], components: newComponents }).catch(error => {
    console.error('[STORE TICKET COUNTER ERROR]', error);
  });
}

module.exports = {
  register(ctx) {
    ctx.client.on('channelDelete', channel => {
      locks.unlockByTicketChannel(ctx, channel.id);
      if (ctx.ticketActivity?.[channel.id]) {
        delete ctx.ticketActivity[channel.id];
        ctx.saveTicketActivity();
      }
    });

    ctx.client.on('interactionCreate', async interaction => {
      try {
        if (!interaction.isButton() && !interaction.isModalSubmit()) return;
        const admin = ctx.isAdmin(interaction.member);
        const id = interaction.customId;

        if (interaction.isButton()) {
          if (id.startsWith('chat_seller_') || id.startsWith('chat_buyer_') || id.startsWith('chat_sender_') || id.startsWith('chat_unknown_')) {
            const target = id.split('_').pop();
            if (target === interaction.user.id) {
              return interaction.reply({ content: '❌ Anda tidak dapat chat ke diri sendiri!', flags: [MessageFlags.Ephemeral] });
            }
            return interaction.showModal(
              new ModalBuilder()
                .setCustomId(`modal_send_chat_${target}_${interaction.message.id}`)
                .setTitle('Kirim Pesan Chat Store')
                .addComponents(
                  new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                      .setCustomId('chat_input_message')
                      .setLabel('Tulis pesan / balasan Anda:')
                      .setStyle(TextInputStyle.Paragraph)
                      .setRequired(true)
                      .setMaxLength(1000)
                  )
                )
            );
          }

          if (id.startsWith('dm_reply_')) {
            const parts = id.split('_');
            return interaction.showModal(
              new ModalBuilder()
                .setCustomId(`modal_dm_response_${parts[2]}_${parts[3]}`)
                .setTitle('Balas Pesan Store')
                .addComponents(
                  new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                      .setCustomId('dm_input_response')
                      .setLabel('Tulis balasan Anda:')
                      .setStyle(TextInputStyle.Paragraph)
                      .setRequired(true)
                      .setMaxLength(1000)
                  )
                )
            );
          }

          if (id === 'rate_forwarded_msg') {
            const data = ctx.messageStore.get(interaction.message.id);
            if (!data) return interaction.reply({ content: '❌ Data posting Store tidak tersedia.', flags: [MessageFlags.Ephemeral] });
            const users = Array.isArray(data.ratingUsers) ? [...new Set(data.ratingUsers.map(String).filter(Boolean))] : [];
            if (users.includes(String(interaction.user.id))) {
              return interaction.reply({ content: `❌ **Kamu sudah memberikan rating pada posting ini.**\n⭐ Total: **${Number(data.rating) || 0}**`, flags: [MessageFlags.Ephemeral] });
            }
            data.rating = (Number(data.rating) || 0) + 1;
            users.push(String(interaction.user.id));
            data.ratingUsers = users;
            ctx.messageStore.set(interaction.message.id, data);
            ctx.saveMessageStore();

            const embed = EmbedBuilder.from(interaction.message.embeds[0] || new EmbedBuilder());
            const desc = embed.data.description || '';
            const updatedDesc = /⭐ \*\*Rating:\*\* \*\*\d+\*\*/.test(desc)
              ? desc.replace(/⭐ \*\*Rating:\*\* \*\*\d+\*\*/, `⭐ **Rating:** **${data.rating}**`)
              : `${desc}\n⭐ **Rating:** **${data.rating}**`;
            embed.setDescription(updatedDesc);
            await interaction.message.edit({ embeds: [embed] }).catch(() => {});
            return interaction.reply({ content: `⭐ **Rating berhasil ditambahkan!** Total rating: **${data.rating}**`, flags: [MessageFlags.Ephemeral] });
          }

          if (id === 'delete_forwarded_msg') {
            const data = ctx.messageStore.get(interaction.message.id);
            const author = data?.authorId === interaction.user.id;
            if (!author && !admin) return interaction.reply({ content: '❌ Hanya Admin dan pemilik pesan asli yang dapat menghapus pesan ini!', flags: [MessageFlags.Ephemeral] });
            ctx.messageStore.delete(interaction.message.id);
            ctx.saveMessageStore();
            await interaction.message.delete().catch(() => {});
            return;
          }

          if (id.startsWith('store_ticket_') && !id.startsWith('store_ticket_total_')) {
            const owner = id.replace('store_ticket_', '');
            const source = interaction.message.id;
            const data = ctx.messageStore.get(source);
            if (!data || data.authorId !== owner) return interaction.reply({ content: '❌ Data posting Store tidak tersedia.', flags: [MessageFlags.Ephemeral] });

            const keyUser = String(interaction.user.id);
            const lockKey = `${source}:${keyUser}`;
            if (locks.hasActiveTicket(ctx, source, keyUser)) {
              const active = locks.getActiveTicket(ctx, source, keyUser);
              return interaction.reply({ content: `❌ Kamu sudah memiliki tiket aktif untuk posting ini.\n🎫 Tiket: <#${active}>\nTutup tiket tersebut terlebih dahulu.`, flags: [MessageFlags.Ephemeral] });
            }
            if (pendingTicketCreations.has(lockKey)) {
              return interaction.reply({ content: '⏳ Tiket untuk posting ini sedang dibuat. Tunggu hingga proses selesai.', flags: [MessageFlags.Ephemeral] });
            }

            pendingTicketCreations.add(lockKey);
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            try {
              const nameBase = `${(data.titleType || 'store').toLowerCase()}-private-${interaction.id.slice(-6)}`;
              const topic = `JASHER_TICKET:1|CreatorID:${interaction.user.id}|StoreOwnerID:${owner}|StoreClickerID:${interaction.user.id}|SourceMessageID:${source}|Type:${data.titleType || 'STORE'}`;
              const ch = await interaction.guild.channels.create({
                name: nameBase.slice(0, 90),
                type: ChannelType.GuildText,
                parent: ctx.config.STORE_TICKET_CATEGORY_ID,
                topic,
                permissionOverwrites: [
                  { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                  { id: ctx.config.ADMIN_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                  { id: owner, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                  { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                ]
              });

              locks.lockTicket(ctx, source, keyUser, ch.id);

              data.ticketCount = (Number(data.ticketCount) || 0) + 1;
              data.channelId = interaction.channel.id;
              ctx.messageStore.set(source, data);
              ctx.saveMessageStore();
              await updateStoreTicketCounter(ctx, source, data);

              const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_store_ticket_delete').setLabel('Hapus Tiket').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('btn_store_ticket_order_midman').setLabel('Order Midman').setEmoji('🤝').setStyle(ButtonStyle.Success)
              );
              await ch.send({
                content: `🔔 **Tiket berhasil dibuat.**\n👤 Pemilik posting: <@${owner}>\n👤 Pembuat tiket: <@${interaction.user.id}>`,
                allowedMentions: { users: [owner, interaction.user.id] },
                embeds: [
                  new EmbedBuilder()
                    .setColor(data.titleType === 'SELLING' ? 0x00FFCC : 0x3498DB)
                    .setTitle(`🎫 TIKET ${data.titleType || 'STORE'}`)
                    .setDescription(
                      `🔐 **Mode:** Private\n` +
                      `👤 **Pemilik Posting:** <@${owner}>\n` +
                      `👤 **Pembuat Tiket:** <@${interaction.user.id}>\n` +
                      `🏷️ **Jenis:** **${data.titleType || 'STORE'}**\n\n` +
                      `📝 **Isi Posting:**\n> ${escapeQuote(data.content || '-') }\n\n` +
                      `ℹ️ Aktivitas pengguna di tiket akan memperbarui timer otomatis.`
                    )
                    .setTimestamp()
                ],
                components: [row]
              });

              await ctx.sendAdminLog(interaction.guild, 'Tiket Store Baru', `Tiket Store dibuat: <#${ch.id}>.`, [
                { name: 'Pemilik Posting', value: `<@${owner}>`, inline: true },
                { name: 'Pembuat Tiket', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Posting', value: `<#${interaction.channel.id}>`, inline: true }
              ], interaction.user);

              return interaction.editReply(`✅ Tiket berhasil dibuat: <#${ch.id}>`);
            } catch (error) {
              console.error('[STORE TICKET CREATE ERROR]', error);
              return interaction.editReply('❌ Gagal membuat tiket Store.');
            } finally {
              pendingTicketCreations.delete(lockKey);
            }
          }

          if (id === 'btn_store_ticket_delete') {
            const topic = parseTopic(interaction.channel?.topic || '');
            if (!admin && interaction.user.id !== topic.owner && interaction.user.id !== topic.clicker) {
              return interaction.reply({ content: '❌ Hanya pemilik posting, pembuat tiket, atau Admin yang dapat menghapus tiket ini.', flags: [MessageFlags.Ephemeral] });
            }
            if (topic.source && topic.clicker) locks.unlockTicket(ctx, topic.source, topic.clicker);
            await ctx.sendAdminLog(interaction.guild, 'Tiket Store Dihapus', `Tiket Store \`${interaction.channel.name}\` dihapus oleh <@${interaction.user.id}>.`, [], interaction.user);
            await interaction.reply({ content: '🗑️ **Tiket sedang dihapus...**' });
            setTimeout(() => interaction.channel?.delete().catch(() => {}), 1500);
            return;
          }

          if (id === 'btn_store_ticket_order_midman') {
            const topic = parseTopic(interaction.channel?.topic || '');
            if (!topic.owner || !topic.clicker) return interaction.reply({ content: '❌ Tiket ini bukan tiket Store yang valid.', flags: [MessageFlags.Ephemeral] });
            return interaction.showModal(
              new ModalBuilder()
                .setCustomId('modal_store_ticket_midman')
                .setTitle('Form Order Midman')
                .addComponents(
                  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('m_nama').setLabel('Nama Tiket').setStyle(TextInputStyle.Short).setRequired(true)),
                  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('m_produk').setLabel('Nama Produk').setStyle(TextInputStyle.Short).setRequired(true)),
                  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('m_harga').setLabel('Harga Produk').setStyle(TextInputStyle.Short).setRequired(true)),
                  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('m_opsi').setLabel('Opsi (Ex/Inc)').setStyle(TextInputStyle.Short).setRequired(true))
                )
            );
          }


          if (id.startsWith('btn_qa_reply_')) {
            if (!admin) return interaction.reply({ content: '❌ Anda bukan Admin!', flags: [MessageFlags.Ephemeral] });
            const targetUserId = id.replace('btn_qa_reply_', '');
            return interaction.showModal(
              new ModalBuilder()
                .setCustomId(`modal_qa_reply_member_${targetUserId}`)
                .setTitle('Balas Pertanyaan Member')
                .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('qa_answer_text').setLabel('Jawaban dari Admin:').setStyle(TextInputStyle.Paragraph).setRequired(true)))
            );
          }

          if (id === 'btn_qa_delete') {
            if (!admin) return interaction.reply({ content: '❌ Hanya Admin yang dapat menghapus pesan log ini.', flags: [MessageFlags.Ephemeral] });
            await ctx.sendAdminLog(interaction.guild, 'Hapus Log Pertanyaan Member', `Admin <@${interaction.user.id}> menghapus log pesan keluhan/pertanyaan member.`, [], interaction.user);
            await interaction.message.delete().catch(() => {});
            return;
          }

          if (id === 'btn_qa_dm_reply') {
            return interaction.showModal(
              new ModalBuilder()
                .setCustomId('modal_qa_dm_reply_create')
                .setTitle('Balas Ke Admin')
                .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('qa_dm_reply_text').setLabel('Pesan Balasan Anda:').setStyle(TextInputStyle.Paragraph).setRequired(true)))
            );
          }
        }

        if (interaction.isModalSubmit()) {
          if (id.startsWith('modal_send_chat_') || id.startsWith('modal_dm_response_')) {
            const parts = id.split('_');
            const target = parts[3];
            const messageId = parts[4];
            const input = interaction.fields.getTextInputValue(id.startsWith('modal_send_chat_') ? 'chat_input_message' : 'dm_input_response');
            try {
              const targetUser = await ctx.client.users.fetch(target);
              const messageData = ctx.messageStore.get(messageId);
              const related = buildRelatedAdText(messageData);

              const relatedBlock =
                `🏷️ **IKLAN TERKAIT PESAN INI**\n` +
                `> **Jenis Posting:** ${related.type}\n` +
                `> **Isi Iklan:**\n` +
                `> ${escapeQuote(related.caption)}${related.mediaLines}`;

              const embed = new EmbedBuilder()
                .setColor(id.startsWith('modal_send_chat_') ? 0xF1C40F : 0x2ECC71)
                .setTitle(id.startsWith('modal_send_chat_') ? '📩 PESAN ANONIM STORE WARUNG' : '💬 BALASAN ANONIM STORE WARUNG')
                .setDescription(
                  `${relatedBlock}\n\n` +
                  `🔒 **Privasi:** Identitas pengirim dan pemilik posting disembunyikan.\n\n` +
                  `💬 **Pesan:**\n> ${escapeQuote(input)}`
                )
                .setTimestamp();
              const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`dm_reply_${interaction.user.id}_${messageId}`)
                  .setLabel('Balas Pesan')
                  .setStyle(ButtonStyle.Primary)
              );
              await targetUser.send({ embeds: [embed], components: [row] });
              return interaction.reply({ content: '✅ Pesan anonim berhasil dikirim ke DM tujuan!', flags: [MessageFlags.Ephemeral] });
            } catch (error) {
              console.error('[STORE DM ERROR]', error);
              return interaction.reply({ content: '❌ Gagal mengirim pesan ke DM pengguna.', flags: [MessageFlags.Ephemeral] });
            }
          }

          if (id === 'modal_store_ticket_midman') {
            const values = ['m_nama', 'm_produk', 'm_harga', 'm_opsi'].map(key => interaction.fields.getTextInputValue(key));
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            try {
              const channel = interaction.channel;
              const topic = parseTopic(channel.topic || '');
              const admins = await ctx.getOnlineAdmins(interaction.guild);
              const adminTags = admins.map(adminMember => `<@${adminMember.id}>`).join(' ');

              await channel.setParent(ctx.config.MIDMAN_CATEGORY_ID, { lockPermissions: false });
              const updatedTopic = `JASHER_TICKET:1|CreatorID:${topic.clicker}|StoreOwnerID:${topic.owner}|StoreClickerID:${topic.clicker}|SourceMessageID:${topic.source || ''}|Type:MIDMAN`;
              await channel.setTopic(updatedTopic).catch(() => {});

              const ticketInactivity = require('./ticketInactivity');
              ticketInactivity.markMidmanTicket(ctx, channel, Date.now());
              if (topic.source && topic.clicker) locks.lockTicket(ctx, topic.source, topic.clicker, channel.id);

              const embed = new EmbedBuilder()
                .setColor(0xF1C40F)
                .setTitle('🎫 TIKET TRANSAKSI MIDMAN')
                .setDescription(
                  `Tiket Store telah dikonversi menjadi transaksi Midman.\n\n` +
                  `📦 **Informasi Transaksi:**\n` +
                  `> **Nama Tiket:** ${values[0]}\n` +
                  `> **Produk:** ${values[1]}\n` +
                  `> **Harga:** ${values[2]}\n` +
                  `> **Opsi Fee:** ${values[3]}\n\n` +
                  `👤 **Pemilik Posting:** <@${topic.owner}>\n` +
                  `👤 **Pihak Pembuka:** <@${topic.clicker}>`
                )
                .setTimestamp();

              const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_ticket_close').setLabel('Close Tiket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('btn_ticket_add_member').setLabel('Add Member').setEmoji('👥').setStyle(ButtonStyle.Secondary)
              );

              await channel.send({ content: `**Ping Member & Admin:** <@${topic.clicker}> | <@${topic.owner}> | ${adminTags}`, embeds: [embed], components: [row] });
              await ctx.sendAdminLog(interaction.guild, 'Store Ticket -> Midman', `Tiket <#${channel.id}> dipindahkan ke kategori Midman.`, [], interaction.user);
              return interaction.editReply(`✅ Tiket berhasil dipindahkan ke kategori Midman: <#${channel.id}>`);
            } catch (error) {
              console.error('[STORE MIDMAN ERROR]', error);
              return interaction.editReply('❌ Gagal memproses Order Midman.');
            }
          }

          if (id.startsWith('modal_midman_create')) return;
        }
      } catch (error) {
        console.error('[STORE INTERACTION ERROR]', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '⚠️ Terjadi kesalahan saat memproses interaksi.', flags: [MessageFlags.Ephemeral] }).catch(() => {});
        }
      }
    });
  }
};
