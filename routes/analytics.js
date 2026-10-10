const express = require('express')
const { requireRole } = require('../middleware/auth')
const { ROLES } = require('../models/User')
const analytics = require('../controllers/analyticsController')

const router = express.Router()

router.use(requireRole(ROLES.EDITOR))

router.get('/articles', analytics.listArticles)
router.get('/article/:id', analytics.showArticleViews)

module.exports = router
