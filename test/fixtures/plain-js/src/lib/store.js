const { prisma } = require('./db');
const { formatPrice } = require('./format.cjs');

/** Every item, with its price written for people. */
async function listItems() {
  const items = await prisma.item.findMany();
  return items.map(i => ({ ...i, label: formatPrice(i.price) }));
}

async function addItem(name, price) {
  return prisma.item.create({ data: { name, price } });
}

exports.removeItem = async function removeItem(id) {
  return prisma.item.delete({ where: { id } });
};

module.exports.listItems = listItems;
module.exports.addItem = addItem;
