const express = require('express')
const auth = require('../controllers/authController')

const router = express.Router()

router.get('/login', auth.showLogin)
// The login page is the one real HTML form that posts, so only it reads form
// bodies. Every API takes JSON, which a form on another site cannot send -
// a second wall against cross-site requests besides the SameSite cookie.
router.post('/login', express.urlencoded({ extended: false }), auth.logIn)
router.post('/logout', auth.logOut)

module.exports = router
