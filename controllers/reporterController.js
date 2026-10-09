const mongoose = require('mongoose')
const Article = require('../models/Article')
const { STATUS, STATUS_LABELS, CATEGORIES, CATEGORY_LABELS } = Article
const EditorDraft = require('../models/EditorDraft')
const workflow = require('../services/articleWorkflow')
const imageStore = require('../services/imageStore')

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
  const author = req.session.user.id
  const statuses = Object.values(STATUS)

  // ?status=x narrows the list. Anything else in the query is ignored, so a
  // made up value shows everything rather than erroring.
  const filter = statuses.includes(req.query.status) ? req.query.status : null

  const query = { author }
  if (filter) query.status = filter

  const articles = await Article.find(query).sort({ updatedAt: -1 }).lean()

  // one pass over the whole set for the tab counts, filtered or not
  const grouped = await Article.aggregate([
    { $match: { author: new mongoose.Types.ObjectId(author) } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ])
  const counts = { all: 0 }
  for (const status of statuses) counts[status] = 0
  for (const row of grouped) {
    counts[row._id] = row.count
    counts.all += row.count
  }

  // Anything the editor sent back goes to the top - it is the only thing on
  // this page that is actually waiting on the reporter.
  const needsWork = articles.filter(article => article.status === STATUS.NEEDS_REVISION)
  const rest = articles.filter(article => article.status !== STATUS.NEEDS_REVISION)

  res.render('reporter/dashboard', {
    articles: [...needsWork, ...rest],
    counts,
    filter,
    statuses,
    STATUS, STATUS_LABELS, CATEGORY_LABELS
  })
}

// Empty form. Nothing is written to the database until the first save.
function showNewEditor(req, res) {
  res.render('reporter/edit', {
    article: null,
    content: { title: '', summary: '', body: '', category: CATEGORIES[0], imagePath: '' },
    imageName: null,
    canEdit: true,
    canDelete: false,
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
    imageName: await imageStore.findImageName(article.draftContent.imagePath),
    canEdit: EDITABLE.includes(article.status),
    canDelete: workflow.canReporterDelete(article),
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
    imagePath: (body.imagePath ?? current.imagePath ?? '').trim()
  }
}

// Stores the picture and hands back the path to it. The article is not touched
// here - the client puts the path in the form and the next autosave carries it
// like any other field.
async function uploadImage(req, res) {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw makeError(400, 'No picture received')
  }

  const url = await imageStore.saveImage(req.body, {
    filename: (req.get('X-Image-Name') || 'image').slice(0, 120),
    contentType: req.get('Content-Type')
  })

  res.status(201).json({ url })
}

// First save of a new article - nothing exists until this runs.
// Creating is the one place we refuse empty content, otherwise the API could be
// used to fill the database. Updating stays permissive so no work is lost.
async function createArticle(req, res) {
  const content = readContent(req.body)
  const isEmpty = content.title === 'Untitled' && !content.summary && !content.body.trim() && !content.imagePath
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

async function submitArticle(req, res) {
  const article = await findOwnArticle(req.params.id, req.session.user.id)

  if (article.status === STATUS.PUBLISHED) {
    throw makeError(400, 'Nothing to send - change something first')
  }

  // the workflow checks both that the move is legal and that the article is
  // complete enough to leave the reporter
  workflow.submitForReview(article)
  await article.save()

  // the editor starts from what was just sent, never from an older copy
  await EditorDraft.deleteMany({ article: article._id })

  res.json({ status: article.status, statusLabel: STATUS_LABELS[article.status] })
}

// Only a draft that never went live, so there are no comments or views to
// clean up. Anything readers have seen is the editor's to remove.
async function deleteArticle(req, res) {
  const article = await findOwnArticle(req.params.id, req.session.user.id)
  if (!workflow.canReporterDelete(article)) {
    throw makeError(403, 'Only a draft that has never been published can be deleted')
  }

  await EditorDraft.deleteMany({ article: article._id })
  await article.deleteOne()

  res.json({ deleted: true })
}

module.exports = { showDashboard, showNewEditor, showEditor, createArticle, saveDraft, submitArticle, deleteArticle, uploadImage }
