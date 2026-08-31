const { EmbedBuilder } = require('discord.js');
let messageId = null;
function format(ms) { let s=Math.floor(ms/1000), d=Math.floor(s/86400); s%=86400; let h=Math.floor(s/3600); s%=3600; let m=Math.floor(s/60); s%=60; return `${d} hari, ${h} jam, ${m} menit, ${s} detik`; }
async function update(ctx) {
  try {
    const ch = await ctx.client.channels.fetch(ctx.config.UPTIME_CHANNEL_ID).catch(()=>null); if(!ch||!ch.isTextBased()) return;
    const embed = new EmbedBuilder().setColor(0x2ECC71).setTitle('🟢 BOT UPTIME MONITOR').setDescription(`🤖 **Bot:** ${ctx.client.user.tag}\n📡 **Status:** Online\n⏱️ **Uptime:** **${format(ctx.client.uptime||0)}**\n🚀 **Started:** <t:${Math.floor((Date.now()-(ctx.client.uptime||0))/1000)}:F>\n🕐 **WIB:** ${ctx.formatWIB()}\n📶 **WebSocket Ping:** **${ctx.client.ws.ping} ms**`).setTimestamp().setFooter({text:'Real-time Uptime Monitor'});
    let msg = messageId ? await ch.messages.fetch(messageId).catch(()=>null) : null;
    if(!msg) { const recent=await ch.messages.fetch({limit:10}).catch(()=>null); msg=recent?.find(m=>m.author.id===ctx.client.user.id&&m.embeds[0]?.title==='🟢 BOT UPTIME MONITOR'); }
    if(msg) { messageId=msg.id; await msg.edit({embeds:[embed]}); } else { const sent=await ch.send({embeds:[embed]}); messageId=sent.id; }
  } catch(e) { console.error('[UPTIME ERROR]',e); }
}
module.exports={ register(ctx){}, async onReady(ctx){ await update(ctx); setInterval(()=>update(ctx),1000); }, update };
