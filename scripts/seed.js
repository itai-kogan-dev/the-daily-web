require('dotenv').config()

const mongoose = require('mongoose')
const { connectDb } = require('../config/db')
const User = require('../models/User')
const Article = require('../models/Article')
const Comment = require('../models/Comment')
const ViewBucket = require('../models/ViewBucket')
const { STATUS, CATEGORIES } = require('../models/Article')
const { ROLES } = require('../models/User')

// Same for every seeded user, but it comes from .env so no credential of any
// kind lives in the repo.
const PASSWORD = process.env.SEED_PASSWORD
if (!PASSWORD) throw new Error('SEED_PASSWORD is missing - copy .env.example to .env')

const pick = list => list[Math.floor(Math.random() * list.length)]
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const hoursAgo = h => new Date(Date.now() - h * 3600 * 1000)

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

function makeContent(category) {
  const title = `${pick(HEADLINES[category])} ${pick(SUBJECTS)}`
  return {
    title,
    summary: `${title} - what it means and who it affects.`,
    body: Array.from({ length: randInt(3, 6) }, () =>
      `${pick(SUBJECTS)} has drawn attention this week. Officials said the decision follows months of review, ` +
      `and that further details will be published in the coming days. Critics argue the timing is questionable.`
    ).join('\n\n'),
    category,
    imageUrl: `https://picsum.photos/seed/${Math.random().toString(36).slice(2, 9)}/800/450`
  }
}

// Views decay after publishing and jump again after each update. That shape is
// the whole point of the analytics graph, so the demo data has to show it.
function makeBuckets(article, resolutionHours, maxHours) {
  const buckets = []
  const baseline = randInt(40, 260)
  const start = article.publishedAt
  const span = Math.min(maxHours, Math.floor((Date.now() - start.getTime()) / 3600000))

  for (let h = 0; h < span; h += resolutionHours) {
    const at = new Date(start.getTime() + h * 3600000)
    let count = Math.round(baseline * Math.exp(-h / 60) * (0.6 + Math.random() * 0.8))

    for (const ev of article.updateEvents) {
      const since = (at - ev.at) / 3600000
      if (since >= 0 && since < 40) count += Math.round(baseline * 0.8 * Math.exp(-since / 10))
    }

    if (count > 0) buckets.push({ article: article._id, bucketStart: ViewBucket.bucketFor(at), count })
  }
  return buckets
}

async function seed() {
  await connectDb()

  console.log('clearing old data')
  await Promise.all([
    User.deleteMany({}), Article.deleteMany({}),
    Comment.deleteMany({}), ViewBucket.deleteMany({})
  ])

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
  // which is the case the spec cares most about.
  const plan = [
    { n: 385, status: STATUS.PUBLISHED,      live: true,  updates: [1, 1] },
    { n:  15, status: STATUS.PUBLISHED,      live: true,  updates: [3, 5] },  // for the graph
    { n:  10, status: STATUS.PENDING_EDITOR, live: true,  updates: [1, 2] },  // live, update waiting
    { n:   5, status: STATUS.NEEDS_REVISION, live: true,  updates: [1, 2] },  // live, fix requested
    { n:  40, status: STATUS.PENDING_EDITOR, live: false, updates: [0, 0] },
    { n:  30, status: STATUS.IN_PROGRESS,    live: false, updates: [0, 0] },
    { n:  15, status: STATUS.NEEDS_REVISION, live: false, updates: [0, 0] }
  ]

  const docs = []
  const featured = []

  for (const group of plan) {
    for (let i = 0; i < group.n; i++) {
      const category = pick(CATEGORIES)
      const author = pick(reporters)
      const draft = makeContent(category)
      const publishedAt = group.live ? hoursAgo(randInt(24, 24 * 30)) : null

      const updateCount = randInt(group.updates[0], group.updates[1])
      const updateEvents = []
      for (let u = 0; u < updateCount; u++) {
        const age = (Date.now() - publishedAt.getTime()) / 3600000
        updateEvents.push({ at: new Date(publishedAt.getTime() + (age * (u + 1) / (updateCount + 1)) * 3600000), editor: editor._id })
      }

      const doc = {
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
        viewCount: 0
      }
      docs.push(doc)
      if (group.updates[1] >= 3) featured.push(docs.length - 1)
    }
  }

  const articles = await Article.insertMany(docs)
  console.log(`created ${articles.length} articles`)

  // --- comments ---
  const NAMES = ['Ron', 'Tal', 'Avi', 'Shira', 'Guy', 'Lior', 'Maya', 'Eitan', 'Noa', 'Yonatan']
  const TEXTS = [
    'Finally someone wrote about this.', 'Where are the numbers from?',
    'Good piece, but it misses the bigger issue.', 'This has been going on for years.',
    'Thanks for covering it.', 'Not sure I agree with the conclusion.'
  ]
  const comments = []
  for (const a of articles.filter(x => x.isLive).slice(0, 180)) {
    for (let i = 0; i < randInt(0, 7); i++) {
      comments.push({
        article: a._id,
        authorName: pick(NAMES),
        body: pick(TEXTS),
        createdAt: hoursAgo(randInt(1, 24 * 20))
      })
    }
  }
  await Comment.insertMany(comments)
  console.log(`created ${comments.length} comments`)

  // --- view buckets ---
  // Dense history for the articles the analytics graph will show, a light
  // sprinkle for the rest so the popularity sort has something to work with.
  const buckets = []
  articles.forEach((a, i) => {
    if (!a.isLive) return
    const dense = featured.includes(i)
    buckets.push(...makeBuckets(a, dense ? 1 : 12, dense ? 24 * 14 : 24 * 30))
  })
  await ViewBucket.insertMany(buckets)
  console.log(`created ${buckets.length} view buckets`)

  // keep viewCount in step with the buckets, it is what popularity sorts on
  const totals = await ViewBucket.aggregate([
    { $group: { _id: '$article', total: { $sum: '$count' } } }
  ])
  await Article.bulkWrite(totals.map(t => ({
    updateOne: { filter: { _id: t._id }, update: { $set: { viewCount: t.total } } }
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
