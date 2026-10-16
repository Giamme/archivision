exports.slug = function slug(s) {
  return String(s).toLowerCase().replace(/\s+/g, '-');
};
