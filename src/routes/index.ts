// src/routes/index.ts
import { Router } from 'express';
import userRoutes from './user.routes';
import notificationRoutes from './notification.routes';
import fileRoutes from './file.routes';
import stripeRoutes from './stripe.routes';
import telnyxRoutes from './telnyx.routes'; // Assuming telnyx routes are in telnyx.ts

const router = Router();

router.get('/', (req, res) => {
  res.send('API is running...')
});


router.use('/users', userRoutes);
router.use('/notifications', notificationRoutes);
router.use('/files', fileRoutes);
router.use('/stripe', stripeRoutes)
router.use('/telnyx', telnyxRoutes); // Assuming telnyx routes are in telnyx.ts

export { router };