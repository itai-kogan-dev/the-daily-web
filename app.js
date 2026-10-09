require('dotenv').config()
// before anything else can log, so the file has every line from the start
require('./config/logFile').startLogFile()

const express = require('express')
const session = require('express-session')
const { MongoStore } = require('connect-mongo')   // v6 renamed this from a default export
const path = require('path')

const { connectDb } = require('./config/db')
const { requestLogger } = require('./middleware/requestLogger')
const { attachViewData } = require('./middleware/auth')
const { handleNotFound, errorHandler } = require('./middleware/errorHandler')
const { startViewRollup } = require('./services/viewRollup')

const app = express()

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))

// Order matters - Express runs middleware top to bottom.
app.use(requestLogger)   // first, so it times and logs every request
app.use(express.static(path.join(__dirname, 'public')))
app.use(express.urlencoded({ extended: true }))   // reads HTML form posts into req.body
// 5mb, not the 100kb default: a long article body is legitimate content and
// must save, not die with a 413. Pictures travel as raw uploads with their
// own limit, so this only covers text.
app.use(express.json({ limit: '5mb' }))             // reads Ajax JSON posts into req.body

// Sessions live in Mongo, not in memory, so a server restart doesn't log
// everyone out. saveUninitialized false means guests never create a row.
// httpOnly keeps scripts from reading the cookie; SameSite=lax means the
// browser only sends it from our own site, which is what stops another site
// from driving the editor's session. (There is no per-form CSRF token;
// lax-by-cookie is the protection, and state-changing fetches use
// same-origin cookies only.)
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,   // a week
    httpOnly: true,
    sameSite: 'lax'
  }
}))

app.use(attachViewData)

app.use('/images', require('./routes/images'))
app.use('/api/weather', require('./routes/weather'))
app.use('/', require('./routes/public'))
app.use('/', require('./routes/auth'))
app.use('/reporter', require('./routes/reporter'))
app.use('/editor', require('./routes/editor'))
app.use('/api/analytics', require('./routes/analytics'))

// these two stay last, after every route had its chance
app.use(handleNotFound)
app.use(errorHandler)

async function startServer() {
  await connectDb()
  startViewRollup()
  const port = process.env.PORT || 3000
  app.listen(port, () => console.log(`[web] http://localhost:${port}`))
}

// Express catches errors inside requests. These catch the rest - a timer, a
// promise nobody awaited. An uncaught exception leaves the process in an
// unknown state, so we log it and exit for the process manager to restart;
// a stray rejection is logged and the server keeps going. Only the ones
// that exit say [fatal].
process.on('unhandledRejection', err => {
  console.error('[error] unhandled rejection, continuing -', err && err.stack ? err.stack : err)
})
process.on('uncaughtException', err => {
  console.error('[fatal] uncaught exception -', err.stack)
  process.exit(1)
})

startServer().catch(err => {
  console.error('[fatal] could not start -', err.message)
  process.exit(1)
})
