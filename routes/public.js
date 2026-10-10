const express = require('express')
const { commentRateLimit } = require('../middleware/rateLimit')
const publicController = require('../controllers/publicController')

const router = express.Router()

// --- pages (server rendered) ---
router.get('/', publicController.feedPage)
// must render the full article server side - the spec requires the text to be in
// the HTML with JavaScript turned off, for search engines
router.get('/article/:id', publicController.articlePage)

// --- json for the browser ---
router.get('/api/articles', publicController.listArticles)
// ids only, so the unread filter can count the whole feed in one request
router.get('/api/articles/ids', publicController.articleIds)
router.get('/api/articles/:id/comments', publicController.listComments)
router.post('/api/articles/:id/comments', publicController.requireLiveArticle, commentRateLimit, publicController.addComment)

module.exports = router
