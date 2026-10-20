import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();
const upload = multer({
  dest: path.join(__dirname, '../uploads'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for videos/files
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|mov|avi|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || 
                      file.mimetype.startsWith('video/') || 
                      file.mimetype.startsWith('application/');
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image, video, and document files are allowed'));
  }
});

router.use(requireAuth);

// Upload image/media
router.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { entity_type, entity_id, alt_text, is_primary, media_type } = req.body;
  if (!entity_type || !entity_id) {
    return res.status(400).json({ error: 'entity_type and entity_id are required' });
  }

  const url = `/uploads/${req.file.filename}`;
  const fileType = media_type || (req.file.mimetype.startsWith('video/') ? 'video' : 
                                   req.file.mimetype.startsWith('application/') ? 'document' : 'image');

  const result = db.prepare(`
    INSERT INTO images (entity_type, entity_id, url, alt_text, is_primary, media_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(entity_type, entity_id, url, alt_text || null, is_primary ? 1 : 0, fileType);

  const image = db.prepare('SELECT * FROM images WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(image);
});

// Get images for an entity
router.get('/:entityType/:entityId', (req, res) => {
  const { entityType, entityId } = req.params;
  
  const images = db.prepare(`
    SELECT * FROM images 
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY is_primary DESC, uploaded_at DESC
  `).all(entityType, entityId);

  res.json(images);
});

// Set primary image
router.put('/:id/primary', requireAdmin, (req, res) => {
  const image = db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.id);
  if (!image) return res.status(404).json({ error: 'Image not found' });

  // Reset all images for this entity
  db.prepare(`
    UPDATE images SET is_primary = 0 
    WHERE entity_type = ? AND entity_id = ?
  `).run(image.entity_type, image.entity_id);

  // Set new primary
  db.prepare('UPDATE images SET is_primary = 1 WHERE id = ?').run(req.params.id);

  res.json({ ok: true });
});

// Delete image
router.delete('/:id', requireAdmin, (req, res) => {
  const image = db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.id);
  if (!image) return res.status(404).json({ error: 'Image not found' });

  db.prepare('DELETE FROM images WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
