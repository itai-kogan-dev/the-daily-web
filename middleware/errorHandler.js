// nothing matched any route
function notFound(req, res) {
  if (req.originalUrl.includes('/api/')) return res.status(404).json({ error: 'Not found' })
  res.status(404).render('error', { status: 404, message: 'Page not found' })
}

// Express only treats a function as an error handler if it takes 4 arguments,
// so next has to stay even though we never call it.
function errorHandler(err, req, res, next) {
  const status = err.status || 500
  console.error('[error]', status, req.method, req.originalUrl, '-', err.message)

  if (req.originalUrl.includes('/api/')) return res.status(status).json({ error: err.message })

  // a real crash shouldn't leak internal messages to the page
  const message = status === 500 ? 'Something went wrong' : err.message
  res.status(status).render('error', { status, message })
}

module.exports = { notFound, errorHandler }
