import bcrypt from 'bcrypt';
import db from './index.js';

const SALT_ROUNDS = 10;

async function seed() {
  console.log('Seeding database...');
  
  // Check if user already exists
  let user = db.prepare('SELECT id FROM users WHERE username = ?').get('FREDRIC') as { id: number } | undefined;
  
  if (!user) {
    // Hash the password
    const passwordHash = await bcrypt.hash('fredric', SALT_ROUNDS);
    
    // Insert the user
    const stmt = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, active)
      VALUES (?, ?, ?, ?)
    `);
    
    const result = stmt.run('FREDRIC', passwordHash, 'Fredric User', 1);
    user = { id: result.lastInsertRowid as number };
    console.log('Created user: FREDRIC (password: fredric)');
  } else {
    console.log('User FREDRIC already exists.');
  }

  // Seed sample time entries
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  
  // Check if we already have time data
  const existingDay = db.prepare('SELECT id FROM days WHERE user_id = ? AND workday = ?').get(user.id, today);
  
  if (!existingDay) {
    console.log('Adding sample time entries...');
    
    // Insert today
    const insertDay = db.prepare(`
      INSERT INTO days (user_id, workday, daysum) VALUES (?, ?, ?)
    `);
    
    const todayResult = insertDay.run(user.id, today, 7.5);
    const todayId = todayResult.lastInsertRowid;
    
    // Insert yesterday
    const yesterdayResult = insertDay.run(user.id, yesterday, 8.0);
    const yesterdayId = yesterdayResult.lastInsertRowid;
    
    // Insert time entries
    const insertItem = db.prepare(`
      INSERT INTO day_items (day_id, start_hour, end_hour, jiratask, description, rowsum, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    // Today's entries
    insertItem.run(todayId, '08:00', '10:30', 'STEAKT-2987', 'Morning standup and dev', 2.5, 1);
    insertItem.run(todayId, '10:45', '12:00', 'STEAKT-2988', 'Code review', 1.25, 2);
    insertItem.run(todayId, '13:00', '16:45', 'STEAKT-2987', 'Feature implementation', 3.75, 3);
    
    // Yesterday's entries
    insertItem.run(yesterdayId, '08:00', '12:00', 'STEAKT-2985', 'Sprint planning', 4.0, 1);
    insertItem.run(yesterdayId, '13:00', '17:00', 'STEAKT-2986', 'Bug fixes', 4.0, 2);
    
    console.log('Sample time entries created.');
  } else {
    console.log('Time entries already exist.');
  }
  
  console.log('Database seeded successfully!');
}

seed().catch(console.error);
