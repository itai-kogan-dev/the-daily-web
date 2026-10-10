const crypto = require('crypto')

// Assets, pictures included, are only logged when they fail or are slow -
// a feed page alone asks for ~20 pictures and they would bury everything else.
const QUIET = /^\/(css|js|images|favicon)/
const SLOW_MS = 1000

// One line per request once it is over: id, method, url, status, time, user.
// The id is also sent in X-Request-Id and printed by the error handler, so an
// error in the log can be matched to its request. A request the client gave
// up on shows "aborted" in place of a status.
function logRequest(req, res, next) {
  const started = process.hrtime.bigint()
  req.id = crypto.randomBytes(3).toString('hex')
  res.set('X-Request-Id', req.id)

  // 'close' and not 'finish': finish never fires when the client disconnects
  // first, close fires either way. writableFinished tells the two apart
  res.on('close', () => {
    const finished = res.writableFinished
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    if (finished && QUIET.test(req.path) && res.statusCode < 400 && ms < SLOW_MS) return

    const status = finished ? res.statusCode : 'aborted'
    const who = (req.session && req.session.user && req.session.user.username) || 'guest'
    const line = `[http] ${req.id} ${req.method} ${req.originalUrl} ${status} ${ms.toFixed(0)}ms ${who}`

    if (finished && res.statusCode >= 500) console.error(line)
    else console.log(line)
  })

  next()
}

module.exports = { logRequest }
