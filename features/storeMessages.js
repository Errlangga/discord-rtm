const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');

function esc(value = '-') {
  return String(value).replace(/\n/g, '\n> ');
}

function isImageAttachment(attachment) {
  return Boolean(
    attachment?.contentType?.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(attachment?.name || '')
  );
}

function buildPrivateStoreComponents(title, ownerId) {
  const components = [];
  if (title === 'SELLING') {
    components.push(
      new ButtonBuilder()
        .setCustomId(`chat_seller_${ownerId}`)
        .setLabel('Hubungi Penjual')
        .setStyle(ButtonStyle.Success)
    );
  } else if (title === 'FINDING') {
    components.push(
      new ButtonBuilder()
        .setCustomId(`chat_buyer_${ownerId}`)
        .setLabel('Hubungi Pembeli')
        .setStyle(ButtonStyle.Success)
    );
  } else if (title === 'PROMOSI') {
    components.push(
      new ButtonBuilder()
        .setCustomId(`chat_sender_${ownerId}`)
        .setLabel('Hubungi Pengirim')
        .setStyle(ButtonStyle.Success)
    );
  } else {
    components.push(
      new ButtonBuilder()
        .setCustomId(`chat_unknown_${ownerId}`)
        .setLabel('Hubungi Pengirim')
        .setStyle(ButtonStyle.Success)
    );
  }

  if (['SELLING', 'FINDING', 'PROMOSI', 'INFORMASI'].includes(title)) {
    components.push(
      new ButtonBuilder()
        .setCustomId(`store_ticket_${ownerId}`)
        .setLabel('Buat Tiket')
        .setEmoji('🎫')
        .setStyle(ButtonStyle.Secondary)
    );
    components.push(
      new ButtonBuilder()
        .setCustomId(`store_ticket_total_${ownerId}`)
        .setLabel('Total Tiket: 0')
        .setEmoji('📊')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );
  }

  components.push(
    new ButtonBuilder()
      .setCustomId('rate_forwarded_msg')
      .setLabel('Rating')
      .setEmoji('⭐')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('delete_forwarded_msg')
      .setLabel('Hapus Pesan')
      .setStyle(ButtonStyle.Danger)
  );

  return components;
}

module.exports = {
  register(ctx) {
    const { client } = ctx;
    const storeCategoryIds = new Set([
      ctx.config.STORE_CATEGORY_ID,
      ...(Array.isArray(ctx.config.EXTRA_STORE_CATEGORY_IDS) ? ctx.config.EXTRA_STORE_CATEGORY_IDS : [])
    ]);

    client.on('messageCreate', async message => {
      if (message.author.bot || !message.guild) return;

      // Anti selling.
      if (message.channel.id === ctx.config.ANTI_SELL_CHANNEL_ID) {
        const hasSell = /\b(?:sell|selling)\b/i.test(message.content || '');
        if (hasSell) {
          await message.delete().catch(() => {});
          return message.reply('🚫 **Jangan berjualan di tempat chat.** Silakan gunakan channel Store yang telah disediakan.').catch(() => {});
        }
        return;
      }

      // Admin selling tetap terpisah dari private Store post.
      if (message.channel.id === ctx.config.ADMIN_SELLING_CHANNEL_ID) {
        if (!ctx.isAdmin(message.member)) {
          await message.delete().catch(() => {});
          return;
        }

        const first = message.attachments.first();
        const content = message.content || '-';
        const embed = new EmbedBuilder()
          .setColor(0xE74C3C)
          .setAuthor({
            name: `PENJUALAN RESMI ADMIN — ${message.author.tag}`,
            iconURL: message.author.displayAvatarURL({ dynamic: true })
          })
          .setTitle('🔥 ADMIN EXCLUSIVE STORE LISTING 🔥')
          .setDescription(
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📝 **Detail Jualan / Produk:**\n> ${esc(content)}\n\n` +
            `👤 **Penjual (Admin):** <@${message.author.id}>\n` +
            `📌 **Status:** Tersedia / Open Order\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `ℹ️ Klik tombol **Order Sekarang** di bawah untuk melakukan pembelian langsung.`
          )
          .setTimestamp();

        const files = [];
        let imageUrl = null;
        if (first && isImageAttachment(first)) {
          const file = new AttachmentBuilder(first.url, { name: first.name || 'selling.png' });
          embed.setImage(`attachment://${file.name}`);
          files.push(file);
          imageUrl = first.url;
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`btn_adminsell_order_${message.author.id}`)
            .setLabel('Order Sekarang')
            .setEmoji('🛒')
            .setStyle(ButtonStyle.Success)
        );

        const sent = await message.channel.send({ embeds: [embed], files, components: [row] }).catch(error => {
          console.error('[ADMIN SELLING ERROR]', error);
          return null;
        });

        if (sent) {
          ctx.messageStore.set(sent.id, {
            authorId: message.author.id,
            guildId: message.guild.id,
            channelId: message.channel.id,
            content,
            imageUrl,
            type: 'ADMIN_SELLING',
            rating: 0,
            ratingUsers: []
          });
          ctx.saveMessageStore();
          await message.delete().catch(() => {});
          await ctx.sendAdminLog(
            message.guild,
            'Post Admin Selling Baru',
            `Admin <@${message.author.id}> menerbitkan postingan jualan baru.`,
            [],
            message.author
          );
        }
        return;
      }

      // reset testi
      if (message.content.startsWith('!resettesti')) {
        if (!ctx.isAdmin(message.member)) return message.reply('❌ Hanya Admin yang memiliki akses untuk mereset counter testimoni.').catch(() => {});
        const n = parseInt(message.content.slice('!resettesti'.length).trim().split(/ +/)[0], 10);
        if (!Number.isInteger(n) || n < 1) return message.reply('❌ Format: `!resettesti <nomor>`').catch(() => {});
        ctx.testiStore.count = n - 1;
        ctx.saveTestiStore();
        await ctx.sendAdminLog(message.guild, 'Reset Counter Testimoni', `Admin <@${message.author.id}> mengubah counter testimoni. Testimoni selanjutnya akan bernomor **#${n}**.`, [], message.author);
        return message.reply(`✅ Counter testimoni disesuaikan. Testimoni berikutnya: **#${n}**.`).catch(() => {});
      }

      // testi
      if (message.channel.id === ctx.config.TESTI_CHANNEL_ID) {
        if (!message.attachments.size) return;
        const first = message.attachments.first();
        const text = message.content || '-';
        ctx.testiStore.count += 1;
        ctx.saveTestiStore();

        const embed = new EmbedBuilder()
          .setColor(0x2ECC71)
          .setAuthor({ name: '⭐ STORE WARUNG OFFICIAL TESTIMONIAL ⭐', iconURL: message.guild.iconURL() || ctx.client.user.displayAvatarURL() })
          .setTitle(`🛍️ TESTIMONI REPUTASI #${ctx.testiStore.count}`)
          .setDescription(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n👤 **Nama Pengirim:** <@${message.author.id}>\n🔢 **Total Testimoni Store:** **${ctx.testiStore.count} Testimoni**\n\n📝 **Ulasan / Catatan Member:**\n> ${esc(text)}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
          .setTimestamp();

        const files = [];
        if (isImageAttachment(first)) {
          const file = new AttachmentBuilder(first.url, { name: first.name || 'testi.png' });
          embed.setImage(`attachment://${file.name}`);
          files.push(file);
        }
        await message.channel.send({ embeds: [embed], files }).catch(() => {});
        await message.delete().catch(() => {});
        await ctx.sendAdminLog(message.guild, 'Testimoni Baru Terpublikasi', `Member <@${message.author.id}> telah mengirimkan testimoni ke-**#${ctx.testiStore.count}**.`, [], message.author);
        return;
      }

      // status
      if (message.content.toLowerCase().trim() === '!status') {
        if (!ctx.isAdmin(message.member)) return message.reply('❌ Hanya Admin yang memiliki akses.').catch(() => {});
        const statusFeature = require('./adminStatus');
        await statusFeature.updateAdminStatusMessage(ctx, true);
        return message.reply(`✅ Status Admin diperbarui di <#${ctx.config.ADMIN_STATUS_CHANNEL_ID}>.`).catch(() => {});
      }

      // sendchat
      if (message.content.startsWith('!sendchat')) {
        if (!ctx.isAdmin(message.member)) return message.reply('❌ Hanya Admin yang memiliki akses untuk mengirim pesan embed.').catch(() => {});
        const raw = message.content.slice('!sendchat'.length).trim();
        const parts = raw.split(',').map(x => x.trim());
        let target = '', title = '', content = '';
        if (parts.length >= 3) {
          target = parts[0].replace(/[<#>]/g, '');
          title = parts[1];
          content = parts.slice(2).join(',');
        } else {
          const p = raw.split(/ +/);
          target = p[0]?.replace(/[<#>]/g, '');
          title = p[1] || '';
          content = p.slice(2).join(' ');
        }
        const image = message.attachments.first()?.url || null;
        if (!target || !title || (!content && !image)) return message.reply('❌ Format: `!sendchat <id_channel>, <judul>, <pesan>`').catch(() => {});
        const ch = await client.channels.fetch(target).catch(() => null);
        if (!ch || !ch.isTextBased()) return message.reply('❌ Channel target tidak ditemukan.').catch(() => {});
        const embed = new EmbedBuilder().setColor(0x5865F2).setAuthor({ name: 'STORE WARUNG OFFICIAL ANNOUNCEMENT', iconURL: message.guild.iconURL() || client.user.displayAvatarURL() }).setTitle(`📢 ${title.toUpperCase()}`).setDescription(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${content || '*(Lihat lampiran gambar di bawah)*'}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`).setTimestamp();
        if (image) embed.setImage(image);
        await ch.send({ embeds: [embed] });
        await ctx.sendAdminLog(message.guild, 'Pengiriman Chat Embed Bot (!sendchat)', `Admin <@${message.author.id}> mengirim embed ke <#${ch.id}>.`, [], message.author);
        return message.reply(`✅ Pesan embed berhasil dikirim ke <#${ch.id}>!`).catch(() => {});
      }

      // Private Store forwarder.
      if (storeCategoryIds.has(message.channel.parentId)) {
        const lower = (message.content || '').toLowerCase();
        const finding = ['need', 'info', 'dicari', 'cari', 'find'].some(k => lower.includes(k));
        const selling = ['jual', 'dijual', 'minat', 'open', 'sell'].some(k => lower.includes(k));

        let title = 'INFORMASI';
        let color = 0x808080;
        if (finding && selling) { title = 'PROMOSI'; color = 0x9B59B6; }
        else if (selling) { title = 'SELLING'; color = 0x00FFCC; }
        else if (finding) { title = 'FINDING'; color = 0x3498DB; }

        const attachments = Array.from(message.attachments.values()).slice(0, 10);
        const media = [];
        const stored = [];
        let firstImage = null;

        for (let i = 0; i < attachments.length; i++) {
          const attachment = attachments[i];
          const original = attachment.name || `media-${i + 1}`;
          const unique = `${String(i + 1).padStart(2, '0')}-${original.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          try {
            const response = await fetch(attachment.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const buffer = Buffer.from(await response.arrayBuffer());
            if (!buffer.length) throw new Error('empty');
            media.push({ attachment: buffer, name: unique });
            stored.push({ url: attachment.url, name: original, contentType: attachment.contentType || null, size: attachment.size || buffer.length });
            if (!firstImage && isImageAttachment(attachment)) firstImage = unique;
          } catch (error) {
            console.error('[STORE MEDIA ERROR]', error);
          }
        }

        if (attachments.length && media.length !== attachments.length) {
          return message.reply('❌ Gagal memproses seluruh media. Pesan asli tidak dihapus.').catch(() => {});
        }

        const caption = (message.content || '').trim() || '(Tanpa caption / keterangan teks)';
        const dataBeforeSend = {
          authorId: message.author.id,
          guildId: message.guild.id,
          channelId: message.channel.id,
          content: message.content,
          titleType: title,
          rating: 0,
          ratingUsers: [],
          ticketCount: 0,
          media: stored,
          type: 'STORE_FORWARD'
        };

        const embed = new EmbedBuilder()
          .setColor(color)
          .setAuthor({ name: '🛒 STORE WARUNG — PRIVATE POST' })
          .setTitle(`🛒 STORE WARUNG — [ ${title} ]`)
          .setDescription(
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📝 **Caption / Isi Pesan:**\n> ${esc(caption)}\n\n` +
            `🔒 **Identitas:** Disembunyikan demi privasi pengguna.\n` +
            `📌 **Channel:** <#${message.channel.id}>\n` +
            `📎 **Media:** ${attachments.length} file\n` +
            `⭐ **Rating:** **0**\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
          )
          .setTimestamp()
          .setFooter({ text: 'Store Warung Private Forwarder System', iconURL: message.guild.iconURL() });

        if (firstImage) embed.setImage(`attachment://${firstImage}`);

        const row = new ActionRowBuilder().addComponents(...buildPrivateStoreComponents(title, message.author.id));
        const sent = await message.channel.send({ embeds: [embed], files: media, components: [row] }).catch(error => {
          console.error('[STORE FORWARD ERROR]', error);
          return null;
        });
        if (!sent) return;

        dataBeforeSend.sourceMessageId = sent.id;
        ctx.messageStore.set(sent.id, dataBeforeSend);
        ctx.saveMessageStore();
        await message.delete().catch(() => {});
      }
    });
  }
};
