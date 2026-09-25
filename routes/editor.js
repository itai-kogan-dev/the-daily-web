const express = require('express')
const { requireRole } = require('../middleware/auth')
const { ROLES } = require('../models/User')

const router = express.Router()

// guards every route in this file
router.use(requireRole(ROLES.EDITOR))

const todo = name => (req, res) => res.status(501).send(`TODO: ${name}`)

// --- articles: pages ---
router.get('/', (req, res) => res.render('editor/queue'))
router.get('/article/:id', (req, res) => res.render('editor/review'))
router.get('/analytics', (req, res) => res.render('editor/analytics'))

// --- articles: json ---
router.patch('/api/article/:id', todo('editor edits the article'))
router.post('/api/article/:id/publish', todo('approve and publish'))
router.post('/api/article/:id/return', todo('send back with a note'))
router.delete('/api/article/:id', todo('delete article'))
router.delete('/api/article/:id/views', todo('clear view stats'))

// --- users: pages ---
// There is no sign up. Reporters and editors are staff, so an editor creates
// their accounts. The very first editor comes from the seed script.
router.get('/users', (req, res) => res.render('editor/users'))
router.get('/users/new', (req, res) => res.render('editor/user-edit'))
router.get('/users/:id', (req, res) => res.render('editor/user-edit'))

// --- users: json ---
router.post('/api/users', todo('create user'))
router.patch('/api/users/:id', todo('update user'))
router.delete('/api/users/:id', todo('delete user'))

// --- comments: moderation ---
router.patch('/api/comments/:id', todo('edit a comment'))
router.delete('/api/comments/:id', todo('delete a comment'))

module.exports = router
