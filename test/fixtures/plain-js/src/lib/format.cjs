function cents(n) {
  return (n / 100).toFixed(2);
}

module.exports = {
  formatPrice: (n) => `€ ${cents(n)}`,
  cents,
};
