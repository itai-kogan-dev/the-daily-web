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
    res.set('Retry-After', String(wait))   // the standard header, for clients that read it
    return res.status(429).json({ error: `Too many comments. Try again in ${wait} seconds.` })
  }

  recent.push(now)
  req.session.commentTimes = recent
  next()
}

// Wrong-password guessing is capped per username and address: 20 failed tries
// in 10 minutes, then the form answers 429 for a while. Only failures count,
// so a correct password always works. In memory: a restart clears the counts,
// which fails open rather than locking everyone out.
const LOGIN_WINDOW_MS = 10 * 60 * 1000
const LOGIN_MAX = 20
const loginAttempts = new Map()

function loginKey(req, username) {
  return `${req.ip}|${username}`
}

function loginBlocked(req, username) {
  const now = Date.now()
  const key = loginKey(req, username)
  const seen = (loginAttempts.get(key) || []).filter(at => now - at < LOGIN_WINDOW_MS)
  if (seen.length !== (loginAttempts.get(key) || []).length) {
    if (seen.length) loginAttempts.set(key, seen)
    else loginAttempts.delete(key)
  }
  return seen.length >= LOGIN_MAX
}

function noteFailedLogin(req, username) {
  const key = loginKey(req, username)
  const now = Date.now()
  const seen = (loginAttempts.get(key) || []).filter(at => now - at < LOGIN_WINDOW_MS)
  seen.push(now)
  loginAttempts.set(key, seen)
}

function clearLogins(req, username) {
  loginAttempts.delete(loginKey(req, username))
}

module.exports = { commentRateLimit, loginBlocked, noteFailedLogin, clearLogins }
