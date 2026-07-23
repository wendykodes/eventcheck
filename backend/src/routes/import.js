import { Router } from 'express';
import XLSX from 'xlsx';
import crypto from 'crypto';
import db from '../database.js';
import { requireAdmin } from '../middleware/auth.js';

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
    const rawData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rawData.length === 0) return res.status(400).json({ error: 'No data found in file' });

    const columns = Object.keys(rawData[0]).filter(k => k.trim());
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

  const phonePattern = /^[\d\s\-\+\(\)\.]+$/;
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

    if (!nameRaw || !phoneRaw) {
      errors.push({ row: rowNum, reason: 'Missing required field: name or phone', data: { name: nameRaw, phone: phoneRaw } });
      continue;
    }

    if (invalidChars.test(nameRaw) || invalidChars.test(phoneRaw)) {
      errors.push({ row: rowNum, reason: 'Invalid characters detected', data: { name: nameRaw, phone: phoneRaw } });
      continue;
    }

    if (!phonePattern.test(phoneRaw)) {
      errors.push({ row: rowNum, reason: 'Invalid phone format', data: { name: nameRaw, phone: phoneRaw } });
      continue;
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

    const existingByPhone = db.prepare('SELECT id, name FROM guests WHERE event_id = ? AND phone = ?').get(event_id, phoneRaw);
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
      phone: phoneRaw,
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
