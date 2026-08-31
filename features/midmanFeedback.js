const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

function getFilePath(ctx) {
  return path.join(ctx.baseDir, ctx.config.MIDMAN_FEEDBACK_FILE);
}

function loadData(ctx) {
  try {
    const file = getFilePath(ctx);
    if (!fs.existsSync(file)) return { users: [] };
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const users = Array.isArray(raw?.users)
      ? [...new Set(raw.users.map(String).filter(Boolean))]
      : [];
    return { users };
  } catch (error) {
    console.error('[MIDMAN FEEDBACK] Gagal memuat database feedback:', error);
    return { users: [] };
  }
}

function saveData(ctx, data) {
  try {
    fs.writeFileSync(getFilePath(ctx), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('[MIDMAN FEEDBACK] Gagal menyimpan database feedback:', error);
    return false;
  }
}

function buildPanel(data) {
  const total = data.users.length;
  const embed = new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle('⭐ FEEDBACK MIDMAN STORE ⭐')
    .setDescription(
      'Bantu kami meningkatkan kualitas layanan Midman Store dengan memberikan feedback.\n\n' +
      '💬 **Cara Memberikan Feedback**\n' +
      '> Klik tombol **Berikan Feedback** di bawah.\n' +
      '> Setiap akun Discord hanya dihitung **1 feedback**.\n' +
      '> Klik tombol sekali lagi untuk **menghapus feedback** Anda.\n\n' +
      `⭐ **Total Feedback:** **${total}**\n\n` +
      '🔒 **Informasi:** Feedback Anda dihitung berdasarkan akun Discord dan disimpan secara otomatis.'
    )
    .setFooter({ text: 'Midman Store Feedback System' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_midman_feedback')
      .setLabel(`Feedback ${total > 0 ? `(${total})` : ''}`.trim())
      .setEmoji('⭐')
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row] };
}

async function updatePanel(ctx, data) {
  try {
    const channel = await ctx.client.channels.fetch(ctx.config.MIDMAN_FEEDBACK_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.warn(`[MIDMAN FEEDBACK] Channel ${ctx.config.MIDMAN_FEEDBACK_CHANNEL_ID} tidak ditemukan atau bukan text channel.`);
      return false;
    }

    const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const existing = messages?.find(
      message =>
        message.author.id === ctx.client.user.id &&
        message.embeds[0]?.title?.includes('FEEDBACK MIDMAN STORE')
    );

    const payload = buildPanel(data);
    if (existing) {
      await existing.edit(payload);
    } else {
      await channel.send(payload);
    }

    return true;
  } catch (error) {
    console.error('[MIDMAN FEEDBACK] Gagal memperbarui panel feedback:', error);
    return false;
  }
}

module.exports = {
  register(ctx) {
    const data = loadData(ctx);

    ctx.client.on('interactionCreate', async interaction => {
      if (!interaction.isButton() || interaction.customId !== 'btn_midman_feedback') return;

      try {
        const userId = String(interaction.user.id);
        const index = data.users.indexOf(userId);
        const hadFeedback = index !== -1;

        if (hadFeedback) {
          data.users.splice(index, 1);
        } else {
          data.users.push(userId);
        }

        data.users = [...new Set(data.users.map(String).filter(Boolean))];

        if (!saveData(ctx, data)) {
          // Rollback perubahan lokal jika database gagal disimpan.
          if (hadFeedback) data.users.push(userId);
          else data.users = data.users.filter(id => id !== userId);
          return interaction.reply({
            content: '❌ Gagal menyimpan feedback. Silakan coba lagi.',
            flags: [MessageFlags.Ephemeral]
          });
        }

        await interaction.message.edit(buildPanel(data)).catch(error => {
          console.error('[MIDMAN FEEDBACK] Gagal memperbarui counter feedback pada panel:', error);
        });

        if (hadFeedback) {
          return interaction.reply({
            content: `🗑️ **Feedback kamu berhasil dihapus.**\n⭐ Total feedback saat ini: **${data.users.length}**`,
            flags: [MessageFlags.Ephemeral]
          });
        }

        return interaction.reply({
          content: `⭐ **Terima kasih! Feedback kamu berhasil ditambahkan.**\n⭐ Total feedback saat ini: **${data.users.length}**`,
          flags: [MessageFlags.Ephemeral]
        });
      } catch (error) {
        console.error('[MIDMAN FEEDBACK INTERACTION ERROR]', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '⚠️ Terjadi kesalahan saat memproses feedback.',
            flags: [MessageFlags.Ephemeral]
          }).catch(() => {});
        }
      }
    });

    ctx.midmanFeedback = data;
  },

  async onReady(ctx) {
    const data = ctx.midmanFeedback || loadData(ctx);
    ctx.midmanFeedback = data;
    await updatePanel(ctx, data);
  }
};
