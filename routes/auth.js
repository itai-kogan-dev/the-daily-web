const express = require('express')
const User = require('../models/User')
const { ROLES } = require('../models/User')
const { loginBlocked, noteFailedLogin, clearLogins } = require('../middleware/rateLimit')

const router = express.Router()

router.get('/login', (req, res) => {
  res.render('login', { error: null })
})

router.post('/login', async (req, res, next) => {
  const username = String(req.body.username || '').trim().toLowerCase()
  const password = typeof req.body.password === 'string' ? req.body.password : ''

  if (loginBlocked(req, username)) {
    res.set('Retry-After', '60')
    return res.status(429).render('login', { error: 'Too many tries. Wait a minute and try again.' })
  }

  const user = username ? await User.findOne({ username }) : null

  // Same message whether the user doesn't exist or the password is wrong,
  // otherwise someone could use the login form to find valid usernames.
  if (!user || !password || !(await user.verifyPassword(password))) {
    noteFailedLogin(req, username)
    return res.status(401).render('login', { error: 'Wrong username or password' })
  }

  clearLogins(req, username)

  // A fresh session id on login, so a session id seen before the login cannot
  // be reused after it. The login itself is what regenerate protects.
  req.session.regenerate(err => {
    if (err) return next(err)

    // Only what we actually need later. The hash never goes in the session.
    req.session.user = {
      id: user._id.toString(),
      username: user.username,
      displayName: user.displayName,
      role: user.role
    }

    res.redirect(user.role === ROLES.EDITOR ? '/editor' : '/reporter')
  })
})

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'))
})

module.exports = router
