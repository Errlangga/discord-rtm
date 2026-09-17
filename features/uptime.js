const { EmbedBuilder } = require('discord.js');
let messageId = null;
let uptimeMessage = null;
let uptimeChannelId = null;

function format(ms) { let s=Math.floor(ms/1000), d=Math.floor(s/86400); s%=86400; let h=Math.floor(s/3600); s%=3600; let m=Math.floor(s/60); s%=60; return `${d} hari, ${h} jam, ${m} menit, ${s} detik`; }

async function findExistingMessage(ctx, channel) {
  const recent = await channel.messages.fetch({limit:10}).catch(()=>null);
  const existing = recent?.find(m=>m.author.id===ctx.client.user.id&&m.embeds[0]?.title==='🟢 BOT UPTIME MONITOR');
  if (existing) {
    uptimeMessage = existing;
    messageId = existing.id;
    uptimeChannelId = channel.id;
  }
  return existing;
}

async function update(ctx) {
  try {
    const ch = await ctx.client.channels.fetch(ctx.config.UPTIME_CHANNEL_ID).catch(()=>null);
    if(!ch||!ch.isTextBased()) return;

    if (uptimeChannelId !== ch.id) {
      uptimeMessage = null;
      messageId = null;
      uptimeChannelId = ch.id;
    }

    const embed = new EmbedBuilder().setColor(0x2ECC71).setTitle('🟢 BOT UPTIME MONITOR').setDescription(`🤖 **Bot:** ${ctx.client.user.tag}\n📡 **Status:** Online\n⏱️ **Uptime:** **${format(ctx.client.uptime||0)}**\n🚀 **Started:** <t:${Math.floor((Date.now()-(ctx.client.uptime||0))/1000)}:F>\n🕐 **WIB:** ${ctx.formatWIB()}\n📶 **WebSocket Ping:** **${ctx.client.ws.ping} ms**`).setTimestamp().setFooter({text:'Real-time Uptime Monitor'});

    if (!uptimeMessage || messageId !== uptimeMessage.id) await findExistingMessage(ctx, ch);

    if (uptimeMessage) {
      try {
        await uptimeMessage.edit({embeds:[embed]});
        return;
      } catch (error) {
        console.error('[UPTIME MESSAGE EDIT ERROR]', error);
        uptimeMessage = null;
        messageId = null;
      }
    }

    const sent=await ch.send({embeds:[embed]});
    uptimeMessage=sent;
    messageId=sent.id;
  } catch(e) { console.error('[UPTIME ERROR]',e); }
}

module.exports={ register(ctx){}, async onReady(ctx){ await update(ctx); setInterval(()=>update(ctx),1000); }, update };
