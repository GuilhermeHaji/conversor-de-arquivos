import { Router } from 'express';
import { publicFormats } from '../services/formats.js';

const router = Router();
router.get('/', (req, res) => res.json(publicFormats()));

export default router;
