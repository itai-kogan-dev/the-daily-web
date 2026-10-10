const mongoose = require('mongoose')
const Article = require('../models/Article')
const { STATUS, STATUS_LABELS, CATEGORIES, CATEGORY_LABELS } = Article
const EditorDraft = require('../models/EditorDraft')
const workflow = require('../services/articleWorkflow')
const imageStore = require('../services/imageStore')
const { makeError } = require('../utils/makeError')

// A reporter can work on an article in these states. pending_editor is missing
// on purpose - it is with the editor, and the spec has no transition out of it
// back to the reporter.
const EDITABLE = [STATUS.IN_PROGRESS, STATUS.NEEDS_REVISION, STATUS.PUBLISHED]

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

  // counted over all of their articles, so the pills stay right while filtered
  const counts = await Article.countByStatus({ author: new mongoose.Types.ObjectId(author) })

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
    changed: [],
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
    changed: workflow.changedFields(article.publishedContent, article.draftContent),
    CATEGORIES, CATEGORY_LABELS, STATUS, STATUS_LABELS
  })
}

// First save of a new article - nothing exists until this runs.
// Creating is the one place we refuse empty content, otherwise the API could be
// used to fill the database. Updating stays permissive so no work is lost.
async function createArticle(req, res) {
  const content = workflow.readContent(req.body)
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
  article.draftContent = workflow.readContent(req.body, article.draftContent)
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

module.exports = { showDashboard, showNewEditor, showEditor, createArticle, saveDraft, submitArticle, deleteArticle }
