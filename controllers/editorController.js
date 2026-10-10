const mongoose = require('mongoose')
const Article = require('../models/Article')
const { STATUS, STATUS_LABELS, CATEGORIES, CATEGORY_LABELS } = Article
const Comment = require('../models/Comment')
const ViewBucket = require('../models/ViewBucket')
const workflow = require('../services/articleWorkflow')
const imageStore = require('../services/imageStore')
const { makeError } = require('../utils/makeError')
const { readString } = require('../utils/readString')
const { PAGE_SIZE, buildPager } = require('../utils/paging')

// bad id and missing article end up the same - 404 via the error handler
async function findArticle(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw makeError(404, 'Article not found')

  const article = await Article.findById(id)
    .populate('author', 'displayName')
    .populate('updateEvents.editor', 'displayName')
  if (!article) throw makeError(404, 'Article not found')

  return article
}

// whole queue, not just one reporter's share. a made up ?status= shows
// everything, same as the reporter dashboard does
async function showQueue(req, res) {
  const statuses = Object.values(STATUS)

  const filter = statuses.includes(req.query.status) ? req.query.status : null

  const query = {}
  if (filter) query.status = filter

  // counted over everything, so the pills stay right while filtered
  const counts = await Article.countByStatus()
  const pager = buildPager('/editor', filter, req.query.page, filter ? counts[filter] : counts.all)

  // pending first - it is the only thing actually waiting on the editor. The
  // order is decided in the database, so it holds across pages, not just
  // within one
  const articles = await Article.aggregate([
    { $match: query },
    // only what a queue row shows, so the sort does not carry whole articles
    { $project: {
      status: 1, isLive: 1, author: 1, updatedAt: 1,
      'draftContent.title': 1, 'draftContent.summary': 1, 'draftContent.imagePath': 1, 'draftContent.category': 1,
      waiting: { $eq: ['$status', STATUS.PENDING_EDITOR] }
    }},
    { $sort: { waiting: -1, updatedAt: -1, _id: -1 } },
    { $skip: pager.skip },
    { $limit: PAGE_SIZE },
    // the byline, looked up for these rows only - same as the public feed
    { $lookup: { from: 'users', localField: 'author', foreignField: '_id', as: 'author', pipeline: [{ $project: { displayName: 1 } }] } },
    { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } }
  ])

  res.render('editor/queue', {
    articles,
    counts,
    filter,
    statuses,
    pager,
    STATUS, STATUS_LABELS, CATEGORY_LABELS
  })
}

async function showReview(req, res) {
  const article = await findArticle(req.params.id)

  // the editor's own in-progress copy when one exists, otherwise what the
  // reporter submitted. opening the page never creates anything - the first
  // autosave does that. Only an article waiting for approval can be edited.
  const canEdit = workflow.canEditorEdit(article)
  const hasDraft = canEdit && Boolean(article.editorContent)
  const content = (hasDraft ? article.editorContent : article.draftContent).toObject()

  const comments = await Comment.find({ article: article._id })
    .sort({ createdAt: 1 })
    .lean()

  res.render('editor/review', {
    article,
    content,
    hasDraft,
    canEdit,
    canDelete: workflow.canEditorDelete(article),
    changed: workflow.listChangedFields(article.publishedContent, content),
    imageName: await imageStore.findImageName(content.imagePath),
    comments,
    STATUS, STATUS_LABELS, CATEGORIES, CATEGORY_LABELS
  })
}

// the editor's typing lands in their private copy only. the reporter's
// draftContent, the live page and the status are never touched here
async function editDraft(req, res) {
  const article = await findArticle(req.params.id)
  if (!workflow.canEditorEdit(article)) {
    throw makeError(403, 'Only articles waiting for approval can be edited')
  }

  const content = workflow.readContent(req.body, article.editorContent || article.draftContent)

  // Matched on the status too, so a save that lands just after a publish or
  // send back cannot leave a copy behind. timestamps: false keeps the
  // article's updatedAt, which orders the staff lists, for real changes only.
  const result = await Article.updateOne(
    { _id: article._id, status: STATUS.PENDING_EDITOR },
    { $set: { editorContent: content } },
    { timestamps: false, runValidators: true }
  )
  if (result.matchedCount === 0) throw makeError(403, 'Only articles waiting for approval can be edited')

  res.json({
    savedAt: new Date(),
    status: article.status,
    statusLabel: STATUS_LABELS[article.status]
  })
}

// What the editor saw is what goes out, so their own copy, when there is one,
// replaces the submitted draft before publishing or sending back. Cleared in
// the same save, so it never outlives the review.
function applyEditorContent(article) {
  if (article.editorContent) article.draftContent = article.editorContent.toObject()
  article.editorContent = null
}

// approval. the workflow owns the transition, this just carries the article
// there and back. a failed publish keeps the editor's copy
async function publishArticle(req, res) {
  const article = await findArticle(req.params.id)

  applyEditorContent(article)
  workflow.publish(article, req.session.user.id)
  await article.save()

  res.json({ status: article.status, isLive: article.isLive, publishedAt: article.publishedAt })
}

// sends the draft back with a note. this is the only moment the editor's
// copy overwrites the reporter's version. what is already live stays as it
// is - the workflow never touches the live copy on this path
async function returnArticle(req, res) {
  const article = await findArticle(req.params.id)

  const note = readString((req.body || {}).note).trim()
  if (!note) throw makeError(400, 'Write a note so the reporter knows what to fix')
  if (note.length > 1000) throw makeError(400, 'The note is too long')

  applyEditorContent(article)
  workflow.returnForRevision(article, note)
  await article.save()

  res.json({ status: article.status, editorNote: article.editorNote })
}

async function deleteArticle(req, res) {
  const article = await findArticle(req.params.id)
  if (!workflow.canEditorDelete(article)) {
    throw makeError(403, 'This article is with the reporter - it can be deleted once it is sent for approval or published')
  }

  await Comment.deleteMany({ article: article._id })
  await ViewBucket.deleteMany({ article: article._id })
  await article.deleteOne()

  res.json({ deleted: true })
}

// wipes the counted views for one article, the article itself stays
async function clearViews(req, res) {
  const article = await findArticle(req.params.id)

  try {
    const session = await mongoose.startSession()
    let cleared
    try {
      await session.withTransaction(async () => {
        const result = await ViewBucket.deleteMany({ article: article._id }).session(session)
        cleared = result.deletedCount
        article.viewCount = 0
        await article.save({ session })
      })
    } finally {
      await session.endSession()
    }
    res.json({ cleared })
    return
  } catch (err) {
    // standalone MongoDB has no transaction support, so fall back to the plain
    // non-atomic clear below. Anything else is a real failure and is reported
    const unsupported = err.code === 20 || /replica set|Transaction numbers/i.test(err.message)
    if (!unsupported) throw err
  }

  const result = await ViewBucket.deleteMany({ article: article._id })
  article.viewCount = 0
  await article.save()

  res.json({ cleared: result.deletedCount })
}

async function findComment(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw makeError(404, 'Comment not found')

  const comment = await Comment.findById(id)
  if (!comment) throw makeError(404, 'Comment not found')

  return comment
}

async function editComment(req, res) {
  const comment = await findComment(req.params.id)

  const text = readString((req.body || {}).body).trim()
  if (!text) throw makeError(400, 'Comment text is required')
  if (text.length > 1000) throw makeError(400, 'Comment is too long')

  comment.body = text
  await comment.save()

  res.json({
    _id: comment._id,
    id: String(comment._id),
    body: comment.body,
    updatedAt: comment.updatedAt
  })
}

async function deleteComment(req, res) {
  const comment = await findComment(req.params.id)

  await comment.deleteOne()

  res.json({ deleted: true })
}

module.exports = {
  showQueue,
  showReview,
  editDraft,
  publishArticle,
  returnArticle,
  deleteArticle,
  clearViews,
  editComment,
  deleteComment
}
