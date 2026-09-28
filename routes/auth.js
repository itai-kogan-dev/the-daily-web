const express = require('express')
const User = require('../models/User')
const { ROLES } = require('../models/User')

const router = express.Router()

router.get('/login', (req, res) => {
  res.render('login', { error: null })
})

router.post('/login', async (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase()
  const password = req.body.password || ''

  const user = await User.findOne({ username })

  // Same message whether the user doesn't exist or the password is wrong,
  // otherwise someone could use the login form to find valid usernames.
  if (!user || !(await user.verifyPassword(password))) {
    return res.status(401).render('login', { error: 'Wrong username or password' })
  }

  // Only what we actually need later. The hash never goes in the session.
  req.session.user = {
    id: user._id.toString(),
    username: user.username,
    displayName: user.displayName,
    role: user.role
  }

  res.redirect(user.role === ROLES.EDITOR ? '/editor' : '/reporter')
})

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'))
})

module.exports = router
