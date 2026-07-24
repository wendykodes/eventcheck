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

import { formatUgandanPhoneNumber } from './phoneUtils.js';

const guests = [
  { name: 'John Smith', phone: '0772100200', email: 'john@example.com', table: '1', count: 2, category: 'Family' },
  { name: 'Jane Doe', phone: '0752100201', email: 'jane@example.com', table: '2', count: 1, category: 'Friend' },
  { name: 'Bob Wilson', phone: '0782100202', email: 'bob@example.com', table: '1', count: 3, category: 'Family' },
  { name: 'Sarah Johnson', phone: '0702100203', email: 'sarah@example.com', table: '3', count: 2, category: 'Friend' },
  { name: 'Mike Brown', phone: '0772100204', email: 'mike@example.com', table: '2', count: 1, category: 'Coworker' },
  { name: 'Lisa Davis', phone: '0752100205', email: 'lisa@example.com', table: '3', count: 4, category: 'Family' },
  { name: 'Tom Miller', phone: '0782100206', email: 'tom@example.com', table: '4', count: 2, category: 'Friend' },
  { name: 'Amy Garcia', phone: '0702100207', email: 'amy@example.com', table: '4', count: 1, category: 'Coworker' },
  { name: 'Chris Lee', phone: '0772100208', email: 'chris@example.com', table: '5', count: 3, category: 'Family' },
  { name: 'Emma Taylor', phone: '0752100209', email: 'emma@example.com', table: '5', count: 2, category: 'Friend' },
  { name: 'David Clark', phone: '0782100210', email: 'david@example.com', table: '6', count: 1, category: 'Coworker' },
  { name: 'Rachel White', phone: '0702100211', email: 'rachel@example.com', table: '6', count: 2, category: 'Family' },
  { name: 'Kevin Martinez', phone: '0772100212', email: 'kevin@example.com', table: '7', count: 1, category: 'Friend' },
  { name: 'Megan Anderson', phone: '0752100213', email: 'megan@example.com', table: '7', count: 3, category: 'Family' },
  { name: 'Ryan Thomas', phone: '0782100214', email: 'ryan@example.com', table: '8', count: 2, category: 'Friend' },
  { name: 'Olivia Jackson', phone: '0702100215', email: 'olivia@example.com', table: '8', count: 1, category: 'Coworker' },
  { name: 'Jason Moore', phone: '0772100216', email: 'jason@example.com', table: '9', count: 4, category: 'Family' },
  { name: 'Sophie Harris', phone: '0752100217', email: 'sophie@example.com', table: '9', count: 2, category: 'Friend' },
  { name: 'Daniel Martin', phone: '0782100218', email: 'daniel@example.com', table: '10', count: 1, category: 'Coworker' },
  { name: 'Natalie Robinson', phone: '0702100219', email: 'natalie@example.com', table: '10', count: 3, category: 'Family' },
];

const guestIds = guests.map(g => {
  const formattedPhone = formatUgandanPhoneNumber(g.phone);
  const r = db.prepare('INSERT INTO guests (event_id, name, phone, email, table_number, guest_count, category, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    eventId, g.name, formattedPhone, g.email, g.table, g.count, g.category, null
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
