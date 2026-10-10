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

  // The session is saved to Mongo asynchronously. If we redirect before that
  // write lands, the browser follows the redirect and the next request finds
  // no session yet, treats the user as a guest and bounces them back to
  // /login. Wait for the save so the redirect target sees the session.
  await new Promise((resolve, reject) => {
    req.session.save(err => (err ? reject(err) : resolve()))
  })

  res.redirect(user.role === ROLES.EDITOR ? '/editor' : '/reporter')
}

async function logOut(req, res) {
  // destroy is already async and clears the cookie, but wait for it to finish
  // so a failed destroy surfaces as an error instead of a half-done redirect
  await new Promise((resolve, reject) => {
    req.session.destroy(err => (err ? reject(err) : resolve()))
  })

  res.redirect('/')
}

module.exports = { showLogin, logIn, logOut }
