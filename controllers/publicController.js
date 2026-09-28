const mongoose = require('mongoose')
const Article = require('../models/Article')
const { CATEGORIES, CATEGORY_LABELS } = Article

// Ten is what fits the feed column without an article being pushed off screen.
const PAGE_SIZE = 10
const SORTS = ['date', 'popular']
const DEFAULT_SORT = 'date'

function makeError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

// Anything we do not recognise is dropped rather than rejected, so an old link
// or a hand typed query still lands on a working page.
function readQuery(query = {}) {
  return {
    page: Math.max(1, parseInt(query.page, 10) || 1),
    sort: SORTS.includes(query.sort) ? query.sort : DEFAULT_SORT,
    category: CATEGORIES.includes(query.category) ? query.category : null,
    q: String(query.q || '').trim()
  }
}

// isLive, never status. docs/DECISIONS.md has the reasoning: an article that is
// live with an update waiting for approval has to stay in the feed, and status
// would have hidden exactly that case.
function feedMatch({ category, q }) {
  const match = { isLive: true }
  if (category) match['publishedContent.category'] = category

  // uses the text index models/Article.js declares, instead of a regex that
  // would have to read every article
  if (q) match.$text = { $search: q }

  return match
}

// Relevance leads when there is a search term, and the chosen order breaks the
// tie, so "most popular" still means something while searching.
function sortFor(sort, hasQuery) {
  if (sort === 'popular') {
    return hasQuery ? { relevance: -1, viewCount: -1, publishedAt: -1 } : { viewCount: -1, publishedAt: -1 }
  }
  return hasQuery ? { relevance: -1, publishedAt: -1 } : { publishedAt: -1 }
}

function rowsPipeline(options) {
  const { page, sort, q } = options

  return [
    { $match: feedMatch(options) },

    // Mongo refuses to sort a $text query by an ordinary field, so the score
    // has to become a real field before the sort stage sees it
    ...(q ? [{ $addFields: { relevance: { $meta: 'textScore' } } }] : []),
    { $sort: sortFor(sort, Boolean(q)) },
    { $skip: (page - 1) * PAGE_SIZE },
    { $limit: PAGE_SIZE },

    // The byline. populate() does not work on an aggregation, and looking it up
    // here costs the ten rows on this page rather than the whole feed.
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

// One run of the query. The count is a second aggregation rather than a
// countDocuments() because $text is only guaranteed to work inside a pipeline.
async function runFeed(options) {
  const [rows, counted] = await Promise.all([
    Article.aggregate(rowsPipeline(options)),
    Article.aggregate([{ $match: feedMatch(options) }, { $count: 'n' }])
  ])

  const total = counted.length ? counted[0].n : 0

  return {
    items: rows.map(toCard),
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE))
  }
}

// The published version, flattened. The API has no business handing out
// anything shaped like the database - and the cards never need the body.
function toCard(row) {
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

// Builds a link to the feed with some of the parameters replaced. Partial on
// purpose: changing the sort must not throw away the search. Any change starts
// again at page one, and only the pager asks for a specific page. Empty values
// are left out, so a default feed is just "/" rather than a string of no-ops.
function feedLink(query, overrides = {}) {
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

// The controls need links that work on their own, before any script runs - and
// the whole page is a working feed with the browser's JavaScript turned off.
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
function toParagraphs(body) {
  return String(body || '')
    .split(/\n\s*\n/)
    .map(part => part.trim())
    .filter(Boolean)
}

function lastUpdateAt(article) {
  const events = article.updateEvents || []
  return events.length ? events[events.length - 1].at : null
}

async function feedPage(req, res) {
  const feed = await findFeed(req.query)

  res.render('feed', {
    ...feed,
    CATEGORIES,
    CATEGORY_LABELS,
    feedLink: (overrides) => feedLink(req.query, overrides)
  })
}

// The whole article has to be in the HTML, not fetched afterwards: the spec
// wants the text there with JavaScript turned off, and it is what the article
// page is for.
async function articlePage(req, res) {
  const article = await findLiveArticle(req.params.id)
  const content = article.publishedContent

  res.render('article', {
    article,
    content,
    paragraphs: toParagraphs(content.body),
    // null until an editor has approved a second version, so the page can say
    // "first published" instead of claiming it was never updated
    updatedAt: lastUpdateAt(article),
    CATEGORY_LABELS,
    // the category link back to the feed, filtered
    feedLink: (overrides) => feedLink({}, overrides)
  })
}

module.exports = {
  findFeed, listArticles, feedPage, feedLink,
  articlePage, findLiveArticle, toParagraphs,
  PAGE_SIZE, SORTS, DEFAULT_SORT, readQuery
}
