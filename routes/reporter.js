const express = require('express')
const { requireRole } = require('../middleware/auth')
const { ROLES } = require('../models/User')
const reporter = require('../controllers/reporterController')
const imageStore = require('../services/imageStore')

const router = express.Router()

// guards every route in this file
router.use(requireRole(ROLES.REPORTER))

// --- pages ---
router.get('/', reporter.showDashboard)
// /article/new has to come first, otherwise :id would match the word "new"
router.get('/article/new', reporter.showNewEditor)
router.get('/article/:id', reporter.showEditor)

// --- json ---
// The picture arrives as the raw body rather than a form upload, so express
// parses it on its own and we need no multipart library.
router.post(
  '/api/image',
  express.raw({ type: imageStore.ALLOWED_TYPES, limit: imageStore.MAX_BYTES }),
  reporter.uploadImage
)
router.post('/api/article', reporter.createArticle)
router.patch('/api/article/:id', reporter.saveDraft)
router.post('/api/article/:id/submit', reporter.submitArticle)
router.delete('/api/article/:id', reporter.deleteArticle)

module.exports = router
