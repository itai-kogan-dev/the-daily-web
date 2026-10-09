const mongoose = require('mongoose')
const User = require('../models/User')
const { STORED_ROLES, ROLE_LABELS, ROLES } = User

function makeError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

// bad id and missing user end up the same - 404 via the error handler
async function findUser(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw makeError(404, 'User not found')

  const user = await User.findById(id)
  if (!user) throw makeError(404, 'User not found')

  return user
}

// everyone who can log in. guests have no account so there is nothing
// of theirs to list - anyone without a session counts as one.
async function showUsers(req, res) {
  const users = await User.find({}).sort({ role: 1, username: 1 }).lean()

  res.render('editor/users', { users, ROLE_LABELS })
}

// empty form. nothing is written until the create call below runs.
function showNewUser(req, res) {
  res.render('editor/user-edit', {
    account: null,
    STORED_ROLES, ROLE_LABELS
  })
}

async function showEditUser(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw makeError(404, 'User not found')

  const account = await User.findById(req.params.id).select('-passwordHash').lean()
  if (!account) throw makeError(404, 'User not found')

  // called account, not user - user is already the logged in viewer that
  // every page gets for its header
  res.render('editor/user-edit', {
    account,
    STORED_ROLES, ROLE_LABELS
  })
}

// picks the account fields out of a request body. the schema lowercases and
// trims the username on save, but lookups and duplicate checks run before
// that, so the same normalising happens here first.
function readUsername(body) {
  return String(body.username ?? '').trim().toLowerCase()
}

async function createUser(req, res) {
  const username = readUsername(req.body || {})
  const displayName = String(req.body.displayName ?? '').trim()
  const password = req.body.password || ''
  const role = req.body.role

  if (!username) throw makeError(400, 'Username is required')
  if (!displayName) throw makeError(400, 'Display name is required')
  if (!password) throw makeError(400, 'Password is required')
  if (!STORED_ROLES.includes(role)) throw makeError(400, 'Role must be reporter or editor')

  const taken = await User.findOne({ username }).lean()
  if (taken) throw makeError(409, 'That username is taken')

  const user = await User.create({
    username,
    displayName,
    role,
    passwordHash: await User.hashPassword(password)
  })

  res.status(201).json(user)
}

async function updateUser(req, res) {
  const user = await findUser(req.params.id)
  const body = req.body || {}

  if (body.username !== undefined) {
    const username = String(body.username).trim().toLowerCase()
    if (!username) throw makeError(400, 'Username is required')

    const taken = await User.findOne({ username }).lean()
    if (taken && String(taken._id) !== String(user._id)) {
      throw makeError(409, 'That username is taken')
    }
    user.username = username
  }

  if (body.displayName !== undefined) {
    const displayName = String(body.displayName).trim()
    if (!displayName) throw makeError(400, 'Display name is required')
    user.displayName = displayName
  }

  // role is deliberately not editable - an editor can pick the role when
  // creating an account, but cannot change it afterwards

  // a blank password means the edit form left it alone - only a real value
  // replaces the hash, so saving anything else never locks the account
  if (typeof body.password === 'string' && body.password) {
    user.passwordHash = await User.hashPassword(body.password)
  }

  await user.save()

  res.json(user)
}

// deleting the last editor would leave nobody able to log in and create
// accounts, so that one delete is refused instead
async function deleteUser(req, res) {
  const user = await findUser(req.params.id)

  if (user.role === ROLES.EDITOR) {
    const editors = await User.countDocuments({ role: ROLES.EDITOR })
    if (editors <= 1) throw makeError(400, 'Cannot delete the last editor')
  }

  await user.deleteOne()

  res.json({ deleted: true })
}

module.exports = {
  showUsers,
  showNewUser,
  showEditUser,
  createUser,
  updateUser,
  deleteUser
}
