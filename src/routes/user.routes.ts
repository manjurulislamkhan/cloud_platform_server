
// src/routes/user.routes.ts
import { Router } from 'express';
import { createUser, getUser, updateUser, deleteUser } from '../controllers/user.controller';
import { verifyToken, checkRole } from '../middleware/auth.middleware';

const router = Router();

// router.post('/', verifyToken, checkRole(['admin']), createUser);
// router.get('/:id', verifyToken, getUser);
// router.put('/:id', verifyToken, checkRole(['admin']), updateUser);
// router.delete('/:id', verifyToken, checkRole(['admin']), deleteUser);

router.post('/', createUser);
router.get('/:id', getUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

export default router;