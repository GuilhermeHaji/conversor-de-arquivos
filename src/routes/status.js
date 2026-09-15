import { Router } from 'express';
import { getQueueStatus } from '../services/queue.js';

const router = Router();
router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(getQueueStatus());
});

export default router;
