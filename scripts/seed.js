require('dotenv').config()

const mongoose = require('mongoose')
const { connectDb } = require('../config/db')
const User = require('../models/User')
const Article = require('../models/Article')
const Comment = require('../models/Comment')
const ViewBucket = require('../models/ViewBucket')
const imageStore = require('../services/imageStore')
const fs = require('fs')
const path = require('path')
const { STATUS, CATEGORIES } = require('../models/Article')
const { ROLES } = require('../models/User')

// Same for every seeded user, but it comes from .env so no credential of any
// kind lives in the repo.
const PASSWORD = process.env.SEED_PASSWORD
if (!PASSWORD) throw new Error('SEED_PASSWORD is missing - copy .env.example to .env')

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const pick = list => list[Math.floor(Math.random() * list.length)]
const pickRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const subtractHours = hours => new Date(Date.now() - hours * HOUR)
const pickDateBetween = (from, to) => new Date(from.getTime() + Math.random() * (to - from))
// 2.4 views becomes 2 or 3, so quiet hours still add up to the right total
const roundRandomly = value => Math.floor(value + Math.random())

const HEADLINES = {
  news:       ['Council approves', 'City reports', 'Officials confirm', 'Residents protest', 'Government announces'],
  economy:    ['Markets react to', 'Inflation slows in', 'Bank raises', 'Exports climb after', 'Budget cuts hit'],
  sports:     ['Late goal seals', 'Coach steps down after', 'Record broken in', 'Injury rules out', 'Underdogs stun'],
  culture:    ['Museum opens', 'Festival returns with', 'Novel wins', 'Director defends', 'Exhibition explores'],
  technology: ['Startup launches', 'Researchers build', 'Outage hits', 'Chipmaker unveils', 'Regulators probe'],
  health:     ['Study links', 'Hospital expands', 'Clinic trials', 'Doctors warn about', 'Vaccine cuts']
}

const SUBJECTS = ['the new transport plan', 'downtown housing', 'the summer budget', 'the coastal project',
                  'local schools', 'the water supply', 'the northern line', 'the old port', 'winter energy use',
                  'the city marathon', 'the data centre', 'the youth programme']

// Filled in once the pictures are in the database, then shared by every
// article - ten files, not five hundred copies.
let imagePaths = []

// Pictures are uploaded once and the articles point at them, the same way a
// reporter's upload works. Swap the files in scripts/seed-images to change
// what the demo looks like.
async function uploadSeedImages() {
  const dir = path.join(__dirname, 'seed-images')
  const files = fs.readdirSync(dir).filter(name => /\.(png|jpe?g|gif|webp|avif)$/i.test(name))
  if (!files.length) throw new Error('no pictures in scripts/seed-images')

  const types = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', avif: 'image/avif'
  }

  return Promise.all(files.map(name => imageStore.saveImage(
    fs.readFileSync(path.join(dir, name)),
    { filename: name, contentType: types[name.split('.').pop().toLowerCase()] }
  )))
}

function makeContent(category) {
  const title = `${pick(HEADLINES[category])} ${pick(SUBJECTS)}`
  return {
    title,
    summary: `${title} - what it means and who it affects.`,
    body: Array.from({ length: pickRandomInt(3, 6) }, () =>
      `${pick(SUBJECTS)} has drawn attention this week. Officials said the decision follows months of review, ` +
      `and that further details will be published in the coming days. Critics argue the timing is questionable.`
    ).join('\n\n'),
    category,
    imagePath: pick(imagePaths)
  }
}

// Everything is relative to the moment the seed runs, so the demo looks
// current on the day it is seeded: a slice of today, most of the last week,
// and a tail back to a month.
function pickPublishHours() {
  const roll = Math.random()
  if (roll < 0.15) return pickRandomInt(1, 23)
  if (roll < 0.55) return pickRandomInt(24, 24 * 7)
  return pickRandomInt(24 * 7, 24 * 30)
}

// The articles the analytics page is demoed on: a few days old, a week or
// two, and most of a month, so every range on the graph has one that fills it.
function pickFeaturedHours(index) {
  return [pickRandomInt(36, 96), pickRandomInt(24 * 5, 24 * 12), pickRandomInt(24 * 14, 24 * 28)][index % 3]
}

// The first event is the publication itself, as publish() records it, then
// one per approved update. recentLast puts the last update inside the past
// day, so the 24h graph has a marker with traffic on both sides of it.
function makeUpdateEvents(publishedAt, updates, editorId, { recentLast = false } = {}) {
  const events = [{ at: publishedAt, editor: editorId }]
  const first = publishedAt.getTime() + 6 * HOUR
  const last = Date.now() - (recentLast ? pickRandomInt(3, 20) : pickRandomInt(2, 48)) * HOUR
  if (!updates || last <= first) return events

  const gap = (last - first) / updates
  for (let u = 1; u <= updates; u++) {
    const jitter = u < updates ? (Math.random() - 0.5) * gap * 0.3 : 0
    events.push({ at: new Date(first + gap * u + jitter), editor: editorId })
  }
  return events
}

// Israel time, so the daily rhythm peaks in the local afternoon
const LOCAL_UTC_OFFSET = 3

// Views per hour at one moment: a launch spike that fades over a couple of
// days, a long tail, a day/night rhythm, and a new spike after every update.
// That shape is the whole point of the analytics graph.
function estimateHourlyViews(article, baseline, at) {
  const age = (at - article.publishedAt) / HOUR
  if (age < 0) return 0

  let rate = baseline * (Math.exp(-age / 36) + 0.03)
  for (const event of article.updateEvents.slice(1)) {
    const since = (at - event.at) / HOUR
    if (since >= 0) rate += baseline * 0.8 * Math.exp(-since / 10)
  }

  const localHour = (at.getUTCHours() + at.getUTCMinutes() / 60 + LOCAL_UTC_OFFSET) % 24
  const rhythm = 0.6 + 0.4 * Math.sin((localHour - 9) / 24 * 2 * Math.PI)
  return rate * rhythm * (0.7 + Math.random() * 0.6)
}

// Real views land in 5 minute buckets. Recent history keeps that resolution
// because the 24h graph draws it; older history is stored coarser, at the
// resolution the longer ranges draw anyway. It matches services/analytics.js
// pickInterval, so no range ever shows coarse buckets as spikes.
function pickBucketStep(bucketAge, articleAge) {
  if (bucketAge <= DAY || articleAge <= 2 * DAY) return 5 * MINUTE
  if (bucketAge <= 21 * DAY) return HOUR
  return DAY
}

function makeBuckets(article, baseline) {
  const buckets = []
  const now = Date.now()
  const articleAge = now - article.publishedAt.getTime()

  let at = ViewBucket.getBucketStart(article.publishedAt).getTime()
  while (at < now) {
    const step = pickBucketStep(now - at, articleAge)
    const span = Math.min(step, now - at)
    const count = roundRandomly(estimateHourlyViews(article, baseline, new Date(at + span / 2)) * span / HOUR)
    if (count > 0) buckets.push({ article: article._id, bucketStart: new Date(at), count })
    at += step
  }
  return buckets
}

async function seed() {
  await connectDb()

  console.log('clearing old data')
  await Promise.all([
    User.deleteMany({}), Article.deleteMany({}),
    Comment.deleteMany({}), ViewBucket.deleteMany({}),
    imageStore.clearImages()
  ])

  imagePaths = await uploadSeedImages()
  console.log(`uploaded ${imagePaths.length} pictures`)

  // --- users ---
  // The first editor has to come from here, otherwise nobody could log in to
  // create anyone. After this, editors create accounts through the app.
  const hash = await User.hashPassword(PASSWORD)
  const users = await User.insertMany([
    { username: 'editor', displayName: 'Maya Gold',  role: ROLES.EDITOR,   passwordHash: hash },
    { username: 'itai',   displayName: 'Itai',  role: ROLES.REPORTER, passwordHash: hash },
    { username: 'nadav',  displayName: 'Nadav', role: ROLES.REPORTER, passwordHash: hash },
    { username: 'idan',   displayName: 'Idan',  role: ROLES.REPORTER, passwordHash: hash },
    { username: 'yuval',  displayName: 'Yuval', role: ROLES.REPORTER, passwordHash: hash }
  ])
  const editor = users[0]
  const reporters = users.slice(1)

  // --- articles ---
  // 500 spread over every status, plus some live ones with an update waiting,
  // which is the case the spec cares most about. updates counts the approved
  // updates after the first publication.
  const plan = [
    { n: 380, status: STATUS.PUBLISHED,      live: true,  updates: [0, 1] },
    { n:  15, status: STATUS.PUBLISHED,      live: true,  updates: [3, 5], featured: true },  // for the graph
    { n:  10, status: STATUS.PENDING_EDITOR, live: true,  updates: [0, 2] },  // live, update waiting
    { n:   5, status: STATUS.NEEDS_REVISION, live: true,  updates: [0, 2] },  // live, fix requested
    { n:   5, status: STATUS.IN_PROGRESS,    live: true,  updates: [0, 2] },  // live, reporter reworking it
    { n:  40, status: STATUS.PENDING_EDITOR, live: false, updates: [0, 0] },
    { n:  30, status: STATUS.IN_PROGRESS,    live: false, updates: [0, 0] },
    { n:  15, status: STATUS.NEEDS_REVISION, live: false, updates: [0, 0] }
  ]

  const docs = []
  const baselines = []   // launch views per hour, one per article
  let featuredCount = 0

  for (const group of plan) {
    for (let i = 0; i < group.n; i++) {
      const category = pick(CATEGORIES)
      const author = pick(reporters)
      const draft = makeContent(category)
      const featuredIndex = group.featured ? featuredCount++ : null

      let publishedAt = null
      let updateEvents = []
      let createdAt, updatedAt

      if (group.live) {
        publishedAt = subtractHours(group.featured ? pickFeaturedHours(featuredIndex) : pickPublishHours())
        updateEvents = makeUpdateEvents(publishedAt, pickRandomInt(...group.updates), editor._id, {
          recentLast: group.featured
        })
        createdAt = new Date(publishedAt.getTime() - pickRandomInt(1, 12) * HOUR)
        const lastApproved = updateEvents[updateEvents.length - 1].at
        // a live article with an edit in progress was touched after its last approval
        updatedAt = group.status === STATUS.PUBLISHED ? lastApproved : pickDateBetween(lastApproved, new Date())
      } else {
        createdAt = subtractHours(pickRandomInt(2, 24 * 10))
        updatedAt = pickDateBetween(createdAt, new Date())
      }

      docs.push({
        author: author._id,
        status: group.status,
        isLive: group.live,
        // a live article with a pending update has different draft and published content
        publishedContent: group.live ? draft : null,
        draftContent: group.status === STATUS.PUBLISHED ? draft : makeContent(category),
        editorNote: group.status === STATUS.NEEDS_REVISION ? pick([
          'Please add a second source.', 'The opening is too long, tighten it.', 'Check the figures in paragraph 3.'
        ]) : '',
        publishedAt,
        updateEvents,
        viewCount: 0,
        createdAt,
        updatedAt
      })
      baselines.push(group.featured ? pickRandomInt(150, 400) : pickRandomInt(20, 200))
    }
  }

  // timestamps off, or Mongoose would stamp all 500 with this very second
  const articles = await Article.insertMany(docs, { timestamps: false })
  console.log(`created ${articles.length} articles`)

  // --- comments ---
  const NAMES = ['Ron', 'Tal', 'Avi', 'Shira', 'Guy', 'Lior', 'Maya', 'Eitan', 'Noa', 'Yonatan']
  const TEXTS = [
    'Finally someone wrote about this.', 'Where are the numbers from?',
    'Good piece, but it misses the bigger issue.', 'This has been going on for years.',
    'Thanks for covering it.', 'Not sure I agree with the conclusion.'
  ]
  const comments = []
  for (const article of articles.filter(one => one.isLive).slice(0, 180)) {
    for (let i = 0; i < pickRandomInt(0, 7); i++) {
      // never before the article went live
      const at = pickDateBetween(article.publishedAt, new Date())
      comments.push({
        article: article._id,
        authorName: pick(NAMES),
        body: pick(TEXTS),
        createdAt: at,
        updatedAt: at
      })
    }
  }
  await Comment.insertMany(comments, { timestamps: false })
  console.log(`created ${comments.length} comments`)

  // --- view buckets ---
  const buckets = []
  articles.forEach((article, index) => {
    if (article.isLive) buckets.push(...makeBuckets(article, baselines[index]))
  })
  await ViewBucket.insertMany(buckets)
  console.log(`created ${buckets.length} view buckets`)

  // keep viewCount in step with the buckets, it is what popularity sorts on
  const totals = await ViewBucket.aggregate([
    { $group: { _id: '$article', total: { $sum: '$count' } } }
  ])
  await Article.bulkWrite(totals.map(row => ({
    // a view count is not an edit, so updatedAt keeps the seeded date
    updateOne: { filter: { _id: row._id }, update: { $set: { viewCount: row.total } }, timestamps: false }
  })))

  console.log('')
  console.log('log in with any of these, using SEED_PASSWORD from your .env')
  console.log('  editor  (editor)')
  console.log('  itai, nadav, idan, yuval  (reporters)')

  await mongoose.disconnect()
}

seed().catch(err => {
  console.error(err)
  process.exit(1)
})
