const express = require('express')
const { requireRole } = require('../middleware/auth')
const { ROLES } = require('../models/User')
const reporter = require('../controllers/reporterController')

const router = express.Router()

// guards every route in this file
router.use(requireRole(ROLES.REPORTER))

const todo = name => (req, res) => res.status(501).send(`TODO: ${name}`)

// --- pages ---
router.get('/', reporter.showDashboard)
// /article/new has to come first, otherwise :id would match the word "new"
router.get('/article/new', reporter.showNewEditor)
router.get('/article/:id', reporter.showEditor)

// --- json ---
router.post('/api/article', todo('create article'))
router.patch('/api/article/:id', todo('autosave draft'))
router.post('/api/article/:id/submit', todo('send to editor'))

module.exports = router
