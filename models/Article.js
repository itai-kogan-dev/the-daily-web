const mongoose = require('mongoose')

// Values are what we store and compare in code, labels are what gets shown.
// Split like this so changing the wording on screen never touches the DB.
// Listed in workflow order - write it, send it, maybe get it back, it goes
// live. The dashboard tabs follow this order.
const STATUS = {
  IN_PROGRESS:    'in_progress',     // בהכנה
  PENDING_EDITOR: 'pending_editor',  // ממתינה לאישור עורך
  NEEDS_REVISION: 'needs_revision',  // הוחזרה לתיקונים
  PUBLISHED:      'published'        // פורסמה
}

const STATUS_LABELS = {
  [STATUS.IN_PROGRESS]:    'In Progress',
  [STATUS.PENDING_EDITOR]: 'Pending Editor Approval',
  [STATUS.NEEDS_REVISION]: 'Needs Revision',
  [STATUS.PUBLISHED]:      'Published'
}

const CATEGORIES = ['news', 'economy', 'sports', 'culture', 'technology', 'health']

const CATEGORY_LABELS = {
  news:       'News',
  economy:    'Economy',
  sports:     'Sports',
  culture:    'Culture',
  technology: 'Technology',
  health:     'Health'
}

// One version of the content. Rule: anything a reporter can edit goes here.
// Two copies exist so readers keep seeing publishedContent while the reporter
// works on draftContent.
// _id: false because we never look up a version on its own.
const contentSchema = new mongoose.Schema({
  title:    { type: String, required: true, trim: true },
  summary:  { type: String, default: '', trim: true },
  body:     { type: String, default: '' },
  category: { type: String, enum: CATEGORIES, required: true },
  imagePath: { type: String, default: '' }
}, { _id: false })

const articleSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // where the working version is in the approval process
  status: { type: String, enum: Object.values(STATUS), default: STATUS.IN_PROGRESS, required: true },

  // separate question from status: can readers see anything at all.
  // a live article with an update waiting is isLive true + pending_editor,
  // and it has to stay in the feed
  isLive: { type: Boolean, default: false },

  publishedContent: { type: contentSchema, default: null },   // null until first approval
  draftContent:     { type: contentSchema, required: true },

  editorNote:  { type: String, default: '' },   // why the editor sent it back
  publishedAt: { type: Date, default: null },   // first publish only, never changes

  // one entry per approval. these are the markers on the analytics graph
  // that show what happened to views after each update
  updateEvents: [{
    at:     { type: Date, required: true },
    editor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    _id:    false
  }],

  // A rollup of ViewBucket, so the feed can sort by popularity on an index
  // instead of adding up every bucket. Update it on a cadence, never once per
  // view - a bucket rotates every 5 minutes, this document stays hot forever.
  viewCount: { type: Number, default: 0 }
}, { timestamps: true })

// DB indexes. Without them Mongo reads every document to answer a query, and
// the spec wants the site fast with thousands of articles. Each one below is
// for a real query - writes pay a small cost in return.
articleSchema.index({ isLive: 1, publishedAt: -1 })                 // feed, newest first
articleSchema.index({ isLive: 1, viewCount: -1 })                   // feed, most popular
articleSchema.index({ isLive: 1, 'publishedContent.category': 1 })  // category filter
// Whole-word search on the title. The public feed stopped using it: its search
// has to match part of a word, which $text cannot do. Kept because it costs
// only disk and a wildcard text index is the way back if the feed's regex ever
// gets too slow - though that one still only matches the start of a word.
articleSchema.index({ 'publishedContent.title': 'text' })
articleSchema.index({ author: 1, status: 1 })                       // reporter's own list

module.exports = mongoose.model('Article', articleSchema)
module.exports.STATUS = STATUS
module.exports.STATUS_LABELS = STATUS_LABELS
module.exports.CATEGORIES = CATEGORIES
module.exports.CATEGORY_LABELS = CATEGORY_LABELS
