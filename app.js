require('dotenv').config()

const express = require('express')
const session = require('express-session')
const { MongoStore } = require('connect-mongo')   // v6 renamed this from a default export
const path = require('path')

const { connectDb } = require('./config/db')
const { attachViewData } = require('./middleware/auth')
const { handleNotFound, errorHandler } = require('./middleware/errorHandler')

const app = express()

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))

// Order matters - Express runs middleware top to bottom.
app.use(express.static(path.join(__dirname, 'public')))
app.use(express.urlencoded({ extended: true }))   // reads HTML form posts into req.body
app.use(express.json())                           // reads Ajax JSON posts into req.body

// Sessions live in Mongo, not in memory, so a server restart doesn't log
// everyone out. saveUninitialized false means guests never create a row.
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }   // a week
}))

app.use(attachViewData)

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
  const port = process.env.PORT || 3000
  app.listen(port, () => console.log(`[web] http://localhost:${port}`))
}

startServer()
