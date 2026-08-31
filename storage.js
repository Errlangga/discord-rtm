const fs = require('fs');
const path = require('path');
const config = require('./config');

function safeReadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`[STORAGE] Gagal membaca ${path.basename(file)}:`, error);
    return fallback;
  }
}

function safeWriteJson(file, data) {
  const tempFile = `${file}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempFile, file);
    return true;
  } catch (error) {
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
    console.error(`[STORAGE] Gagal menyimpan ${path.basename(file)}:`, error);
    return false;
  }
}

function loadMessageStore(baseDir) {
  const parsed = safeReadJson(path.join(baseDir, config.STORAGE_FILE), {});
  const normalized = Object.entries(parsed).map(([id, value]) => [id, {
    ...(value && typeof value === 'object' ? value : {}),
    rating: Number.isFinite(Number(value?.rating)) ? Number(value.rating) : 0,
    ratingUsers: Array.isArray(value?.ratingUsers) ? [...new Set(value.ratingUsers.map(String).filter(Boolean))] : [],
    ticketCount: Number.isFinite(Number(value?.ticketCount)) ? Number(value.ticketCount) : 0
  }]);
  return new Map(normalized);
}

function saveMessageStore(baseDir, store) {
  return safeWriteJson(path.join(baseDir, config.STORAGE_FILE), Object.fromEntries(store.entries()));
}

function loadDailyStore(baseDir) {
  return safeReadJson(path.join(baseDir, config.DAILY_STORAGE_FILE), {});
}

function saveDailyStore(baseDir, data) {
  return safeWriteJson(path.join(baseDir, config.DAILY_STORAGE_FILE), data);
}

function loadTestiStore(baseDir) {
  return safeReadJson(path.join(baseDir, config.TESTI_STORAGE_FILE), { count: 0 });
}

function saveTestiStore(baseDir, data) {
  return safeWriteJson(path.join(baseDir, config.TESTI_STORAGE_FILE), data);
}

function loadStoreTicketLocks(baseDir) {
  const data = safeReadJson(path.join(baseDir, config.STORE_TICKET_LOCKS_FILE), {});
  return data && typeof data === 'object' ? data : {};
}

function saveStoreTicketLocks(baseDir, data) {
  return safeWriteJson(path.join(baseDir, config.STORE_TICKET_LOCKS_FILE), data);
}

function loadTicketActivity(baseDir) {
  const data = safeReadJson(path.join(baseDir, config.TICKET_ACTIVITY_FILE), {});
  return data && typeof data === 'object' ? data : {};
}

function saveTicketActivity(baseDir, data) {
  return safeWriteJson(path.join(baseDir, config.TICKET_ACTIVITY_FILE), data);
}

module.exports = {
  loadMessageStore,
  saveMessageStore,
  loadDailyStore,
  saveDailyStore,
  loadTestiStore,
  saveTestiStore,
  loadStoreTicketLocks,
  saveStoreTicketLocks,
  loadTicketActivity,
  saveTicketActivity
};
