const User = require('../models/User')
const { ROLES } = User
const { isApiRequest } = require('../utils/isApiRequest')

// Anyone without a session is a guest. Returning a real object instead of null
// means every request has a user, so permission checks look the same everywhere.
function getCurrentUser(req) {
  return (req.session && req.session.user) || { role: ROLES.GUEST, displayName: 'Guest' }
}

// what every rendered page gets for free: who is looking, and where they are
function attachViewData(req, res, next) {
  res.locals.user = getCurrentUser(req)
  res.locals.currentPath = req.path
  next()
}

// The session keeps a copy of the account from login. Staff routes reload it,
// so a deleted account stops working on its next request and an edited name
// shows up without logging out and in again.
async function refreshSessionUser(req) {
  const cached = req.session && req.session.user
  if (!cached) return

  const account = await User.findById(cached.id, 'username displayName role').lean()
  if (!account) {
    delete req.session.user
    return
  }

  // only written when something changed, so an unchanged session is not
  // saved back to Mongo on every request
  if (account.username !== cached.username || account.displayName !== cached.displayName || account.role !== cached.role) {
    req.session.user = { id: cached.id, username: account.username, displayName: account.displayName, role: account.role }
  }
}

// Called as requireRole('editor') - it returns the middleware, and the closure
// remembers which roles were allowed. All checks run here on the server,
// because hiding a button in the browser protects nothing.
function requireRole(...roles) {
  return async (req, res, next) => {
    await refreshSessionUser(req)
    const user = getCurrentUser(req)
    res.locals.user = user

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
