const mongoose = require('mongoose')
const bcrypt = require('bcrypt')

// Three user types, but guest is never saved - no username, no password,
// nothing to store. Anyone without a session counts as a guest.
const ROLES = {
  GUEST:    'guest',
  REPORTER: 'reporter',
  EDITOR:   'editor'
}

// only these two can exist in the users collection
const STORED_ROLES = [ROLES.REPORTER, ROLES.EDITOR]

const ROLE_LABELS = {
  [ROLES.GUEST]:    'Guest',
  [ROLES.REPORTER]: 'Reporter',
  [ROLES.EDITOR]:   'Editor'
}

const userSchema = new mongoose.Schema({
  // lowercase + trim, otherwise "Admin", "ADMIN " and "admin" become 3 accounts
  username:     { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true },
  displayName:  { type: String, required: true, trim: true },   // shown as the byline
  role:         { type: String, required: true, enum: STORED_ROLES }
}, { timestamps: true })

// bcrypt.compare, never ===. bcrypt adds random salt to every hash so the
// same password comes out different each time.
userSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash)
}

// 10 = 2^10 rounds, about 54ms. slow on purpose - an attacker with our
// database has to redo that work for every guess
userSchema.statics.hashPassword = function (plain) {
  return bcrypt.hash(plain, 10)
}

// drop the hash from anything we send as JSON, so it can't leak by mistake
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.passwordHash
    return ret
  }
})

module.exports = mongoose.model('User', userSchema)
module.exports.ROLES = ROLES
module.exports.STORED_ROLES = STORED_ROLES
module.exports.ROLE_LABELS = ROLE_LABELS
