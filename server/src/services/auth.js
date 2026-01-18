import bcrypt from 'bcrypt';
import db from '../db/index.js';
export async function validateCredentials(username, password) {
    // Normalize username to uppercase
    const normalizedUsername = username.toUpperCase().trim();
    // Find user
    const user = db.prepare(`
    SELECT * FROM users 
    WHERE username = ? AND active = 1
  `).get(normalizedUsername);
    if (!user) {
        return null;
    }
    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
        return null;
    }
    return user;
}
