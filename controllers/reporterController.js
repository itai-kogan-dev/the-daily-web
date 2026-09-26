const mongoose = require('mongoose')
const Article = require('../models/Article')
const { STATUS, STATUS_LABELS, CATEGORIES, CATEGORY_LABELS } = Article
const workflow = require('../services/articleWorkflow')

// A reporter can work on an article in these states. pending_editor is missing
// on purpose - it is with the editor, and the spec has no transition out of it
// back to the reporter.
const EDITABLE = [STATUS.IN_PROGRESS, STATUS.NEEDS_REVISION, STATUS.PUBLISHED]

function makeError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

// Loads an article and checks it belongs to this reporter. Ownership is
// compared against the session, never against anything the request sent.
async function findOwnArticle(id, userId) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw makeError(404, 'Article not found')

  const article = await Article.findById(id)
  if (!article) throw makeError(404, 'Article not found')
  if (String(article.author) !== String(userId)) throw makeError(403, 'This is not your article')

  return article
}

// A reporter only ever sees their own articles. The filter on author is the
// thing doing that - it runs on the server, off the session, so it cannot be
// changed from the browser.
async function showDashboard(req, res) {
  const articles = await Article.find({ author: req.session.user.id })
    .sort({ updatedAt: -1 })
    .lean()

  // Anything the editor sent back goes to the top - it is the only thing on
  // this page that is actually waiting on the reporter.
  const needsWork = articles.filter(a => a.status === STATUS.NEEDS_REVISION)
  const rest = articles.filter(a => a.status !== STATUS.NEEDS_REVISION)

  res.render('reporter/dashboard', {
    articles: [...needsWork, ...rest],
    needsWorkCount: needsWork.length,
    STATUS, STATUS_LABELS, CATEGORY_LABELS
  })
}

// Empty form. Nothing is written to the database until the first save.
function showNewEditor(req, res) {
  res.render('reporter/edit', {
    article: null,
    content: { title: '', summary: '', body: '', category: CATEGORIES[0], imageUrl: '' },
    canEdit: true,
    canSubmit: false,   // nothing exists until the first save
    CATEGORIES, CATEGORY_LABELS, STATUS, STATUS_LABELS
  })
}

async function showEditor(req, res) {
  const article = await findOwnArticle(req.params.id, req.session.user.id)

  // An article waiting for the editor still opens, just read only - sending a
  // reporter a 403 for clicking a row on their own dashboard would be unkind.
  res.render('reporter/edit', {
    article,
    content: article.draftContent,
    canEdit: EDITABLE.includes(article.status),
    // a published article with no edits yet has nothing to submit
    canSubmit: [STATUS.IN_PROGRESS, STATUS.NEEDS_REVISION].includes(article.status),
    CATEGORIES, CATEGORY_LABELS, STATUS, STATUS_LABELS
  })
}

// Pulls the content fields out of a request body. A draft is allowed to be
// half written, so nothing here is rejected for being empty - losing work to a
// validation error is exactly what the spec says must not happen.
function readContent(body, current = {}) {
  return {
    title:    (body.title    ?? current.title    ?? '').trim() || 'Untitled',
    summary:  (body.summary  ?? current.summary  ?? '').trim(),
    body:      body.body     ?? current.body     ?? '',
    category: CATEGORIES.includes(body.category) ? body.category : (current.category || CATEGORIES[0]),
    imageUrl: (body.imageUrl ?? current.imageUrl ?? '').trim()
  }
}

// First save of a new article - nothing exists until this runs.
// Creating is the one place we refuse empty content, otherwise the API could be
// used to fill the database. Updating stays permissive so no work is lost.
async function createArticle(req, res) {
  const content = readContent(req.body)
  const isEmpty = content.title === 'Untitled' && !content.summary && !content.body.trim() && !content.imageUrl
  if (isEmpty) throw makeError(400, 'Write something before the article is created')

  const article = await Article.create({
    author: req.session.user.id,
    draftContent: content
    // status defaults to in_progress, isLive to false
  })

  res.status(201).json({ id: article._id, savedAt: article.updatedAt, status: article.status })
}

// Every save after the first one.
async function saveDraft(req, res) {
  const article = await findOwnArticle(req.params.id, req.session.user.id)

  if (!EDITABLE.includes(article.status)) {
    throw makeError(403, 'This article is with the editor and cannot be changed')
  }

  // Editing something already published starts a new version. It happens on
  // the first real edit, not when the form opens, so reading an article does
  // not change its state.
  if (article.status === STATUS.PUBLISHED) workflow.startNewVersion(article)

  // publishedContent is never touched here. That is what keeps readers on the
  // approved version while this is being written.
  article.draftContent = readContent(req.body, article.draftContent.toObject())
  await article.save()

  res.json({
    savedAt: article.updatedAt,
    status: article.status,
    statusLabel: STATUS_LABELS[article.status]
  })
}

// Drafts can be half written, but an article going to an editor cannot be.
// Everything checked here ends up on the public page.
function findMissingFields(content) {
  const missing = []
  if (!content.title.trim() || content.title === 'Untitled') missing.push('title')
  if (!content.summary.trim()) missing.push('summary')
  if (!content.body.trim()) missing.push('body')
  if (!content.imageUrl.trim()) missing.push('image')
  return missing
}

async function submitArticle(req, res) {
  const article = await findOwnArticle(req.params.id, req.session.user.id)

  const missing = findMissingFields(article.draftContent)
  if (missing.length) throw makeError(400, 'Still missing: ' + missing.join(', '))

  // the workflow checks the move is legal - a published article has to be
  // edited first, which puts it back to in_progress
  workflow.submitForReview(article)
  await article.save()

  res.json({ status: article.status, statusLabel: STATUS_LABELS[article.status] })
}

module.exports = { showDashboard, showNewEditor, showEditor, createArticle, saveDraft, submitArticle }
