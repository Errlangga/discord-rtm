module.exports = {
  register(ctx) {
    const { client } = ctx;
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
      try {
        const added = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
        const removed = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));
        if (added.size) await ctx.sendAdminLog(newMember.guild, 'Penambahan Role Member', `Role baru telah ditambahkan kepada member <@${newMember.id}> (\`${newMember.user.tag}\`).`, [{ name: 'Role Ditambahkan', value: added.map(r => `<@&${r.id}>`).join(', ') }], newMember.user);
        if (removed.size) await ctx.sendAdminLog(newMember.guild, 'Pelepasan Role Member', `Role telah dilepas dari member <@${newMember.id}> (\`${newMember.user.tag}\`).`, [{ name: 'Role Dihapus', value: removed.map(r => `<@&${r.id}>`).join(', ') }], newMember.user);
      } catch (e) { console.error('[ROLE LOG ERROR]', e); }
    });
    client.on('guildMemberAdd', member => ctx.sendAdminLog(member.guild, 'Member Bergabung', `Pengguna <@${member.id}> (\`${member.user.tag}\`) baru saja bergabung ke server.`, [], member.user));
    client.on('guildMemberRemove', member => ctx.sendAdminLog(member.guild, 'Member Keluar / Out', `Pengguna <@${member.id}> (\`${member.user.tag}\`) telah keluar dari server.`, [], member.user));
  }
};
