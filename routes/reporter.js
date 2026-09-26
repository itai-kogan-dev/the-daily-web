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
router.get('/article/new', (req, res) => res.render('reporter/edit'))
router.get('/article/:id', (req, res) => res.render('reporter/edit'))

// --- json ---
router.post('/api/article', todo('create article'))
router.patch('/api/article/:id', todo('autosave draft'))
router.post('/api/article/:id/submit', todo('send to editor'))

module.exports = router
