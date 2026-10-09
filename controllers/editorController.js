const mongoose = require('mongoose')
const Article = require('../models/Article')
const { STATUS, STATUS_LABELS, CATEGORIES, CATEGORY_LABELS } = Article
const Comment = require('../models/Comment')
const ViewBucket = require('../models/ViewBucket')
const EditorDraft = require('../models/EditorDraft')
const workflow = require('../services/articleWorkflow')
const imageStore = require('../services/imageStore')

function makeError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

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

  const raw = req.query.status
  const filter = typeof raw === 'string' && statuses.includes(raw) ? raw : null

  const query = {}
  if (filter) query.status = filter

  const articles = await Article.find(query)
    .populate('author', 'displayName')
    .sort({ updatedAt: -1 })
    .lean()

  // counted over everything so the tabs stay right while filtered
  const grouped = await Article.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ])
  const counts = { all: 0 }
  for (const status of statuses) counts[status] = 0
  for (const row of grouped) {
    if (counts[row._id] === undefined) continue
    counts[row._id] = row.count
    counts.all += row.count
  }

  // pending first - it is the only thing actually waiting on the editor
  const waiting = articles.filter(a => a.status === STATUS.PENDING_EDITOR)
  const rest = articles.filter(a => a.status !== STATUS.PENDING_EDITOR)

  res.render('editor/queue', {
    articles: [...waiting, ...rest],
    counts,
    filter,
    statuses,
    STATUS, STATUS_LABELS, CATEGORY_LABELS
  })
}

async function showReview(req, res) {
  const article = await findArticle(req.params.id)

  // the editor's own in-progress copy when one exists, otherwise what the
  // reporter submitted. opening the page never creates anything - the first
  // autosave does that. Only an article waiting for approval can be edited.
  const canEdit = workflow.canEditorEdit(article)
  const draft = canEdit ? await EditorDraft.findOne({ article: article._id }).lean() : null
  const content = draft
    ? draft.content
    : article.draftContent.toObject()

  const comments = await Comment.find({ article: article._id })
    .sort({ createdAt: 1 })
    .lean()

  res.render('editor/review', {
    article,
    content,
    hasDraft: Boolean(draft),
    canEdit,
    canDelete: workflow.canEditorDelete(article),
    // the live body as paragraphs, the same split the article page uses - one
    // <p> for the whole text would glue every paragraph together
    liveParagraphs: String((article.publishedContent && article.publishedContent.body) || '')
      .split(/\n\s*\n/)
      .map(part => part.trim())
      .filter(Boolean),
    imageName: await imageStore.findImageName(content.imagePath),
    comments,
    STATUS, STATUS_LABELS, CATEGORIES, CATEGORY_LABELS
  })
}

// picks the editable fields out of the body. drafts can be half written so
// nothing is rejected for being empty here - publish is where completeness
// is checked. losing work to a validation error is what this avoids
function readDraftContent(body, current) {
  const src = current && typeof current.toObject === 'function' ? current.toObject() : (current || {})
  const data = body || {}

  const imagePath = String(data.imagePath ?? src.imagePath ?? '').trim()
  if (imagePath && !workflow.isValidImageSource(imagePath)) {
    throw makeError(400, 'The image is not a valid picture')
  }

  return {
    title: String(data.title ?? src.title ?? 'Untitled').trim() || 'Untitled',
    summary: String(data.summary ?? src.summary ?? '').trim(),
    body: data.body ?? src.body ?? '',
    category: CATEGORIES.includes(data.category) ? data.category : (src.category || CATEGORIES[0]),
    imagePath
  }
}

// the editor's typing lands in their private copy only. the reporter's
// draftContent, the live page and the status are never touched here
async function editDraft(req, res) {
  const article = await findArticle(req.params.id)
  if (!workflow.canEditorEdit(article)) {
    throw makeError(403, 'Only articles waiting for approval can be edited')
  }

  const existing = await EditorDraft.findOne({ article: article._id })
  const seed = existing ? existing.content : article.draftContent
  const content = readDraftContent(req.body, seed)

  // Two autosaves racing each other can both miss and both try to create the
  // row; the loser gets a duplicate key error and simply writes over what the
  // winner just created. The unique index stays - it is what makes this safe.
  let draft
  try {
    draft = await EditorDraft.findOneAndUpdate(
      { article: article._id },
      { article: article._id, editor: req.session.user.id, content },
      { upsert: true, returnDocument: 'after', runValidators: true }
    )
  } catch (err) {
    if (err.code !== 11000) throw err
    draft = await EditorDraft.findOneAndUpdate(
      { article: article._id },
      { editor: req.session.user.id, content },
      { returnDocument: 'after', runValidators: true }
    )
  }

  res.json({
    savedAt: draft.updatedAt,
    status: article.status,
    statusLabel: STATUS_LABELS[article.status]
  })
}

// the picture goes to the store on its own and comes back as a path. the
// article is not touched here - the picker puts the path in the form and
// the next autosave carries it like any other field
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

// approval. the workflow owns the transition, this just carries the article
// there and back. what the editor saw is what goes live, so their copy is
// folded over the submitted draft first. a failed publish keeps the copy
async function publishArticle(req, res) {
  const article = await findArticle(req.params.id)

  const draft = await EditorDraft.findOne({ article: article._id })
  if (draft) article.draftContent = draft.content.toObject()

  workflow.publish(article, req.session.user.id)
  await article.save()
  await EditorDraft.deleteMany({ article: article._id })

  res.json({ status: article.status, isLive: article.isLive, publishedAt: article.publishedAt })
}

// sends the draft back with a note. this is the only moment the editor's
// copy overwrites the reporter's version. what is already live stays as it
// is - the workflow never touches the live copy on this path
async function returnArticle(req, res) {
  const article = await findArticle(req.params.id)

  const raw = req.body ? req.body.note : undefined
  const note = typeof raw === 'string' ? raw.trim() : ''
  if (!note) throw makeError(400, 'Write a note so the reporter knows what to fix')
  if (note.length > 1000) throw makeError(400, 'The note is too long')

  const draft = await EditorDraft.findOne({ article: article._id })
  if (draft) article.draftContent = draft.content.toObject()

  workflow.returnForRevision(article, note)
  await article.save()
  await EditorDraft.deleteMany({ article: article._id })

  res.json({ status: article.status, editorNote: article.editorNote })
}

async function deleteArticle(req, res) {
  const article = await findArticle(req.params.id)
  if (!workflow.canEditorDelete(article)) {
    throw makeError(403, 'This article is with the reporter - it can be deleted once it is sent for approval or published')
  }

  await Comment.deleteMany({ article: article._id })
  await ViewBucket.deleteMany({ article: article._id })
  await EditorDraft.deleteMany({ article: article._id })
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
    // standalone MongoDB has no transaction support, so fall back
    // to the plain non-atomic clear below. Logged, not swallowed: if the
    // fallback fails too, that error still reaches the error handler.
    console.error('[views] transaction clear failed, using plain clear -', err.message)
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

  const raw = req.body ? req.body.body : undefined
  const text = typeof raw === 'string' ? raw.trim() : ''
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
  uploadImage,
  publishArticle,
  returnArticle,
  deleteArticle,
  clearViews,
  editComment,
  deleteComment
}
