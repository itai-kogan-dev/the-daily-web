const express = require('express')
const auth = require('../controllers/authController')

const router = express.Router()

router.get('/login', auth.showLogin)
router.post('/login', auth.logIn)
router.post('/logout', auth.logOut)

module.exports = router
