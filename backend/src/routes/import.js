import { Router } from 'express';
import XLSX from 'xlsx';
import crypto from 'crypto';
import db from '../database.js';
import { requireAdmin } from '../middleware/auth.js';
import { formatUgandanPhoneNumber } from '../phoneUtils.js';

const router = Router();
const importSessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of importSessions) {
    if (now - session.created > 30 * 60 * 1000) importSessions.delete(id);
  }
}, 60 * 1000);

router.use(requireAdmin);

router.post('/parse', (req, res) => {
  try {
    const { file_data } = req.body;
    if (!file_data) return res.status(400).json({ error: 'file_data is required' });

    const buf = Buffer.from(file_data, 'base64');
    const workbook = XLSX.read(buf, { type: 'buffer', raw: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return res.status(400).json({ error: 'No sheets found in file' });

    const sheet = workbook.Sheets[sheetName];
    // Read the sheet as a 2D array to find the header row
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rows.length === 0) return res.status(400).json({ error: 'No data found in file' });

    // Keywords to find the header row in the first 15 rows
    const nameKeywords = ['name', 'guest name', 'fullname', 'full name', 'guest'];
    const phoneKeywords = ['phone', 'phone number', 'telephone', 'contact', 'mobile', 'tel'];

    let headerRowIdx = 0;
    let bestScore = -1;
    let bestRowIdx = 0;
    for (let r = 0; r < Math.min(15, rows.length); r++) {
      const row = rows[r];
      let score = 0;
      let hasRequiredName = false;
      let hasRequiredPhone = false;
      for (const cell of row) {
        const val = String(cell || '').toLowerCase().trim();
        if (!val) continue;
        if (nameKeywords.some(k => val === k || val.includes(k))) { score += 3; hasRequiredName = true; }
        else if (phoneKeywords.some(k => val === k || val.includes(k))) { score += 3; hasRequiredPhone = true; }
        else if (['email', 'e-mail', 'email address'].some(k => val === k || val.includes(k))) score += 2;
        else if (['table', 'table number', 'table no', 'seating'].some(k => val === k || val.includes(k))) score += 1;
        else if (['count', 'guest count', 'guests', 'no of guests', 'number of guests', 'pax', 'size'].some(k => val === k || val.includes(k))) score += 1;
        else if (['category', 'group', 'type'].some(k => val === k || val.includes(k))) score += 1;
        else if (['notes', 'note', 'comments', 'comment', 'description'].some(k => val === k || val.includes(k))) score += 1;
      }
      if (hasRequiredName && hasRequiredPhone) {
        score += 10;
      }
      if (score > bestScore) {
        bestScore = score;
        bestRowIdx = r;
      }
    }

    let hasHeader = true;
    if (bestScore <= 0) {
      // Find the first row that is not completely empty
      let firstNonEmptyRowIdx = 0;
      for (let r = 0; r < rows.length; r++) {
        if (rows[r].some(cell => String(cell || '').trim() !== '')) {
          firstNonEmptyRowIdx = r;
          break;
        }
      }
      headerRowIdx = firstNonEmptyRowIdx;

      // Check if this row looks like a data row instead of a header row
      const firstRow = rows[headerRowIdx] || [];
      let looksLikeData = false;
      for (const cell of firstRow) {
        const val = String(cell || '').trim();
        // If it looks like a phone number (7+ digits) or an email
        if (/^\+?[\d\s-]{7,15}$/.test(val) || val.includes('@')) {
          looksLikeData = true;
          break;
        }
      }
      if (looksLikeData) {
        hasHeader = false;
      }
    } else {
      headerRowIdx = bestRowIdx;
    }

    let columns = [];
    if (hasHeader) {
      const headerRow = rows[headerRowIdx];
      columns = headerRow.map((cell, colIdx) => {
        const val = String(cell || '').trim();
        return val || `Column_${colIdx + 1}`;
      });
    } else {
      // Generate synthetic header column names based on the max row length
      let maxCols = 0;
      rows.forEach(r => { if (r.length > maxCols) maxCols = r.length; });
      for (let i = 0; i < maxCols; i++) {
        columns.push(`Column_${i + 1}`);
      }
    }

    const rawData = [];
    const startIdx = hasHeader ? headerRowIdx + 1 : headerRowIdx;
    for (let r = startIdx; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every(cell => String(cell || '').trim() === '')) {
        continue;
      }
      const rowObj = {};
      columns.forEach((colName, colIdx) => {
        rowObj[colName] = row[colIdx] !== undefined ? String(row[colIdx]).trim() : '';
      });
      rawData.push(rowObj);
    }

    if (rawData.length === 0) {
      return res.status(400).json({ error: 'No data rows found in the sheet' });
    }

    const sessionId = crypto.randomBytes(16).toString('hex');
    importSessions.set(sessionId, {
      rows: rawData,
      columns,
      total: rawData.length,
      created: Date.now(),
    });

    res.json({
      session_id: sessionId,
      columns,
      total_rows: rawData.length,
      sample_rows: rawData.slice(0, 5),
    });
  } catch (err) {
    console.error('Parse error:', err);
    res.status(400).json({ error: 'Failed to parse file: ' + err.message });
  }
});

router.post('/preview', (req, res) => {
  const { event_id, session_id, mapping, duplicate_rule } = req.body;
  if (!event_id || !session_id || !mapping) {
    return res.status(400).json({ error: 'event_id, session_id, and mapping are required' });
  }

  const session = importSessions.get(session_id);
  if (!session) return res.status(400).json({ error: 'Session expired or not found. Please re-upload the file.' });

  const allRows = session.rows;
  const parsed = [];
  const errors = [];

  const nameField = mapping.name;
  const phoneField = mapping.phone;
  const emailField = mapping.email;
  const tableField = mapping.table_number;
  const countField = mapping.guest_count;
  const categoryField = mapping.category;
  const notesField = mapping.notes;

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalidChars = /[<>{}|\\^~`]/;

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    const rowNum = i + 2;
    const warnings = [];

    const nameRaw = (nameField ? row[nameField] : '').toString().trim();
    const phoneRaw = (phoneField ? row[phoneField] : '').toString().trim();
    const emailRaw = (emailField ? row[emailField] : '').toString().trim();
    const tableRaw = (tableField ? row[tableField] : '').toString().trim();
    const countRaw = (countField ? row[countField] : '').toString().trim();
    const categoryRaw = (categoryField ? row[categoryField] : '').toString().trim();
    const notesRaw = (notesField ? row[notesField] : '').toString().trim();

    if (!nameRaw) {
      errors.push({ row: rowNum, reason: 'Missing required field: name', data: { name: nameRaw, phone: phoneRaw } });
      continue;
    }

    if (invalidChars.test(nameRaw) || (phoneRaw && invalidChars.test(phoneRaw))) {
      errors.push({ row: rowNum, reason: 'Invalid characters detected', data: { name: nameRaw, phone: phoneRaw } });
      continue;
    }

    let phoneFormatted = '';
    if (phoneRaw) {
      const formatted = formatUgandanPhoneNumber(phoneRaw);
      const cleanDigits = formatted.replace(/[^\d]/g, '');
      if (cleanDigits.length === 12 && formatted.startsWith('+256')) {
        phoneFormatted = formatted;
      } else {
        phoneFormatted = phoneRaw;
        warnings.push(`Phone number "${phoneRaw}" is not in standard Ugandan format (+256...)`);
      }
    }

    if (emailRaw && !emailPattern.test(emailRaw)) {
      warnings.push('Invalid email format');
    }

    let guestCount = 1;
    if (countRaw) {
      guestCount = parseInt(countRaw, 10);
      if (isNaN(guestCount) || guestCount < 1) {
        errors.push({ row: rowNum, reason: 'Guest count must be a positive number', data: { name: nameRaw, phone: phoneRaw } });
        continue;
      }
    }

    const existingByPhone = phoneFormatted ? db.prepare('SELECT id, name FROM guests WHERE event_id = ? AND phone = ?').get(event_id, phoneFormatted) : null;
    const existingByEmail = emailRaw ? db.prepare('SELECT id, name FROM guests WHERE event_id = ? AND email = ?').get(event_id, emailRaw) : null;
    const existingByName = db.prepare('SELECT id, name FROM guests WHERE event_id = ? AND name = ?').get(event_id, nameRaw);

    let duplicateType = null;
    let existingGuest = null;

    if (duplicate_rule === 'phone' && existingByPhone) {
      duplicateType = 'phone'; existingGuest = existingByPhone;
    } else if (duplicate_rule === 'email' && existingByEmail) {
      duplicateType = 'email'; existingGuest = existingByEmail;
    } else if (duplicate_rule === 'name' && existingByName) {
      duplicateType = 'name'; existingGuest = existingByName;
    } else if (duplicate_rule === 'phone_email' && (existingByPhone || existingByEmail)) {
      duplicateType = existingByPhone ? 'phone' : 'email';
      existingGuest = existingByPhone || existingByEmail;
    } else if (duplicate_rule === 'name_phone' && existingByName && existingByPhone) {
      duplicateType = 'name+phone'; existingGuest = existingByName;
    } else if (duplicate_rule === 'all' && (existingByPhone || existingByEmail || existingByName)) {
      duplicateType = existingByPhone ? 'phone' : existingByEmail ? 'email' : 'name';
      existingGuest = existingByPhone || existingByEmail || existingByName;
    }

    parsed.push({
      name: nameRaw,
      phone: phoneFormatted || null,
      email: emailRaw || null,
      table_number: tableRaw || null,
      guest_count: guestCount,
      category: categoryRaw || null,
      notes: notesRaw || null,
      warnings,
      duplicate_type: duplicateType,
      existing_guest_id: existingGuest?.id || null,
      existing_guest_name: existingGuest?.name || null,
    });
  }

  session.parsedRows = parsed;
  session.eventId = event_id;
  session.duplicateRule = duplicate_rule;

  const duplicateCount = parsed.filter(r => r.duplicate_type).length;
  const warningCount = parsed.filter(r => r.warnings.length > 0).length;

  res.json({
    total: allRows.length,
    valid: parsed.length,
    duplicates: duplicateCount,
    invalid: errors.length,
    warnings: warningCount,
    rows: parsed,
    errors,
  });
});

router.post('/confirm', (req, res) => {
  const { session_id, duplicate_action, file_name } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id is required' });

  const session = importSessions.get(session_id);
  if (!session) return res.status(400).json({ error: 'Session expired. Please re-upload.' });

  const { parsedRows, eventId } = session;
  const adminId = req.user.id;

  const insert = db.prepare(`
    INSERT INTO guests (event_id, name, phone, email, table_number, guest_count, category, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE guests SET name=?, phone=?, email=?, table_number=?, guest_count=?, category=?, notes=?, updated_at=datetime('now')
    WHERE id=?
  `);

  let imported = 0, updated = 0, skipped = 0;
  const failed = [];

  const tx = db.transaction(() => {
    for (const row of parsedRows) {
      if (row.duplicate_type) {
        if (duplicate_action === 'skip') {
          skipped++;
          continue;
        } else if (duplicate_action === 'update' && row.existing_guest_id) {
          update.run(row.name, row.phone, row.email, row.table_number, row.guest_count, row.category, row.notes, row.existing_guest_id);
          updated++;
          continue;
        } else if (duplicate_action === 'replace' && row.existing_guest_id) {
          db.prepare('DELETE FROM guests WHERE id = ?').run(row.existing_guest_id);
        }
      }
      try {
        insert.run(eventId, row.name, row.phone, row.email, row.table_number, row.guest_count, row.category, row.notes);
        imported++;
      } catch (err) {
        failed.push({ name: row.name, reason: err.message });
      }
    }
  });
  tx();

  const total = parsedRows.length;
  const duplicateCount = parsedRows.filter(r => r.duplicate_type).length;

  db.prepare(`
    INSERT INTO import_history (event_id, admin_id, file_name, total_records, imported, updated, skipped, failed, duplicate_count, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')
  `).run(eventId, adminId, file_name || 'unknown', total, imported, updated, skipped, failed.length, duplicateCount);

  importSessions.delete(session_id);

  res.json({
    total,
    imported,
    updated,
    skipped,
    failed: failed.length,
    duplicate_count: duplicateCount,
  });
});

router.get('/history/:eventId', (req, res) => {
  const history = db.prepare(`
    SELECT ih.*, u.name AS admin_name
    FROM import_history ih
    JOIN users u ON u.id = ih.admin_id
    WHERE ih.event_id = ?
    ORDER BY ih.created_at DESC
  `).all(req.params.eventId);
  res.json(history);
});

router.get('/history/:eventId/:importId', (req, res) => {
  const record = db.prepare(`
    SELECT ih.*, u.name AS admin_name
    FROM import_history ih
    JOIN users u ON u.id = ih.admin_id
    WHERE ih.id = ? AND ih.event_id = ?
  `).get(req.params.importId, req.params.eventId);
  if (!record) return res.status(404).json({ error: 'Import record not found' });
  res.json(record);
});

export default router;
