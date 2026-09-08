import jwt from 'jsonwebtoken';
import {readDb} from './db.js';

export const JWT_SECRET = process.env.METIOR_JWT_SECRET || 'metior-local-dev-secret';

export function signToken(user) {
  return jwt.sign({userId: user.id}, JWT_SECRET, {expiresIn: '7d'});
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({error: 'Unauthorized'});
  }

  try {
    const payload = verifyToken(token);
    const db = readDb();
    const user = db.users.find((x) => x.id === payload.userId);
    if (!user) {
      return res.status(401).json({error: 'Unauthorized'});
    }
    req.user = {id: user.id, username: user.username};
    return next();
  } catch {
    return res.status(401).json({error: 'Unauthorized'});
  }
}
