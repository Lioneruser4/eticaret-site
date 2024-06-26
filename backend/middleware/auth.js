const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
    const token = req.header('x-auth-token');
    if (!token) return res.status(401).send('No token, authorization denied');

    try {
        const decoded = jwt.verify(token, 'your_jwt_secret');
        req.user = decoded.id;
        next();
    } catch (error) {
        res.status(400).send('Invalid token');
    }
};
