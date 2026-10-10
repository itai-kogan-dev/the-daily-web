const mongoose = require('mongoose')
const analytics = require('../services/analytics')
const { makeError } = require('../utils/makeError')

// the page is a shell - public/js/analytics.js fills it from the two below
function showAnalytics(req, res) {
  res.render('editor/analytics')
}

// Live articles for the picker, most read first, a page at a time.
// Query: q (title contains), skip, limit (default 20, max 50).
// Returns { articles, hasMore, total }
async function listArticles(req, res) {
  res.json(await analytics.listArticles(req.query))
}

// Views over time plus the points where an editor published an update.
// Query: range (24h | 7d | 30d | all), interval (5m | 1h | 1d, else picked
// from the range), tz (the browser's time zone, so days are local days)
async function showArticleViews(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw makeError(404, 'Article not found')

  const data = await analytics.articleViews(req.params.id, req.query)
  if (!data) throw makeError(404, 'Article not found')
  res.json(data)
}

module.exports = { showAnalytics, listArticles, showArticleViews }
