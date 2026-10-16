const { slug } = require('./lib/util');

function title(s) {
  return slug(s).toUpperCase();
}

module.exports = { title };
