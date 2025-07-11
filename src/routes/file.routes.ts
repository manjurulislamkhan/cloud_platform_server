// src/routes/file.routes.ts
import { Router } from 'express';
import multer from 'multer';
import { uploadFile } from '../controllers/file.controller';
import { verifyToken } from '../middleware/auth.middleware';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

//router.post('/upload', verifyToken, upload.single('file'), uploadFile);

router.post('/upload', upload.single('file'), uploadFile);

export default router;