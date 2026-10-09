const express = require('express')
const mongoose = require('mongoose')
const { requireRole } = require('../middleware/auth')
const { ROLES } = require('../models/User')
const analytics = require('../services/analytics')

const router = express.Router()

router.use(requireRole(ROLES.EDITOR))

// live articles for the picker on the analytics page, most read first, a page
// at a time. Query: q (title contains), skip, limit (default 20, max 50).
// Returns { articles, hasMore, total }
router.get('/articles', async (req, res) => {
  res.json(await analytics.listArticles(req.query))
})

// views over time plus the points where an editor published an update.
// Query: range (24h | 7d | 30d | all), interval (5m | 1h | 1d, else picked
// from the range), tz (the browser's IANA zone, so days are local days)
router.get('/article/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Article not found' })

  const data = await analytics.articleViews(req.params.id, req.query)
  if (!data) return res.status(404).json({ error: 'Article not found' })
  res.json(data)
})

module.exports = router
