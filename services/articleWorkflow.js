const { STATUS } = require('../models/Article')

// The only moves the spec allows. Anything not listed here is rejected.
// published -> in_progress is not in the spec's list, but the spec does say
// that editing an already published article sends the new version through
// the same approval process - and that process starts at in_progress.
const LEGAL_TRANSITIONS = {
  [STATUS.IN_PROGRESS]:    [STATUS.PENDING_EDITOR],
  [STATUS.PENDING_EDITOR]: [STATUS.PUBLISHED, STATUS.NEEDS_REVISION],
  [STATUS.NEEDS_REVISION]: [STATUS.PENDING_EDITOR],
  [STATUS.PUBLISHED]:      [STATUS.IN_PROGRESS]
}

// Every picture is uploaded and lives in the database, so the only shape a
// valid image takes is the path to one.
function isValidImageSource(value) {
  return /^\/images\/[a-f0-9]{24}$/i.test(value)
}

// A draft can be half written, but anything leaving the reporter has to be
// complete - all of it ends up on the public page. Checked on the way in and
// again on the way out, so an editor cannot publish a broken article either.
function assertPublishable(article) {
  const content = article.draftContent

  const missing = []
  if (!content.title.trim() || content.title === 'Untitled') missing.push('title')
  if (!content.summary.trim()) missing.push('summary')
  if (!content.body.trim()) missing.push('body')
  if (!content.imagePath.trim()) missing.push('image')
  if (missing.length) throw httpError(400, 'Still missing: ' + missing.join(', '))

  if (!isValidImageSource(content.imagePath)) {
    throw httpError(400, 'The image is not a valid picture')
  }
}

function canTransition(from, to) {
  return (LEGAL_TRANSITIONS[from] || []).includes(to)
}

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

// the check has to happen on the server because anyone can send a request
// without going through our UI
function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw httpError(400, `Illegal transition: ${from} -> ${to}`)
  }
}

// reporter sends their work to the editor
function submitForReview(article) {
  assertTransition(article.status, STATUS.PENDING_EDITOR)
  assertPublishable(article)
  article.status = STATUS.PENDING_EDITOR
  return article
}

// reporter opens a published article to edit it. draftContent already holds
// a copy of what is live, so they carry on from there
function startNewVersion(article) {
  assertTransition(article.status, STATUS.IN_PROGRESS)
  article.status = STATUS.IN_PROGRESS
  return article
}

// editor approves. this is the moment the draft becomes what readers see
function publish(article, editorId) {
  assertTransition(article.status, STATUS.PUBLISHED)
  assertPublishable(article)

  // toObject() so we copy the values. assigning the subdocument directly
  // would leave both fields pointing at the same object
  article.publishedContent = article.draftContent.toObject()
  article.status = STATUS.PUBLISHED
  article.isLive = true
  article.editorNote = ''

  // publishedAt is the first publication only, so an old article doesn't
  // jump to the top of the feed after a typo fix
  if (!article.publishedAt) article.publishedAt = new Date()

  article.updateEvents.push({ at: new Date(), editor: editorId })
  return article
}

// editor sends it back with a note. publishedContent is untouched, so an
// article that was already live stays live and readers see no change
function returnForRevision(article, note) {
  assertTransition(article.status, STATUS.NEEDS_REVISION)
  article.status = STATUS.NEEDS_REVISION
  article.editorNote = note
  return article
}

// Who may change or remove an article depends on whose hands it is in. The
// editor acts on what was sent for approval; an article still with the
// reporter is theirs until they send it. Between the two rules below every
// article always has exactly one person who can delete it.
function canEditorEdit(article) {
  return article.status === STATUS.PENDING_EDITOR
}

// pending, or live - taking something off the site is the editor's call
function canEditorDelete(article) {
  return article.status === STATUS.PENDING_EDITOR || article.isLive
}

// an unpublished draft that is back in the reporter's hands
function canReporterDelete(article) {
  return !article.isLive && [STATUS.IN_PROGRESS, STATUS.NEEDS_REVISION].includes(article.status)
}

// The parts of an article a reporter edits, named the way a person would.
const CONTENT_FIELDS = { title: 'title', category: 'category', summary: 'summary', body: 'body', imagePath: 'image' }

// which parts of a draft differ from the live version, for the review pages
function changedFields(live, draft) {
  if (!live || !draft) return []
  return Object.entries(CONTENT_FIELDS)
    .filter(([key]) => (live[key] || '') !== (draft[key] || ''))
    .map(([, label]) => label)
}

module.exports = {
  changedFields,
  canEditorEdit,
  canEditorDelete,
  canReporterDelete,
  isValidImageSource,
  submitForReview,
  startNewVersion,
  publish,
  returnForRevision
}
