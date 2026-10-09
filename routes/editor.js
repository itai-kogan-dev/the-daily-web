const express = require('express')
const { requireRole } = require('../middleware/auth')
const { ROLES } = require('../models/User')
const editor = require('../controllers/editorController')

const router = express.Router()

// guards every route in this file
router.use(requireRole(ROLES.EDITOR))

const todo = name => (req, res) => res.status(501).send(`TODO: ${name}`)

// pages
router.get('/', editor.showQueue)
router.get('/article/:id', editor.showReview)
router.get('/analytics', (req, res) => res.render('editor/analytics'))

// article json, editor side
router.patch('/api/article/:id', editor.editDraft)
router.post('/api/article/:id/publish', editor.publishArticle)
router.post('/api/article/:id/return', editor.returnArticle)
router.delete('/api/article/:id', editor.deleteArticle)
router.delete('/api/article/:id/views', editor.clearViews)

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

// comment moderation
router.patch('/api/comments/:id', editor.editComment)
router.delete('/api/comments/:id', editor.deleteComment)

module.exports = router
