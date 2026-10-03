const crypto = require('crypto')

// Static files are most of the requests and almost never the interesting
// ones, so they are only logged when they fail.
const QUIET = /^\/(css|js|images|favicon)/

// One line per request, written when the response is finished so it carries
// the status and the time it took:
//
//   [http] a1b2c3 GET /article/66f… 200 34ms editor
//
// Every request gets a short id, sent back in X-Request-Id. The error handler
// prints the same id, so a crash in the log can be matched to the request
// that caused it even when many requests are interleaved.
function requestLogger(req, res, next) {
  const started = process.hrtime.bigint()
  req.id = crypto.randomBytes(3).toString('hex')
  res.set('X-Request-Id', req.id)

  res.on('finish', () => {
    if (QUIET.test(req.path) && res.statusCode < 400) return

    const ms = Number(process.hrtime.bigint() - started) / 1e6
    const who = (req.session && req.session.user && req.session.user.username) || 'guest'
    const line = `[http] ${req.id} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms ${who}`

    if (res.statusCode >= 500) console.error(line)
    else console.log(line)
  })

  next()
}

module.exports = { requestLogger }
