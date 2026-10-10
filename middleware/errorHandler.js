// nothing matched any route
function handleNotFound(req, res) {
  if (req.path.includes('/api/')) return res.status(404).json({ error: 'Not found' })
  res.status(404).render('error', { status: 404, message: 'Page not found' })
}

// Mongo and Mongoose errors carry no status of their own, so all of them would
// look like a crash. Map the ones we can actually explain.
function resolveStatus(err) {
  if (err.status) return err.status
  if (err.name === 'ValidationError') return 400
  if (err.name === 'CastError' || err.name === 'BSONError') return 400
  if (err.code === 11000) return 409      // unique index, e.g. a username already taken
  return 500
}

// err.status is the tell: we set it ourselves, so that message was written for
// whoever is reading it. Without one the error came from Mongo, whose wording
// names databases, collections, indexes and schema paths.
function resolveMessage(err, status) {
  // express.json sets a status too, but its message is the parser's own
  if (err.type === 'entity.parse.failed') return 'The request body is not valid JSON'
  if (err.status) return err.message
  if (status === 400) return 'Some of the details are missing or invalid'
  if (status === 409) return 'That already exists'
  return 'Something went wrong'
}

// Express only treats a function as an error handler if it takes 4 arguments.
function errorHandler(err, req, res, next) {
  // the response is already half sent (an image stream broke mid-way, say),
  // so there is no status left to set and Express's own handler has to close
  // the connection. Log it first - its log line has no request id, and the
  // [http] line will only say "aborted"
  if (res.headersSent) {
    console.error('[error]', req.id || '-', 'after headers', req.method, req.originalUrl, '-', err.message)
    return next(err)
  }

  const status = resolveStatus(err)
  const message = resolveMessage(err, status)

  // the real message stays in the log, where we need it. The request id
  // matches the [http] line for the same request. A 4xx is the caller's
  // mistake and one line is enough; a 500 is ours, so it gets the stack
  console.error('[error]', req.id || '-', status, req.method, req.originalUrl, '-', err.message)
  if (status >= 500) console.error(err.stack)

  if (req.path.includes('/api/')) return res.status(status).json({ error: message })
  res.status(status).render('error', { status, message })
}

module.exports = { handleNotFound, errorHandler }
