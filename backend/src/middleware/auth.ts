import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import prisma from '../config/db.js';

export type Role =
  | 'PATIENT'
  | 'RECEPTION'
  | 'TRIAGE_STAFF'
  | 'NURSE'
  | 'DOCTOR'
  | 'SPECIALIST_DOCTOR'
  | 'AYUSH_DOCTOR'
  | 'HOSPITAL_ADMIN'
  | 'SUPER_ADMIN';

export interface JwtPayload {
  id: string;
  email: string;
  role: Role | string;
  name: string;
  iat?: number;
  exp?: number;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
  kioskPatientId?: string;
}

export function generateToken(user: { id: string; email: string; role: Role | string; name: string }): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRY as any }
  );
}

export function generateKioskToken(patientId: string): string {
  return jwt.sign(
    { type: 'kiosk', patientId },
    env.JWT_SECRET,
    { expiresIn: '30m' }
  );
}

export function generateRefreshToken(user: { id: string }): string {
  return jwt.sign(
    { id: user.id, type: 'refresh' },
    env.JWT_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRY as any }
  );
}

export async function authenticateToken(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please provide a valid token.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload & { type?: string };
    if (decoded.type || !decoded.id || !decoded.role || !decoded.email || !decoded.name) {
      res.status(401).json({ error: 'Invalid access token.' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, isActive: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: 'User account is inactive or not found.' });
      return;
    }

    req.user = decoded;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired. Please login again.' });
      return;
    }
    res.status(403).json({ error: 'Invalid authentication token.' });
  }
}

export async function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.user = decoded;
  } catch {
    // Graceful fallback for kiosk anonymous uploads
  }
  next();
}


export async function authenticateUserOrKiosk(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Authentication required.' }); return; }
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload & { type?: string; patientId?: string };
    if (decoded.type === 'kiosk' && decoded.patientId) {
      const patient = await prisma.patient.findUnique({ where: { id: decoded.patientId }, select: { id: true } });
      if (!patient) { res.status(401).json({ error: 'Invalid kiosk session.' }); return; }
      req.kioskPatientId = patient.id;
      next();
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: decoded.id }, select: { id: true, isActive: true } });
    if (!user?.isActive) { res.status(401).json({ error: 'User account is inactive or not found.' }); return; }
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

export async function authenticateKioskSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Kiosk session authentication required.' });
    return;
  }
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload & { type?: string; patientId?: string };
    if (decoded.type !== 'kiosk' || !decoded.patientId) {
      res.status(401).json({ error: 'Invalid kiosk session.' });
      return;
    }
    const patient = await prisma.patient.findUnique({ where: { id: decoded.patientId }, select: { id: true } });
    if (!patient) {
      res.status(401).json({ error: 'Patient session is no longer valid.' });
      return;
    }
    req.kioskPatientId = patient.id;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired kiosk session.' });
  }
}
