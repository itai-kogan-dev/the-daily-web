const User = require('../models/User')
const { readString } = require('../utils/readString')
const { ROLES } = User

function showLogin(req, res) {
  res.render('login', { error: null })
}

async function logIn(req, res) {
  const body = req.body || {}
  const username = readString(body.username).trim().toLowerCase()
  const password = readString(body.password)

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
}

function logOut(req, res) {
  req.session.destroy(() => res.redirect('/'))
}

module.exports = { showLogin, logIn, logOut }
