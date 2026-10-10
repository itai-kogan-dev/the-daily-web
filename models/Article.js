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
  [STATUS.IN_PROGRESS]:    'In progress',
  [STATUS.PENDING_EDITOR]: 'Pending approval',
  [STATUS.NEEDS_REVISION]: 'Needs revision',
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

  editorNote:  { type: String, default: '', maxlength: 1000 },   // why the editor sent it back
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
articleSchema.index({ author: 1, status: 1 })                       // reporter's own list

// How many articles are in each status, plus all of them, for the filter
// pills. match narrows it, e.g. to one reporter. aggregate() does not cast
// like find() does, so an author id in match has to be an ObjectId.
articleSchema.statics.countByStatus = async function (match = {}) {
  const counts = { all: 0 }
  for (const status of Object.values(STATUS)) counts[status] = 0

  const grouped = await this.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }])
  for (const row of grouped) {
    counts[row._id] = row.count
    counts.all += row.count
  }
  return counts
}

module.exports = mongoose.model('Article', articleSchema)
module.exports.STATUS = STATUS
module.exports.STATUS_LABELS = STATUS_LABELS
module.exports.CATEGORIES = CATEGORIES
module.exports.CATEGORY_LABELS = CATEGORY_LABELS
