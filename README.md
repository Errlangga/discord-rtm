# Jasher V1 Modular

Struktur modular untuk bot Discord. `index.js` menangani client, shared context, registrasi fitur, lifecycle startup, dan login. Fitur dipisahkan di folder `features/`.

## Struktur
- `index.js` — core/bootstrap
- `config.js` — ID channel/category/role dan file storage
- `storage.js` — persistent JSON storage
- `services/common.js` — helper admin/log/WIB
- `services/ticketLocks.js` — anti-spam 1 user 1 ticket per posting
- `features/` — modul Admin Status, Daily Message, Database Backup, Uptime, Store, Store Ticket, Admin Selling, Midman, QnA, Server Logs

## Ticket anti-spam
Lock menggunakan pasangan `SourceMessageID + UserID`. Jadi user hanya dibatasi untuk posting yang sama selama ticket aktif. Pada posting berbeda, user tetap dapat membuat ticket. Saat ticket di-close/dihapus, lock dibuka. Lock juga dipersistenkan ke `store_ticket_locks.json` dan dibersihkan saat startup hanya jika channel benar-benar sudah tidak ada.

## Database backup
- Backup otomatis seluruh file JSON database dari `DATA_DIR` ke channel Discord setiap hari pada **03:00 WIB**.
- Atur channel dengan `!setbackupchannel <channelId>` atau mention channel seperti `!setbackupchannel #backup`.
- `!setbackupchannel off` menonaktifkan backup otomatis.
- `!backupdb` menjalankan backup manual sebagai Admin.
- File JSON sampai 19 MiB dikirim langsung. File lebih besar dicoba dikompres menjadi `.json.gz`; jika tetap terlalu besar, file ditandai sebagai tidak terkirim.
- Jika pengiriman backup terputus di tengah, scheduler dapat melanjutkan bagian yang belum terkirim.
- Konfigurasi channel tersimpan persisten di `database_backup_config.json` pada volume.

## Jalankan
1. `npm install`
2. set environment variable `DISCORD_BOT_TOKEN`
3. `node index.js`

## Current build notes
- Discord token is loaded from `DISCORD_BOT_TOKEN` via `.env`/environment.
- Store posts are private and support media + caption.
- Store post buttons include contact, ticket, ticket total, rating, and delete.
- Store ticket total is historical and never decrements on close.
- Ticket inactivity is 2 days based on human activity and persists across bot restarts.
- Midman ticket inactivity is 7 hours based on Admin activity and persists across bot restarts.
- Only channels marked with `JASHER_TICKET:1` are eligible for inactivity auto-close.
- Feedback Midman is one-user-one-active-feedback toggle.
- Owner post cleanup removes tracked posts when the owner definitively leaves; transient API errors do not trigger deletion.
- Persistent storage creates the target directory automatically before saving JSON data.
- Daily Message retries a failed scheduled send instead of marking it successful before Discord confirms the send.
- Uptime keeps the monitored Discord message in memory instead of fetching the same message every second.
- Unexpected uncaught exceptions terminate the process so Railway can restart the bot cleanly.
