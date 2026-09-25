const express = require('express')
const { requireRole } = require('../middleware/auth')
const { ROLES } = require('../models/User')

const router = express.Router()

router.use(requireRole(ROLES.EDITOR))

const todo = name => (req, res) => res.status(501).send(`TODO: ${name}`)

// views over time plus the points where an editor published an update
router.get('/article/:id', todo('view counts over time'))

module.exports = router
