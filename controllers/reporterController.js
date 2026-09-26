const mongoose = require('mongoose')
const Article = require('../models/Article')
const { STATUS, STATUS_LABELS, CATEGORIES, CATEGORY_LABELS } = require('../models/Article')

// A reporter can work on an article in these states. pending_editor is missing
// on purpose - it is with the editor, and the spec has no transition out of it
// back to the reporter.
const EDITABLE = [STATUS.IN_PROGRESS, STATUS.NEEDS_REVISION, STATUS.PUBLISHED]

function fail(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

// Loads an article and checks it belongs to this reporter. Ownership is
// compared against the session, never against anything the request sent.
async function findOwn(id, userId) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw fail(404, 'Article not found')

  const article = await Article.findById(id)
  if (!article) throw fail(404, 'Article not found')
  if (String(article.author) !== String(userId)) throw fail(403, 'This is not your article')

  return article
}

// A reporter only ever sees their own articles. The filter on author is the
// thing doing that - it runs on the server, off the session, so it cannot be
// changed from the browser.
async function showDashboard(req, res) {
  const articles = await Article.find({ author: req.session.user.id })
    .sort({ updatedAt: -1 })
    .lean()

  res.render('reporter/dashboard', { articles, STATUS, STATUS_LABELS, CATEGORY_LABELS })
}

// Empty form. Nothing is written to the database until the first save.
function showNewEditor(req, res) {
  res.render('reporter/edit', {
    article: null,
    content: { title: '', summary: '', body: '', category: CATEGORIES[0], imageUrl: '' },
    canEdit: true,
    CATEGORIES, CATEGORY_LABELS, STATUS, STATUS_LABELS
  })
}

async function showEditor(req, res) {
  const article = await findOwn(req.params.id, req.session.user.id)

  // An article waiting for the editor still opens, just read only - sending a
  // reporter a 403 for clicking a row on their own dashboard would be unkind.
  res.render('reporter/edit', {
    article,
    content: article.draftContent,
    canEdit: EDITABLE.includes(article.status),
    CATEGORIES, CATEGORY_LABELS, STATUS, STATUS_LABELS
  })
}

module.exports = { showDashboard, showNewEditor, showEditor, findOwn, EDITABLE, fail }
