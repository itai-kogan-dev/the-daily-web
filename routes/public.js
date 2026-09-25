const express = require('express')

const router = express.Router()

// stand-in until the owner of this track implements the route
const todo = name => (req, res) => res.status(501).send(`TODO: ${name}`)

// --- pages (server rendered) ---
router.get('/', (req, res) => res.render('feed'))
// must render the full article server side - the spec requires the text to be
// in the HTML with JavaScript turned off, for search engines
router.get('/article/:id', (req, res) => res.render('article'))

// --- json for the browser ---
router.get('/api/articles', todo('list articles: search, filter, sort, paging'))
router.get('/api/articles/:id/comments', todo('list comments'))
router.post('/api/articles/:id/comments', todo('add comment'))
router.get('/api/weather', todo('weather widget'))

module.exports = router
