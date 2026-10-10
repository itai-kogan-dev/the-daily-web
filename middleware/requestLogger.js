const crypto = require('crypto')

// Assets are most of the requests and almost never the interesting ones, so
// they are only logged when they fail or are slow. /images is on the list on
// purpose even though it is not a file on disk - it is a Mongo read per
// picture, but a feed page asks for ~20 of them and they would bury the page
// requests. A slow one is still logged, which is when a Mongo read matters.
const QUIET = /^\/(css|js|images|favicon)/
const SLOW_MS = 1000

// One line per request, written when the response is over so it carries the
// status and the time it took:
//
//   [http] a1b2c3 GET /article/66f… 200 34ms editor
//
// A request the client gave up on (closed the tab, lost the connection) shows
// "aborted" in place of a status - otherwise it would not be logged at all.
//
// Every request gets a short id, sent back in X-Request-Id. The error handler
// prints the same id, so a crash in the log can be matched to the request
// that caused it even when many requests are interleaved.
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
