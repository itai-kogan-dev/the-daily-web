const WINDOW_MS = 60 * 1000
const MAX_COMMENTS = 3

// The spec allows 3 comments a minute from the same device. We count in the
// session rather than by IP: an IP is a whole network, so a dorm or an office
// would share the three between them, while a session cookie is per browser.
//
// A guest has no session until this writes to one, so reading the site still
// creates nothing. The count sits in MongoDB with the other sessions, so it
// also survives a restart.
function commentRateLimit(req, res, next) {
  const now = Date.now()

  // a sliding window, not a counter per clock minute - that would allow three
  // at 10:00:59 and three more at 10:01:00
  const recent = (req.session.commentTimes || []).filter(at => now - at < WINDOW_MS)

  if (recent.length >= MAX_COMMENTS) {
    const wait = Math.ceil((WINDOW_MS - (now - recent[0])) / 1000)
    return res.status(429).json({ error: `Too many comments. Try again in ${wait} seconds.` })
  }

  recent.push(now)
  req.session.commentTimes = recent
  next()
}

module.exports = { commentRateLimit, WINDOW_MS, MAX_COMMENTS }
