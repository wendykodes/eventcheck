import db from '../database.js';
import jwt from '../jwt.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = header.slice(7);
  const payload = jwt.verify(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const user = db.prepare('SELECT status, role FROM users WHERE id = ?').get(payload.id);
  if (!user) {
    return res.status(401).json({ error: 'User does not exist' });
  }
  if (user.status === 'inactive' || user.status === 'suspended') {
    return res.status(403).json({ error: `Account is ${user.status}. Contact an administrator.` });
  }
  req.user = {
    ...payload,
    role: user.role
  };
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
