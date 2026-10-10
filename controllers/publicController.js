const mongoose = require('mongoose')
const Article = require('../models/Article')
const Comment = require('../models/Comment')
const viewCounter = require('../services/viewCounter')
const { makeError } = require('../utils/makeError')
const { escapeRegExp } = require('../utils/escapeRegExp')
const { CATEGORIES, CATEGORY_LABELS } = Article

// Twenty at a time. The spec loads 20 more articles as the reader reaches the
// end of the feed, so both the server page and every API page are 20.
const PAGE_SIZE = 20
const SORTS = ['date', 'popular']
const DEFAULT_SORT = 'date'

// Matches the maxlength on the search box in views/feed.ejs.
const SEARCH_MAX = 80

// The most recent hundred comments of one article. There is no paging on this
// endpoint - the spec does not ask for one - so the cap is what stops a heavily
// commented article from handing a guest an unbounded list. The newest are kept
// rather than the oldest, because the earliest 100 of 5000 is no use to anyone.
const COMMENTS_LIMIT = 100

// Anything we do not recognise is dropped rather than rejected, so an old link
// or a hand typed query still lands on a working page.
function readQuery(query = {}) {
  return {
    page: Math.max(1, parseInt(query.page, 10) || 1),
    sort: SORTS.includes(query.sort) ? query.sort : DEFAULT_SORT,
    category: CATEGORIES.includes(query.category) ? query.category : null,
    // capped to the length of the search box. A hand typed URL is the only way
    // to get here, and a 10,000 character pattern is a slow query to hand to
    // the database because someone was feeling curious.
    q: String(query.q || '').trim().slice(0, SEARCH_MAX)
  }
}

// each word is matched on its own, so "old port" also finds "the port is old"
function splitSearchTerms(q) {
  return q.split(/\s+/).filter(Boolean)
}

// isLive, never status. docs/DECISIONS.md has the reasoning: an article that is
// live with an update waiting for approval has to stay in the feed, and status
// would have hidden exactly that case.
function buildFeedMatch({ category, q }) {
  const match = { isLive: true }
  if (category) match['publishedContent.category'] = category

  // Part of a word matches too, so "por" finds "sport". No index can serve a
  // regex, so this reads every live article - see docs/DECISIONS.md. No /g
  // flag: a global regex keeps lastIndex between uses and skips matches.
  if (q) {
    match.$and = splitSearchTerms(q).map(term => {
      const pattern = new RegExp(escapeRegExp(term), 'i')
      return { $or: [{ 'publishedContent.title': pattern }, { 'publishedContent.summary': pattern }] }
    })
  }

  return match
}

// a search only narrows the feed - results come in the chosen sort order
function pickSort(sort) {
  return sort === 'popular' ? { viewCount: -1, publishedAt: -1 } : { publishedAt: -1 }
}

function buildRowsPipeline(options) {
  const { page, sort } = options

  return [
    { $match: buildFeedMatch(options) },
    { $sort: pickSort(sort) },
    { $skip: (page - 1) * PAGE_SIZE },
    { $limit: PAGE_SIZE },

    // The byline. populate() does not work on an aggregation, and looking it up
    // here costs the rows on this page rather than the whole feed.
    { $lookup: { from: 'users', localField: 'author', foreignField: '_id', as: 'author' } },
    { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },

    // Named one by one on purpose. draftContent is the unapproved version and
    // editorNote is between the reporter and the editor, so neither can reach a
    // public endpoint. A deleted author also leaves nothing useful behind, so
    // the byline is flattened to a plain string.
    { $project: {
      publishedContent: 1,
      publishedAt: 1,
      viewCount: 1,
      authorName: { $ifNull: ['$author.displayName', 'The Daily Web'] }
    }}
  ]
}

// One run of the query. The count is a second aggregation rather than
// countDocuments() so that both halves of the response are built the same way
// from the same filter.
async function runFeed(options) {
  const [rows, counted] = await Promise.all([
    Article.aggregate(buildRowsPipeline(options)),
    Article.aggregate([{ $match: buildFeedMatch(options) }, { $count: 'n' }])
  ])

  const total = counted.length ? counted[0].n : 0

  return {
    items: rows.map(formatCard),
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE))
  }
}

// The published version, flattened. The API has no business handing out
// anything shaped like the database - and the cards never need the body.
function formatCard(row) {
  const content = row.publishedContent

  return {
    id: String(row._id),
    title: content.title,
    summary: content.summary,
    category: content.category,
    categoryLabel: CATEGORY_LABELS[content.category],
    imagePath: content.imagePath,
    publishedAt: row.publishedAt,
    viewCount: row.viewCount,
    authorName: row.authorName
  }
}

// Shared with the server rendered feed page, so both show the same articles
// with the same filters.
async function findFeed(query) {
  const options = readQuery(query)
  let result = await runFeed(options)

  // ?page=999 is something anyone can type, so it lands on the last page
  // rather than on an empty one.
  if (!result.items.length && options.page > 1 && result.total > 0) {
    options.page = result.pages
    result = await runFeed(options)
  }

  return { ...result, ...options, pageSize: PAGE_SIZE }
}

async function listArticles(req, res) {
  res.json(await findFeed(req.query))
}

// Every id the current filters match. The unread filter lives in the browser
// and counts the whole feed from these, instead of loading every page of cards.
async function listArticleIds(req, res) {
  const options = readQuery(req.query)
  const ids = await Article.distinct('_id', buildFeedMatch(options))
  res.json({ ids: ids.map(String), total: ids.length })
}

// Builds a link to the feed with some of the parameters replaced. Partial on
// purpose: changing the sort must not throw away the search. Any change starts
// again at page one, and only the pager asks for a specific page. Empty values
// are left out, so a default feed is just "/" rather than a string of no-ops.
function buildFeedLink(query, overrides = {}) {
  const next = { q: '', category: '', sort: DEFAULT_SORT, ...readQuery(query), ...overrides }
  const page = overrides.page ?? 1
  const params = new URLSearchParams()

  if (next.q) params.set('q', next.q)
  if (next.category) params.set('category', next.category)
  if (next.sort !== DEFAULT_SORT) params.set('sort', next.sort)
  if (page > 1) params.set('page', page)

  const qs = params.toString()
  return qs ? `/?${qs}` : '/'
}

// The page numbers the no-JavaScript pager shows: the first, the last, and two
// either side of the current one. A gap comes back as { gap: true } and is
// rendered as an ellipsis.
function listPageNumbers(current, pages, span = 2) {
  const wanted = new Set([1, pages])
  for (let page = current - span; page <= current + span; page++) {
    if (page >= 1 && page <= pages) wanted.add(page)
  }

  const entries = []
  let previous = 0

  for (const page of [...wanted].sort((a, b) => a - b)) {
    if (page - previous > 1) entries.push({ gap: true })
    entries.push({ page })
    previous = page
  }

  return entries
}

// Loads an article a reader is allowed to see. isLive and not status, for the
// same reason the feed is: an article is not reader visible until an editor has
// approved it, and a live article stays readable whatever its status is now.
async function findLiveArticle(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw makeError(404, 'Article not found')

  const article = await Article.findOne({ _id: id, isLive: true })
    .populate('author', 'displayName')
    .lean()

  // One answer for "no such article" and "not published yet", so the page cannot
  // be used to find out which articles exist but are still with the editor.
  if (!article) throw makeError(404, 'Article not found')

  return article
}

// The body is one string with blank lines between paragraphs. Splitting it here
// keeps the markup out of the data, and each paragraph is still escaped by the
// template on the way out - the field is plain text, not HTML.
function splitParagraphs(body) {
  return String(body || '')
    .split(/\n\s*\n/)
    .map(part => part.trim())
    .filter(Boolean)
}

function findLastUpdate(article) {
  const events = article.updateEvents || []
  // publish() records an event on the first publication too, so one event
  // means "published once", not "published and then updated".
  return events.length > 1 ? events[events.length - 1].at : null
}

async function showFeed(req, res) {
  const feed = await findFeed(req.query)

  res.render('feed', {
    ...feed,
    CATEGORIES,
    CATEGORY_LABELS,
    buildFeedLink: (overrides) => buildFeedLink(req.query, overrides),
    // the template cannot require the controller, so the pager gets it here
    listPageNumbers
  })
}

// The whole article has to be in the HTML, not fetched afterwards: the spec
// wants the text there with JavaScript turned off, and it is what the article
// page is for.
async function showArticle(req, res) {
  const article = await findLiveArticle(req.params.id)
  const content = article.publishedContent

  // Only once we know it is live, so a wrong id or an unapproved article costs
  // nothing. The spec counts a view on every read of the article page.
  await viewCounter.countView(article._id)

  res.render('article', {
    article,
    content,
    paragraphs: splitParagraphs(content.body),
    // null until an editor has approved a second version, so the page can say
    // "first published" instead of claiming it was never updated
    updatedAt: findLastUpdate(article),
    comments: await findComments(article._id),
    CATEGORY_LABELS,
    // the category link back to the feed, filtered
    buildFeedLink: (overrides) => buildFeedLink({}, overrides)
  })
}

// Comments of one article, oldest first because that is the order they were
// written in, and new ones get appended under the form.
async function findComments(articleId) {
  const [recent, total] = await Promise.all([
    Comment.find({ article: articleId })
      .sort({ createdAt: -1 })
      .limit(COMMENTS_LIMIT)
      .lean(),
    Comment.countDocuments({ article: articleId })
  ])

  return {
    items: recent.reverse().map(formatComment),
    total,
    limit: COMMENTS_LIMIT
  }
}

function formatComment(comment) {
  return {
    id: String(comment._id),
    authorName: comment.authorName,
    body: comment.body,
    createdAt: comment.createdAt
  }
}

// Cheap existence check for the endpoints that only need to know the article is
// readable. It answers with a 404 rather than letting an unapproved article be
// commented on, and the message is the same one a wrong id gets so the endpoint
// cannot be used to find out what exists.
async function assertLiveArticle(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw makeError(404, 'Article not found')
  if (!(await Article.exists({ _id: id, isLive: true }))) throw makeError(404, 'Article not found')
}

async function listComments(req, res) {
  await assertLiveArticle(req.params.id)
  res.json(await findComments(req.params.id))
}

async function addComment(req, res) {
  await assertLiveArticle(req.params.id)

  // Trimmed here as well as in the schema: a name of spaces would otherwise
  // satisfy the maxlength and leave a blank comment on the page.
  const authorName = String(req.body.authorName || '').trim()
  const body = String(req.body.body || '').trim()

  // The schema's own maxlength is the real check, but what it says is a Mongoose
  // message naming the field. The two mistakes anyone actually makes get a
  // sentence they can act on instead.
  if (!authorName || !body) throw makeError(400, 'A name and a comment are both needed')
  if (authorName.length > 60) throw makeError(400, 'That name is longer than 60 characters')
  if (body.length > 1000) throw makeError(400, 'Comments are limited to 1000 characters')

  const comment = await Comment.create({
    article: req.params.id,
    authorName,
    body
  })

  res.status(201).json(formatComment(comment))
}

module.exports = { showFeed, showArticle, listArticles, listArticleIds, listComments, addComment }
