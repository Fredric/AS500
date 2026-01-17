import bcrypt from 'bcrypt';
import db from './index.js';

const SALT_ROUNDS = 10;

async function seed() {
  console.log('Seeding database...');
  
  // Check if user already exists
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('FREDRIC');
  
  if (existing) {
    console.log('User FREDRIC already exists, skipping seed.');
    return;
  }
  
  // Hash the password
  const passwordHash = await bcrypt.hash('fredric', SALT_ROUNDS);
  
  // Insert the user
  const stmt = db.prepare(`
    INSERT INTO users (username, password_hash, full_name, active)
    VALUES (?, ?, ?, ?)
  `);
  
  stmt.run('FREDRIC', passwordHash, 'Fredric User', 1);
  
  console.log('Created user: FREDRIC (password: fredric)');
  console.log('Database seeded successfully!');
}

seed().catch(console.error);
