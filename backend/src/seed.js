import bcrypt from 'bcryptjs';
import db, { initializeDatabase } from './database.js';

initializeDatabase();

db.exec('DELETE FROM checkins');
db.exec('DELETE FROM activities');
db.exec('DELETE FROM guests');
db.exec('DELETE FROM user_events');
db.exec('DELETE FROM events');
db.exec('DELETE FROM users');
db.exec("DELETE FROM sqlite_sequence");

const adminPin = bcrypt.hashSync('1234', 10);
const adminResult = db.prepare('INSERT INTO users (name, pin_hash, role) VALUES (?, ?, ?)').run('Admin', adminPin, 'admin');

const staffPin = bcrypt.hashSync('5678', 10);
const aliceResult = db.prepare('INSERT INTO users (name, pin_hash, role) VALUES (?, ?, ?)').run('Alice', staffPin, 'staff');
const bobResult = db.prepare('INSERT INTO users (name, pin_hash, role) VALUES (?, ?, ?)').run('Bob', staffPin, 'staff');

const adminId = adminResult.lastInsertRowid;
const aliceId = aliceResult.lastInsertRowid;
const bobId = bobResult.lastInsertRowid;

const accessCode = 'WEDDING2026';
const eventResult = db.prepare("INSERT INTO events (name, date, venue, description, status, staff_access_code) VALUES (?, ?, ?, ?, ?, ?)").run(
  'Smith-Johnson Wedding Reception', '2026-08-15', 'The Grand Ballroom, 123 Main St',
  'Evening wedding reception with dinner and dancing', 'active', accessCode
);
const eventId = eventResult.lastInsertRowid;

db.prepare('INSERT INTO user_events (user_id, event_id) VALUES (?, ?)').run(aliceId, eventId);
db.prepare('INSERT INTO user_events (user_id, event_id) VALUES (?, ?)').run(bobId, eventId);

const activityNames = ['Entrance', 'Food', 'Drinks', 'Cake', 'Gift Collection', 'Photo Booth'];
const activityIds = activityNames.map((name, i) => {
  const r = db.prepare('INSERT INTO activities (event_id, name, sort_order) VALUES (?, ?, ?)').run(eventId, name, i);
  return r.lastInsertRowid;
});

const guests = [
  { name: 'John Smith', phone: '555-0101', email: 'john@example.com', table: '1', count: 2, category: 'Family' },
  { name: 'Jane Doe', phone: '555-0102', email: 'jane@example.com', table: '2', count: 1, category: 'Friend' },
  { name: 'Bob Wilson', phone: '555-0103', email: 'bob@example.com', table: '1', count: 3, category: 'Family' },
  { name: 'Sarah Johnson', phone: '555-0104', email: 'sarah@example.com', table: '3', count: 2, category: 'Friend' },
  { name: 'Mike Brown', phone: '555-0105', email: 'mike@example.com', table: '2', count: 1, category: 'Coworker' },
  { name: 'Lisa Davis', phone: '555-0106', email: 'lisa@example.com', table: '3', count: 4, category: 'Family' },
  { name: 'Tom Miller', phone: '555-0107', email: 'tom@example.com', table: '4', count: 2, category: 'Friend' },
  { name: 'Amy Garcia', phone: '555-0108', email: 'amy@example.com', table: '4', count: 1, category: 'Coworker' },
  { name: 'Chris Lee', phone: '555-0109', email: 'chris@example.com', table: '5', count: 3, category: 'Family' },
  { name: 'Emma Taylor', phone: '555-0110', email: 'emma@example.com', table: '5', count: 2, category: 'Friend' },
  { name: 'David Clark', phone: '555-0111', email: 'david@example.com', table: '6', count: 1, category: 'Coworker' },
  { name: 'Rachel White', phone: '555-0112', email: 'rachel@example.com', table: '6', count: 2, category: 'Family' },
  { name: 'Kevin Martinez', phone: '555-0113', email: 'kevin@example.com', table: '7', count: 1, category: 'Friend' },
  { name: 'Megan Anderson', phone: '555-0114', email: 'megan@example.com', table: '7', count: 3, category: 'Family' },
  { name: 'Ryan Thomas', phone: '555-0115', email: 'ryan@example.com', table: '8', count: 2, category: 'Friend' },
  { name: 'Olivia Jackson', phone: '555-0116', email: 'olivia@example.com', table: '8', count: 1, category: 'Coworker' },
  { name: 'Jason Moore', phone: '555-0117', email: 'jason@example.com', table: '9', count: 4, category: 'Family' },
  { name: 'Sophie Harris', phone: '555-0118', email: 'sophie@example.com', table: '9', count: 2, category: 'Friend' },
  { name: 'Daniel Martin', phone: '555-0119', email: 'daniel@example.com', table: '10', count: 1, category: 'Coworker' },
  { name: 'Natalie Robinson', phone: '555-0120', email: 'natalie@example.com', table: '10', count: 3, category: 'Family' },
];

const guestIds = guests.map(g => {
  const r = db.prepare('INSERT INTO guests (event_id, name, phone, email, table_number, guest_count, category, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    eventId, g.name, g.phone, g.email, g.table, g.count, g.category, null
  );
  return r.lastInsertRowid;
});

const insertCheckin = db.prepare('INSERT INTO checkins (guest_id, activity_id, staff_id) VALUES (?, ?, ?)');

for (let i = 0; i < 12; i++) {
  const staffId = i % 2 === 0 ? aliceId : bobId;
  insertCheckin.run(guestIds[i], activityIds[0], staffId);
}
for (let i = 0; i < 8; i++) {
  insertCheckin.run(guestIds[i], activityIds[1], i % 2 === 0 ? aliceId : bobId);
}
for (let i = 0; i < 5; i++) {
  insertCheckin.run(guestIds[i], activityIds[2], aliceId);
}

console.log('Seed data inserted successfully!');
console.log('Admin PIN: 1234');
console.log('Staff PIN: 5678');
console.log(`Event Access Code: ${accessCode}`);
