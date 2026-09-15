import { Router } from 'express';
import { formats } from '../services/formats.js';

const router = Router();
router.get('/', (req, res) => res.json(formats));

export default router;
