const express = require('express')
const { requireRole } = require('../middleware/auth')
const { ROLES } = require('../models/User')
const editor = require('../controllers/editorController')
const users = require('../controllers/userController')

const router = express.Router()

// guards every route in this file
router.use(requireRole(ROLES.EDITOR))

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
// /users/new has to come first, otherwise :id would match the word "new"
router.get('/users', users.showUsers)
router.get('/users/new', users.showNewUser)
router.get('/users/:id', users.showEditUser)

// --- users: json ---
router.post('/api/users', users.createUser)
router.patch('/api/users/:id', users.updateUser)
router.delete('/api/users/:id', users.deleteUser)

// comment moderation
router.patch('/api/comments/:id', editor.editComment)
router.delete('/api/comments/:id', editor.deleteComment)

module.exports = router
