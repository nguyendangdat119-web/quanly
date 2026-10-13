/**
 * Quản lý Dark Feminine + Hmind — Google Apps Script (gắn vào 1 Google Sheet).
 *
 * - syncNow(): kéo dữ liệu từ server (hmindenglish.com/api/public/export) về
 *   các trang tính. setup() cài lịch tự chạy mỗi 15 phút.
 * - doPost(): API cho trang web quản lý (GitHub Pages). Mỗi yêu cầu phải có
 *   đúng tên đăng nhập + key; sai 10 lần trong 15 phút thì khoá 15 phút.
 *
 * Điền CONFIG bên dưới (bản đã điền sẵn được gửi riêng, KHÔNG đưa lên GitHub).
 */
const CONFIG = {
  FEED_URL: 'https://hmindenglish.com/api/public/export',
  FEED_KEY: 'DIEN_EXPORT_KEY',
  LOGIN_USER: 'DIEN_TEN_DANG_NHAP',
  // SHA-256 (hex) của key đăng nhập — không lưu key gốc ở đây.
  LOGIN_KEY_SHA256: 'DIEN_SHA256_CUA_KEY',
};

const TZ = 'Asia/Ho_Chi_Minh';
const MAX_FAILS = 10;
const LOCK_SECONDS = 15 * 60;

// [khoá trong JSON, tiêu đề cột, kiểu]. Kiểu: text | money | int | datetime | date
const SHEETS = {
  dfOrders: {
    name: 'DF - Đơn hàng',
    pick: (d) => (d.df ? d.df.orders : null),
    cols: [
      ['id', 'Mã đơn', 'text'],
      ['created_at', 'Tạo lúc', 'datetime'],
      ['paid_at', 'Thanh toán lúc', 'datetime'],
      ['status', 'Trạng thái', 'text'],
      ['amount_vnd', 'Số tiền', 'money'],
      ['amount_received_vnd', 'Đã nhận', 'money'],
      ['discount_vnd', 'Giảm giá', 'money'],
      ['program', 'Chương trình', 'text'],
      ['plan', 'Gói', 'text'],
      ['member_number', 'Mã TV', 'int'],
      ['name', 'Tên', 'text'],
      ['email', 'Email', 'text'],
      ['phone', 'SĐT', 'text'],
      ['bank_transfer_name', 'Tên chuyển khoản', 'text'],
    ],
  },
  dfMembers: {
    name: 'DF - Thành viên',
    pick: (d) => (d.df ? d.df.members : null),
    cols: [
      ['member_number', 'Mã TV', 'int'],
      ['name', 'Tên', 'text'],
      ['email', 'Email', 'text'],
      ['phone', 'SĐT', 'text'],
      ['bank_transfer_name', 'Tên chuyển khoản', 'text'],
      ['created_at', 'Ngày tham gia', 'datetime'],
      ['active_subscriptions', 'Gói đang hoạt động', 'int'],
      ['active_until', 'Hết hạn', 'datetime'],
      ['lifetime_paid_vnd', 'Tổng đã trả', 'money'],
    ],
  },
  hmPayments: {
    name: 'Hmind - Thu học phí',
    pick: (d) => d.hmind.payments,
    cols: [
      ['id', 'Mã', 'int'],
      ['paid_on', 'Ngày thu', 'date'],
      ['amount_vnd', 'Số tiền', 'money'],
      ['method', 'Hình thức', 'text'],
      ['student_name', 'Học viên', 'text'],
      ['student_phone', 'SĐT', 'text'],
      ['student_email', 'Email', 'text'],
      ['course', 'Khoá học', 'text'],
      ['package', 'Gói', 'text'],
      ['format', 'Hình thức học', 'text'],
      ['note', 'Ghi chú', 'text'],
    ],
  },
  hmEnrollments: {
    name: 'Hmind - Khoá đăng ký',
    pick: (d) => d.hmind.enrollments,
    cols: [
      ['id', 'Mã', 'int'],
      ['created_at', 'Tạo lúc', 'datetime'],
      ['student_name', 'Học viên', 'text'],
      ['student_phone', 'SĐT', 'text'],
      ['course', 'Khoá học', 'text'],
      ['package', 'Gói', 'text'],
      ['format', 'Hình thức học', 'text'],
      ['fee_vnd', 'Học phí', 'money'],
      ['paid_vnd', 'Đã đóng', 'money'],
      ['start_date', 'Bắt đầu', 'date'],
      ['end_date', 'Kết thúc', 'date'],
      ['status', 'Trạng thái', 'text'],
    ],
  },
  hmLeads: {
    name: 'Hmind - Khách tư vấn',
    pick: (d) => d.hmind.leads,
    cols: [
      ['id', 'Mã', 'int'],
      ['created_at', 'Gửi lúc', 'datetime'],
      ['name', 'Tên', 'text'],
      ['phone', 'SĐT', 'text'],
      ['email', 'Email', 'text'],
      ['course_interest', 'Quan tâm', 'text'],
      ['message', 'Lời nhắn', 'text'],
      ['source', 'Nguồn', 'text'],
      ['status', 'Trạng thái', 'text'],
    ],
  },
};

const FORMATS = { text: '@', money: '#,##0', int: '0', datetime: 'dd/mm/yyyy hh:mm', date: 'dd/mm/yyyy' };
const STATUS_SHEET = 'Đồng bộ';

/** Chạy 1 lần sau khi dán code: cài lịch đồng bộ 15 phút + đồng bộ ngay. */
function setup() {
  SpreadsheetApp.getActive().setSpreadsheetTimeZone(TZ);
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'syncNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(15).create();
  syncNow();
}

function syncNow() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60 * 1000)) return;
  try {
    const res = UrlFetchApp.fetch(CONFIG.FEED_URL, {
      headers: { Authorization: 'Bearer ' + CONFIG.FEED_KEY },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      writeStatus('Lỗi ' + code + ': ' + res.getContentText().slice(0, 200));
      throw new Error('Feed trả về ' + code);
    }
    const data = JSON.parse(res.getContentText());
    const ss = SpreadsheetApp.getActive();
    Object.keys(SHEETS).forEach((k) => {
      const rows = SHEETS[k].pick(data);
      // Dark Feminine lỗi tạm thời → giữ nguyên dữ liệu lần trước.
      if (rows) writeSheet(ss, SHEETS[k], rows);
    });
    writeStatus(data.df_error ? 'Dark Feminine: ' + data.df_error : 'OK');
  } finally {
    lock.releaseLock();
  }
}

function writeSheet(ss, def, rows) {
  const sheet = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
  sheet.clear();
  const n = rows.length + 1;
  def.cols.forEach((c, i) => sheet.getRange(1, i + 1, n, 1).setNumberFormat(FORMATS[c[2]]));
  const values = [def.cols.map((c) => c[1])].concat(
    rows.map((r) => def.cols.map((c) => toCell(r[c[0]], c[2])))
  );
  sheet.getRange(1, 1, n, def.cols.length).setValues(values);
  sheet.getRange(1, 1, 1, def.cols.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function toCell(v, type) {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'money' || type === 'int') return Number(v);
  if (type === 'date') {
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : String(v);
  }
  if (type === 'datetime') {
    // SQLite trả "YYYY-MM-DD HH:MM:SS" (giờ UTC), Postgres trả ISO có múi giờ.
    const s = String(v);
    const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
    return isNaN(d.getTime()) ? s : d;
  }
  return String(v);
}

function writeStatus(message) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(STATUS_SHEET) || ss.insertSheet(STATUS_SHEET);
  sheet.getRange(1, 1, 2, 2).setValues([
    ['Lần đồng bộ cuối', new Date()],
    ['Kết quả', message],
  ]);
  sheet.getRange(1, 2).setNumberFormat('dd/mm/yyyy hh:mm:ss');
}

// ---------------------------------------------------------------- Web API

function doGet() {
  return ContentService.createTextOutput('OK');
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json({ ok: false, error: 'Yêu cầu không hợp lệ.' });
  }

  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('fails') || 0);
  if (fails >= MAX_FAILS) return json({ ok: false, error: 'Sai quá nhiều lần. Thử lại sau 15 phút.' });

  if (!checkLogin(String(body.user || ''), String(body.key || ''))) {
    cache.put('fails', String(fails + 1), LOCK_SECONDS);
    return json({ ok: false, error: 'Sai tên đăng nhập hoặc key.' });
  }

  if (body.action === 'sync') {
    try {
      syncNow();
    } catch (err) {
      return json({ ok: false, error: 'Đồng bộ lỗi: ' + err.message });
    }
  }
  return json({ ok: true, data: readAll() });
}

function checkLogin(user, key) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key, Utilities.Charset.UTF_8);
  const hex = digest.map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  const okUser = user === CONFIG.LOGIN_USER;
  const okKey = hex === CONFIG.LOGIN_KEY_SHA256;
  return okUser && okKey;
}

function readAll() {
  const ss = SpreadsheetApp.getActive();
  const out = {};
  Object.keys(SHEETS).forEach((k) => {
    const def = SHEETS[k];
    const sheet = ss.getSheetByName(def.name);
    if (!sheet || sheet.getLastRow() < 2) {
      out[k] = [];
      return;
    }
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, def.cols.length).getValues();
    out[k] = values.map((row) => {
      const o = {};
      def.cols.forEach((c, i) => (o[c[0]] = fromCell(row[i], c[2])));
      return o;
    });
  });
  const status = ss.getSheetByName(STATUS_SHEET);
  out.syncedAt = status ? fromCell(status.getRange(1, 2).getValue(), 'datetime') : null;
  out.syncMessage = status ? String(status.getRange(2, 2).getValue()) : 'Chưa đồng bộ lần nào';
  return out;
}

function fromCell(v, type) {
  if (v === '' || v === null) return null;
  if (v instanceof Date) {
    return type === 'date' ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : v.toISOString();
  }
  return v;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
