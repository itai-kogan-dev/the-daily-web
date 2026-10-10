const WINDOW_MS = 60 * 1000
const MAX_COMMENTS = 3

// At most 3 comments a minute per device. Counted in the session, not by IP -
// one IP can be a whole dorm (see docs/DECISIONS.md). Sessions live in
// MongoDB, so the count survives a restart.
function limitComments(req, res, next) {
  const now = Date.now()

  // a sliding window, not a counter per clock minute - that would allow three
  // at 10:00:59 and three more at 10:01:00
  const recent = (req.session.commentTimes || []).filter(at => now - at < WINDOW_MS)

  if (recent.length >= MAX_COMMENTS) {
    const wait = Math.ceil((WINDOW_MS - (now - recent[0])) / 1000)
    res.set('Retry-After', String(wait))   // the standard header, for clients that read it
    return res.status(429).json({ error: `Too many comments. Try again in ${wait} seconds.` })
  }

  recent.push(now)
  req.session.commentTimes = recent
  next()
}

module.exports = { limitComments }
