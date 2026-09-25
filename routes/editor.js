const express = require('express')
const { requireRole } = require('../middleware/auth')
const { ROLES } = require('../models/User')

const router = express.Router()

router.use(requireRole(ROLES.EDITOR))

const todo = name => (req, res) => res.status(501).send(`TODO: ${name}`)

// --- pages ---
router.get('/', todo('article queue, filtered by status'))
router.get('/article/:id', todo('review: published version vs pending one'))
router.get('/analytics', todo('impact analytics'))

// --- json ---
router.patch('/api/article/:id', todo('editor edits the article'))
router.post('/api/article/:id/publish', todo('approve and publish'))
router.post('/api/article/:id/return', todo('send back with a note'))
router.delete('/api/article/:id', todo('delete article'))

module.exports = router
