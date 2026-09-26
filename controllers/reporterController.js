const Article = require('../models/Article')
const { STATUS, STATUS_LABELS, CATEGORY_LABELS } = require('../models/Article')

// A reporter only ever sees their own articles. The filter on author is the
// thing doing that - it runs on the server, off the session, so it cannot be
// changed from the browser.
async function showDashboard(req, res) {
  const articles = await Article.find({ author: req.session.user.id })
    .sort({ updatedAt: -1 })
    .lean()

  res.render('reporter/dashboard', {
    articles,
    STATUS,
    STATUS_LABELS,
    CATEGORY_LABELS
  })
}

module.exports = { showDashboard }
