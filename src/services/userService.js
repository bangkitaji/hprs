const { pool } = require('../config/database');
const { hashPassword, comparePassword, generateToken } = require('../utils/auth');

/**
 * Authenticate user by username and password.
 */
async function authenticateUser(username, password) {
  if (!username || !password) {
    const error = new Error('Username and password are required.');
    error.status = 400;
    throw error;
  }

  const query = `
    SELECT id, username, password_hash, full_name, role, is_active
    FROM users
    WHERE LOWER(username) = LOWER($1)
  `;
  const result = await pool.query(query, [username.trim()]);

  if (result.rows.length === 0) {
    const error = new Error('Invalid username or password.');
    error.status = 401;
    throw error;
  }

  const user = result.rows[0];

  if (!user.is_active) {
    const error = new Error('Your account has been deactivated. Please contact an Administrator.');
    error.status = 403;
    throw error;
  }

  const isMatch = await comparePassword(password, user.password_hash);
  if (!isMatch) {
    const error = new Error('Invalid username or password.');
    error.status = 401;
    throw error;
  }

  const token = generateToken(user);

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
    },
  };
}

/**
 * Get list of all registered users (Administrator only).
 */
async function getAllUsers() {
  const query = `
    SELECT id, username, full_name, role, is_active, created_at, updated_at
    FROM users
    ORDER BY id ASC
  `;
  const result = await pool.query(query);
  return result.rows;
}

/**
 * Create a new user account (Administrator only).
 */
async function createUser({ username, password, full_name, role }) {
  if (!username || !password || !full_name || !role) {
    const error = new Error('All fields (username, password, full name, role) are required.');
    error.status = 400;
    throw error;
  }

  const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  if (cleanUsername.length < 3) {
    const error = new Error('Username must be at least 3 alphanumeric characters.');
    error.status = 400;
    throw error;
  }

  if (password.length < 6) {
    const error = new Error('Password must be at least 6 characters.');
    error.status = 400;
    throw error;
  }

  if (!['administrator', 'user'].includes(role)) {
    const error = new Error('Role must be either "administrator" or "user".');
    error.status = 400;
    throw error;
  }

  // Check if username already exists
  const checkQuery = 'SELECT id FROM users WHERE LOWER(username) = LOWER($1)';
  const checkResult = await pool.query(checkQuery, [cleanUsername]);
  if (checkResult.rows.length > 0) {
    const error = new Error(`Username "${cleanUsername}" is already taken.`);
    error.status = 409;
    throw error;
  }

  const hashedPassword = await hashPassword(password);

  const insertQuery = `
    INSERT INTO users (username, password_hash, full_name, role)
    VALUES ($1, $2, $3, $4)
    RETURNING id, username, full_name, role, is_active, created_at
  `;
  const insertResult = await pool.query(insertQuery, [
    cleanUsername,
    hashedPassword,
    full_name.trim(),
    role,
  ]);

  return insertResult.rows[0];
}

/**
 * Delete a user account (Administrator only).
 */
async function deleteUser(userId, currentUserId) {
  const targetId = parseInt(userId, 10);
  if (isNaN(targetId)) {
    const error = new Error('Invalid user ID.');
    error.status = 400;
    throw error;
  }

  if (targetId === currentUserId) {
    const error = new Error('You cannot delete your own active account.');
    error.status = 400;
    throw error;
  }

  const deleteQuery = 'DELETE FROM users WHERE id = $1 RETURNING id, username';
  const result = await pool.query(deleteQuery, [targetId]);

  if (result.rows.length === 0) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }

  return result.rows[0];
}

module.exports = {
  authenticateUser,
  getAllUsers,
  createUser,
  deleteUser,
};
