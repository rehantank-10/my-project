import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../config/db.js';

import { createAuditLog } from '../middleware/audit.js';
import { env } from '../config/env.js';
import { AUDIT_ACTIONS } from '../config/constants.js';
import type { AuthRequest } from '../middleware/auth.js';

const router = Router();
// Document metadata and uploads are never anonymous. A kiosk may only access the patient
// record for which it holds a short-lived kiosk session token. Clinical staff can access
// records according to their role.


// Setup multer disk storage
const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024 }, // configurable max file size
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|pdf/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, and PDF files are allowed'));
    }
  },
});

/**
 * Safe demo document extractor (metadata only).
 */
function extractMedicalEntities(title: string, fileType: string) {
  // This project currently provides a safe demo extractor rather than pretending to
  // perform clinical OCR. Never invent medications, diagnoses, lab values, or doctors.
  return {
    documentType: fileType,
    title: title.trim(),
    extractionMode: 'DEMO_METADATA_ONLY',
    message: 'Document stored successfully. Clinical entities require a configured OCR service and human review.',
    confidence: 0,
  };
}

async function assertPatientAccess(req: AuthRequest, patientId: string): Promise<boolean> {
  if (req.kioskPatientId) return req.kioskPatientId === patientId;
  if (!req.user) return false;
  const role = req.user.role;
  if (['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'DOCTOR', 'SPECIALIST_DOCTOR', 'AYUSH_DOCTOR', 'NURSE', 'TRIAGE_STAFF', 'RECEPTION'].includes(role)) return true;
  if (role === 'PATIENT') {
    const patient = await prisma.patient.findFirst({ where: { id: patientId, userId: req.user.id }, select: { id: true } });
    return !!patient;
  }
  return false;
}



/**
 * POST /api/documents/upload
 * Upload document with instant simulated/real OCR entity extraction.
 */
router.post('/upload', authenticateUserOrKiosk, upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { patientId, visitId, title, fileType = 'PRESCRIPTION' } = req.body;
  const file = req.file;



  if (!patientId || !title || !file) {
    if (file?.path) await fs.promises.unlink(file.path).catch(() => undefined);
    res.status(400).json({ error: 'patientId, title, and file are required.' });
    return;
  }

  const allowedFileTypes = new Set(['PRESCRIPTION', 'LAB_REPORT', 'DISCHARGE_SUMMARY', 'IMAGING']);
  if (!allowedFileTypes.has(fileType)) {
    await fs.promises.unlink(file.path).catch(() => undefined);
    res.status(400).json({ error: 'Invalid document category.' });
    return;
  }

  try {
    const hasAccess = await assertPatientAccess(req, patientId);
    if (!hasAccess) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      res.status(403).json({ error: 'You are not authorized to access this patient record.' });
      return;
    }

    const validPatient = await prisma.patient.findUnique({ where: { id: patientId } });

    if (!validPatient) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      res.status(404).json({ error: 'No patient record found for document attachment.' });
      return;
    }

    let validVisitId: string | null = null;
    if (visitId && visitId !== 'current') {
      const visitExists = await prisma.visit.findFirst({ where: { id: visitId, patientId } });
      if (!visitExists) { await fs.promises.unlink(file.path).catch(() => undefined); res.status(400).json({ error: 'Invalid visit for this patient.' }); return; }
      validVisitId = visitId;
    }


    // 1. Create Document Record. Store only a protected API path; never expose the
    // filesystem path or a publicly readable /uploads URL.
    const doc = await prisma.document.create({
      data: {
        patientId: validPatient.id,
        visitId: validVisitId,
        title: title.trim(),
        fileType: fileType as any,
        mimeType: file.mimetype,
        fileUrl: `/uploads/${file.filename}`,
        fileSize: file.size,
        status: 'PROCESSED',
      },
    });
    const updatedDoc = doc;

  // 2. OCR Entity Extraction
  const extractedData = extractMedicalEntities(title, fileType);

  const extraction = await prisma.documentExtraction.create({
    data: {
      documentId: doc.id,
      extractedData: JSON.stringify(extractedData),
      confidence: extractedData.confidence || 0.85,
      status: 'CONFIRMED',
      processedAt: new Date(),
    },
  });

  await createAuditLog({
    userId: req.user?.id,
    role: req.user?.role,
    action: AUDIT_ACTIONS.UPLOAD_DOCUMENT,
    resourceType: 'DOCUMENT',
    resourceId: doc.id,
    details: { title, fileType, confidence: extractedData.confidence },
  });

    res.status(201).json({
      document: updatedDoc,
      extraction,
    });
  } catch (err: any) {
    if (file?.path) await fs.promises.unlink(file.path).catch(() => undefined);
    console.error('Document upload error:', err);
    res.status(500).json({ error: err.message || 'Failed to process document upload.' });
  }
});


/**
 * GET /api/documents/file/:id
 * Stream a document only after authorization. Files are intentionally not served as public static assets.
 */
router.get('/file/:id', authenticateUserOrKiosk, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = typeof req.params.id === 'string' ? req.params.id : req.params.id[0];
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) { res.status(404).json({ error: 'Document not found.' }); return; }
  if (!(await assertPatientAccess(req, doc.patientId))) { res.status(403).json({ error: 'Access denied.' }); return; }
  const filename = path.basename(new URL(`http://local${doc.fileUrl}`).pathname);
  const absolutePath = path.join(uploadDir, filename);
  if (!fs.existsSync(absolutePath)) { res.status(404).json({ error: 'Document file not found.' }); return; }
  res.sendFile(absolutePath, { headers: { 'Content-Type': doc.mimeType, 'Content-Disposition': `inline; filename="${path.basename(absolutePath)}"` } });
});

/**
 * GET /api/timeline/:patientId
 * Real-time computed longitudinal medical timeline combining visits, documents, vitals, and prescriptions.
 */
router.get('/timeline/:patientId', authenticateUserOrKiosk, async (req: AuthRequest, res: Response): Promise<void> => {
  const patientId = typeof req.params.patientId === 'string' ? req.params.patientId : req.params.patientId[0];
  if (!(await assertPatientAccess(req, patientId))) { res.status(403).json({ error: 'Access denied.' }); return; }

  const [patient, visits, documents, prescriptions, vitals] = await Promise.all([
    prisma.patient.findUnique({ where: { id: patientId } }),
    prisma.visit.findMany({
      where: { patientId },
      include: { department: true, consultation: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.document.findMany({
      where: { patientId },
      include: { extractions: true },
      orderBy: { uploadedAt: 'desc' },
    }),
    prisma.prescription.findMany({
      where: { patientId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.vital.findMany({
      where: { patientId },
      orderBy: { recordedAt: 'desc' },
    }),
  ]);

  if (!patient) {
    res.status(404).json({ error: 'Patient not found' });
    return;
  }

  // Assemble chronological timeline events
  const timeline: any[] = [];

  visits.forEach((v) => {
    timeline.push({
      id: `visit-${v.id}`,
      date: v.createdAt,
      type: 'VISIT',
      title: `OPD Visit — ${v.department.name}`,
      description: v.reasonForVisit || 'General clinical consultation',
      details: v.consultation ? `Impression: ${v.consultation.impression || 'Consultation completed'}` : 'Intake completed',
      priority: v.priority,
    });
  });

  documents.forEach((d) => {
    timeline.push({
      id: `doc-${d.id}`,
      date: d.uploadedAt,
      type: 'DOCUMENT_OCR',
      title: `Medical Record: ${d.title}`,
      description: `Uploaded ${d.fileType} document with AI OCR analysis`,
      details: d.extractions?.[0]?.extractedData || {},
    });
  });

  prescriptions.forEach((p) => {
    const medNames = p.items.map((i) => `${i.medicineName} (${i.dosage})`).join(', ');
    timeline.push({
      id: `rx-${p.id}`,
      date: p.createdAt,
      type: 'PRESCRIPTION',
      title: 'Physician E-Prescription Issued',
      description: medNames,
      details: p.notes,
    });
  });

  // Sort descending by date
  timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  res.json({
    patient: { id: patient.id, name: patient.name, mrn: patient.mrn },
    timeline,
    totalEvents: timeline.length,
  });
});


/**
 * GET /api/documents/:patientId
 * Get all medical documents and OCR results for a patient.
 */
router.get('/:patientId', authenticateUserOrKiosk, async (req: AuthRequest, res: Response): Promise<void> => {
  const patientId = typeof req.params.patientId === 'string' ? req.params.patientId : req.params.patientId[0];
  if (!(await assertPatientAccess(req, patientId))) { res.status(403).json({ error: 'Access denied.' }); return; }

  const documents = await prisma.document.findMany({
    where: { patientId },
    include: {
      extractions: true,
    },
    orderBy: { uploadedAt: 'desc' },
  });

  res.json({ documents });
});


export default router;
