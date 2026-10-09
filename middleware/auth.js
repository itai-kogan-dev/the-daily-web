const { ROLES } = require('../models/User')

// Anyone without a session is a guest. Returning a real object instead of null
// means every request has a user, so permission checks look the same everywhere.
function currentUser(req) {
  return (req.session && req.session.user) || { role: ROLES.GUEST, displayName: 'Guest' }
}

// API routes get JSON errors, page routes get a redirect. originalUrl and
// not path, because path is relative to where the router is mounted.
function isApiRequest(req) {
  return req.originalUrl.includes('/api/')
}

// what every rendered page gets for free: who is looking, and where they are
function attachViewData(req, res, next) {
  res.locals.user = currentUser(req)
  res.locals.currentPath = req.path
  next()
}

// Called as requireRole('editor') - it returns the middleware, and the closure
// remembers which roles were allowed. All checks run here on the server,
// because hiding a button in the browser protects nothing.
function requireRole(...roles) {
  return (req, res, next) => {
    const user = currentUser(req)

    if (user.role === ROLES.GUEST) {
      if (isApiRequest(req)) return res.status(401).json({ error: 'Login required' })
      return res.redirect('/login')
    }

    if (!roles.includes(user.role)) {
      if (isApiRequest(req)) return res.status(403).json({ error: 'Forbidden' })
      return res.status(403).render('error', { status: 403, message: 'You do not have access to this area' })
    }

    next()
  }
}

module.exports = { attachViewData, requireRole }
